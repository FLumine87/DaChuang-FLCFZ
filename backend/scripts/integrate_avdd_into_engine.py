"""把 AVDD-TCMI 的音频-图像强配对样本并入现有哈希引擎。

原则：
  · 不新建检索页面/接口，AVDD 只是让现有主索引多出 282 条音-图记录；
  · 特征必须与主引擎当前投影矩阵维度一致：
        audio -> 64 维（1024 维声学特征池化后 PCA 到 64）
        image -> 192 维（面诊区域图的强度 + HOG，与 FER2013 同一提取器）
  · 只追加 AVDD 单元，不重训主模型；用现有 W_audio / W_image 编码入索引；
  · 同时写回 real_corpus.db，保证下次重建索引不会丢失 AVDD。

运行前先停后端（避免 index.db 写锁）：
    backend\\venv\\Scripts\\python.exe backend\\scripts\\integrate_avdd_into_engine.py
运行后重启后端即可在现有检索页看到 AVDD 结果。
"""
import argparse
import datetime
import json
import os
import sqlite3
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

import numpy as np  # noqa: E402

from app.config import settings  # noqa: E402
from app.engines.hashing import real_features as RF  # noqa: E402
from app.engines.hashing.engine import DynamicCrossModalHashingEngine  # noqa: E402
from scripts.datasets import base as B  # noqa: E402

DEFAULT_AVDD = os.path.join(BACKEND, "data", "hashing", "avdd_corpus.db")
DEFAULT_CORPUS = os.path.join(BACKEND, "data", "hashing", "real_corpus.db")
AUDIO_DIM = 64
IMAGE_DIM = 192


def _log(msg):
    print(f"[{datetime.datetime.now():%H:%M:%S}] {msg}", flush=True)


def _read_avdd(path):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        records = [dict(r) for r in conn.execute("SELECT * FROM records ORDER BY record_id")]
        units = [dict(r) for r in conn.execute("SELECT * FROM units")]
    finally:
        conn.close()
    by = {}
    for u in units:
        by.setdefault(u["record_id"], {})[u["modality"]] = u
    return records, by


def _pca64(mat):
    """1024/2048 维声学特征 -> 64 维 PCA，标准化到单位方差。"""
    x = np.asarray(mat, dtype=np.float32)
    mean = x.mean(axis=0)
    xc = x - mean
    # 用 SVD 取前 64 个主成分；282 条样本，计算量很小
    _u, s, vt = np.linalg.svd(xc, full_matrices=False)
    comp = vt[:AUDIO_DIM]
    z = xc @ comp.T
    std = z.std(axis=0)
    std[std < 1e-8] = 1.0
    return (z / std).astype(np.float32)


def _insert_corpus(corpus_path, rows):
    conn = sqlite3.connect(corpus_path)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        existing = {r[0] for r in conn.execute(
            "SELECT record_id FROM records WHERE record_id LIKE 'AVDD-%'")}
        added_r = added_u = 0
        for row in rows:
            rid = row["record_id"]
            if rid in existing:
                continue
            conn.execute(
                "INSERT OR REPLACE INTO records"
                "(record_id,themes,severity,alert_level,created_at,window,context,label) "
                "VALUES(?,?,?,?,?,?,?,?)",
                (rid, json.dumps(row["themes"], ensure_ascii=False), row["severity"],
                 row["alert_level"], row["created_at"], row["window"],
                 row["context"], row["label"]),
            )
            added_r += 1
            for unit in row["units"]:
                conn.execute(
                    "INSERT OR REPLACE INTO units"
                    "(unit_id,record_id,modality,content,themes,alert_level,created_at,window,"
                    "media_path,media_kind,feature,dataset,meta) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (unit["unit_id"], rid, unit["modality"], unit["content"],
                     json.dumps(unit["themes"], ensure_ascii=False), unit["alert_level"],
                     row["created_at"], row["window"], unit["media_path"], unit["media_kind"],
                     json.dumps(unit["feature"]), "AVDD-TCMI",
                     json.dumps(unit["meta"], ensure_ascii=False)),
                )
                added_u += 1
        # 更新语料库元信息
        meta = dict(conn.execute("SELECT key,value FROM meta"))
        name = meta.get("dataset_name", "")
        if "AVDD-TCMI" not in name:
            conn.execute("INSERT OR REPLACE INTO meta VALUES('dataset_name', ?)",
                         (name + " + AVDD-TCMI" if name else "AVDD-TCMI",))
        root = meta.get("dataset_root", "")
        media_root = os.path.join(BACKEND, "data", "avdd_media", "HDS")
        if media_root not in root:
            conn.execute("INSERT OR REPLACE INTO meta VALUES('dataset_root', ?)",
                         (root + "," + media_root if root else media_root,))
        conn.commit()
        return added_r, added_u
    finally:
        conn.close()


def _ingest_index(rows):
    engine = DynamicCrossModalHashingEngine()
    engine._do_initialize()
    w = engine.model.W or {}
    if "audio" not in w or "image" not in w:
        raise SystemExit(f"主模型缺少 audio/image 投影：{sorted(w)}")
    if len(w["audio"][0]) != AUDIO_DIM or len(w["image"][0]) != IMAGE_DIM:
        raise SystemExit(
            f"主模型维度与 AVDD 适配不一致：audio={len(w['audio'][0])}, "
            f"image={len(w['image'][0])}（期望 {AUDIO_DIM}/{IMAGE_DIM}）")

    added = 0
    for row in rows:
        rid = row["record_id"]
        for unit in row["units"]:
            uid = unit["unit_id"]
            if uid in engine.units:
                # 已写入过：补上持久化到 meta JSON 的溯源字段
                engine.units[uid]["meta"] = dict(unit["meta"])
                engine._store.upsert_unit(uid, engine.units[uid])
                continue
            meta = {
                "record_id": rid,
                "modality": unit["modality"],
                "content": unit["content"],
                "summary": unit["content"],
                "tags": row["themes"],
                "alert_level": row["alert_level"],
                "date": row["created_at"],
                "window": row["window"],
                "scope": "public",
                "source": "corpus-avdd",
                "user_id": None,
                "deid_terms": [],
                "media_path": unit["media_path"],
                "media_kind": unit["media_kind"],
                "feature": unit["feature"],
                "dataset": "AVDD-TCMI",
                # _to_row 只持久化列；溯源字段必须放进 meta JSON 才能跨重启保留
                "meta": dict(unit["meta"]),
                **unit["meta"],
            }
            engine._add_unit(uid, meta)
            engine._store.upsert_unit(uid, engine.units[uid])
            if rid in engine.records:
                engine._store.upsert_record(rid, engine.records[rid])
            added += 1
    engine._store.meta_set("source_count", str(len(engine.units)))
    return engine, added


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--avdd-db", default=DEFAULT_AVDD)
    ap.add_argument("--corpus", default=DEFAULT_CORPUS)
    args = ap.parse_args()
    if not os.path.exists(args.avdd_db):
        raise SystemExit(f"找不到 AVDD 特征库：{args.avdd_db}")
    if not os.path.exists(args.corpus):
        raise SystemExit(f"找不到主语料库：{args.corpus}")

    records, by = _read_avdd(args.avdd_db)
    _log(f"AVDD 记录 {len(records)} 条，单元视图 {sum(len(v) for v in by.values())} 个")

    audio_rows = []
    for rec in records:
        au = (by.get(rec["record_id"]) or {}).get("audio")
        if not au or not au.get("feature"):
            continue
        arr = np.frombuffer(au["feature"], dtype=np.float32)
        if arr.size:
            audio_rows.append(arr)
    if len(audio_rows) != len(records):
        raise SystemExit(f"AVDD 音频特征不完整：{len(audio_rows)}/{len(records)}")
    audio64 = _pca64(np.stack(audio_rows))
    # 与 records 的顺序对齐：_read_avdd 已按 record_id 排序
    audio_by_rid = {rec["record_id"]: audio64[i] for i, rec in enumerate(records)}

    rows = []
    skipped_img = 0
    for idx, rec in enumerate(records):
        rid = rec["record_id"]
        themes = json.loads(rec["themes"] or "[]")
        label = int(rec["label"])
        created, window = B.simulated_created(idx + 1)
        positive = label == 1
        units = []
        # 音频：PCA 64 维；无原始 wav，media_kind 明确标成 feature_csv
        units.append({
            "unit_id": f"{rid}-aud",
            "modality": "audio",
            "content": "AVDD-TCMI 音频特征（1024 维声学特征池化 + PCA64；无原始音频）",
            "media_path": "",
            "media_kind": "feature_csv",
            "feature": audio_by_rid[rid].astype(float).tolist(),
            "meta": {
                "label_source": "AVDD-TCMI/HDS 临床诊断",
                "label_validity": "clinical_diagnosis",
                "pairing_type": "same_subject_same_session",
                "pairing_quality": "strong",
                "screening_label": "positive" if positive else "negative",
                "screening_usable": True,
                "emotion_label": "depression",
                "severity": 1 if positive else 0,
                "subject_id": rec["subject_id"],
                "subset": rec["subset"],
                "gender": rec["gender"],
                "feature_spec": "acoustic_1024_pooled_pca64",
                "media_note": "AVDD 不发布原始音频，仅预计算声学特征",
            },
            "themes": themes,
            "alert_level": rec["alert_level"],
        })
        # 图像：面诊区域图的 192 维强度 + HOG，与主引擎 FER 图像同一提取器
        img = (by.get(rid) or {}).get("image")
        media_path = (img or {}).get("media_path") or rec.get("media_path") or ""
        feat = RF.image_feature(media_path) if media_path and os.path.exists(media_path) else None
        if feat is None:
            skipped_img += 1
        else:
            units.append({
                "unit_id": f"{rid}-img",
                "modality": "image",
                "content": "AVDD-TCMI 面诊区域图（192 维强度 + HOG）",
                "media_path": media_path,
                "media_kind": "image",
                "feature": list(feat),
                "meta": {
                    "label_source": "AVDD-TCMI/HDS 临床诊断",
                    "label_validity": "clinical_diagnosis",
                    "pairing_type": "same_subject_same_session",
                    "pairing_quality": "strong",
                    "screening_label": "positive" if positive else "negative",
                    "screening_usable": True,
                    "emotion_label": "depression",
                    "severity": 1 if positive else 0,
                    "subject_id": rec["subject_id"],
                    "subset": rec["subset"],
                    "gender": rec["gender"],
                    "feature_spec": "intensity64_hog128",
                },
                "themes": themes,
                "alert_level": rec["alert_level"],
            })
        rows.append({
            "record_id": rid,
            "themes": themes,
            "severity": 1 if positive else 0,
            "alert_level": rec["alert_level"],
            "created_at": created,
            "window": window,
            "context": f"AVDD-TCMI {rec['subset']} {rid}（同受试者音-图强配对）",
            "label": f"avdd:{rec['subset'].lower()}:{'positive' if positive else 'negative'}",
            "units": units,
        })

    added_r, added_u = _insert_corpus(args.corpus, rows)
    _log(f"写入 real_corpus.db：records +{added_r}，units +{added_u}；图像缺失 {skipped_img} 条")

    engine, added_idx = _ingest_index(rows)
    _log(f"写入主索引：+{added_idx} 个单元，当前索引 {len(engine.units)} 个单元")
    _log("完成。重启后端后，现有检索页即可检索到 AVDD 的音频/图像单元。")


if __name__ == "__main__":
    main()
