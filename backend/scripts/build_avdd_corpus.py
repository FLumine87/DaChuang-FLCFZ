"""构建 AVDD-TCMI 原始特征库（供 integrate_avdd_into_engine.py 使用）。

AVDD-TCMI 每个受试者同时提供：
  · *_acoustic.csv  : 1024 维帧级音频特征（无原始 wav）
  · *_visual.csv    : OpenFace 2.0 视觉特征（AU / 眼动 / 头姿）
  · *_tcm/          : 中医面诊区域图（展示 + HOG 图像特征）

本脚本只负责“把 zip 变成可复用的特征库”，不做检索、不建桥接：
  · 音频池化为 2048 维（1024 均值 + 1024 标准差）
  · 视觉池化为 88 维（AU/pose/gaze 的均值 + 标准差）
  · 每个样本抽一张面诊区域图到 data/avdd_media/<subset>/<id>.jpg
输出 backend/data/hashing/avdd_corpus.db。

用法：
  backend\\venv\\Scripts\\python.exe backend\\scripts\\build_avdd_corpus.py
  ... --subset HDS --limit 40   # 小样本冒烟
"""
import argparse
import csv
import datetime
import io
import json
import os
import sqlite3
import sys
import time
import zipfile

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

import numpy as np  # noqa: E402

DEFAULT_ZIP = r"D:\DaChuang\dataset\dataset\AVDD-TCMI\AVDD-TCMI.zip"
DATASET_ROOT = "AVDD-TCMI-dataset"
POSE_COLS = ("pose_Rx", "pose_Ry", "pose_Rz")
GAZE_COLS = ("gaze_0_x", "gaze_0_y", "gaze_1_x", "gaze_1_y",
             "gaze_angle_x", "gaze_angle_y")


def _log(msg):
    print(f"[{datetime.datetime.now():%H:%M:%S}] {msg}", flush=True)


def _read_labels(z, subset):
    labels = {}
    with z.open(f"{DATASET_ROOT}/{subset}_labels.csv") as f:
        for row in csv.reader(io.TextIOWrapper(f, encoding="utf-8-sig")):
            if len(row) >= 3:
                labels[str(row[0]).strip()] = (int(row[1]), str(row[2]).strip().lower())
    return labels


def _read_acoustic(z, subset, sid):
    with z.open(f"{DATASET_ROOT}/{subset}/{sid}/{sid}_acoustic.csv") as f:
        data = f.read()
    arr = np.atleast_2d(np.loadtxt(io.BytesIO(data), delimiter=","))
    if arr.size == 0:
        return None
    arr = np.nan_to_num(arr.astype(np.float32), nan=0.0, posinf=0.0, neginf=0.0)
    return np.concatenate([arr.mean(axis=0), arr.std(axis=0)]).astype(np.float32)


def _read_visual(z, subset, sid):
    with z.open(f"{DATASET_ROOT}/{subset}/{sid}/{sid}_visual.csv") as f:
        data = f.read()
    header = [c.strip() for c in data.split(b"\n", 1)[0].decode("utf-8-sig").strip().split(",")]
    arr = np.atleast_2d(np.loadtxt(io.BytesIO(data), delimiter=",", skiprows=1))
    if arr.size == 0:
        return None
    idx = [i for i, c in enumerate(header) if c.startswith("AU")]
    idx += [header.index(c) for c in POSE_COLS + GAZE_COLS if c in header]
    if not idx:
        return None
    arr = np.nan_to_num(arr[:, idx].astype(np.float32), nan=0.0, posinf=0.0, neginf=0.0)
    return np.concatenate([arr.mean(axis=0), arr.std(axis=0)]).astype(np.float32)


def _save_media(z, subset, sid, media_dir):
    for region in ("que", "mingtang", "ting"):
        path = f"{DATASET_ROOT}/{subset}/{sid}/{sid}_tcm/0/{region}.jpg"
        try:
            data = z.read(path)
        except KeyError:
            continue
        out_dir = os.path.join(media_dir, subset)
        os.makedirs(out_dir, exist_ok=True)
        out = os.path.join(out_dir, f"{sid}.jpg")
        with open(out, "wb") as f:
            f.write(data)
        return out, region
    return None, None


def _themes(subset, label, gender):
    positive = "抑郁-阳性" if label == 1 else "抑郁-阴性"
    clinic = ("临床确诊" if label == 1 else "临床对照") if subset == "HDS" else (
        "筛查阳性" if label == 1 else "筛查阴性")
    sex = "性别-女" if gender == "f" else "性别-男"
    return [f"AVDD-{subset}", positive, clinic, sex]


def _collect(zip_path, subset, limit, media_dir):
    with zipfile.ZipFile(zip_path) as z:
        labels = _read_labels(z, subset)
        ids = sorted(labels, key=lambda x: int(x) if str(x).isdigit() else x)
        if limit:
            ids = ids[:limit]
        rows, skipped = [], []
        t0 = time.time()
        for n, sid in enumerate(ids, 1):
            label, gender = labels[sid]
            try:
                audio = _read_acoustic(z, subset, sid)
                visual = _read_visual(z, subset, sid)
            except Exception as exc:
                skipped.append((sid, f"feature: {exc}"))
                continue
            if audio is None or visual is None:
                skipped.append((sid, "empty feature"))
                continue
            media_path, region = _save_media(z, subset, sid, media_dir)
            rid = f"AVDD-{subset}-{int(sid):04d}" if str(sid).isdigit() else f"AVDD-{subset}-{sid}"
            rows.append({
                "record_id": rid,
                "subject_id": sid,
                "subset": subset,
                "label": label,
                "gender": gender,
                "themes": _themes(subset, label, gender),
                "alert_level": "orange" if label == 1 else "green",
                "audio_feature": audio,
                "image_feature": visual,
                "media_path": media_path or "",
                "media_region": region or "",
                "screening_label": "positive" if label == 1 else "negative",
            })
            if n % 20 == 0 or n == len(ids):
                _log(f"{subset}: {n}/{len(ids)} 条，已用 {time.time()-t0:.0f}s")
        if skipped:
            _log(f"{subset}: 跳过 {len(skipped)} 条（前 3：{skipped[:3]}）")
        return rows


def _save_corpus(out_path, rows, meta):
    conn = sqlite3.connect(out_path)
    try:
        conn.executescript("""
        DROP TABLE IF EXISTS records;
        DROP TABLE IF EXISTS units;
        DROP TABLE IF EXISTS meta;
        CREATE TABLE records(
            record_id TEXT PRIMARY KEY, subject_id TEXT, subset TEXT,
            label INTEGER, gender TEXT, themes TEXT, alert_level TEXT,
            media_path TEXT, meta TEXT
        );
        CREATE TABLE units(
            unit_id TEXT PRIMARY KEY, record_id TEXT, modality TEXT,
            feature BLOB, media_path TEXT, meta TEXT
        );
        CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
        """)
        for row in rows:
            conn.execute(
                "INSERT INTO records VALUES (?,?,?,?,?,?,?,?,?)",
                (row["record_id"], row["subject_id"], row["subset"], row["label"],
                 row["gender"], json.dumps(row["themes"], ensure_ascii=False),
                 row["alert_level"], row["media_path"],
                 json.dumps({"screening_label": row["screening_label"],
                             "pairing_type": "same_subject_same_session",
                             "pairing_quality": "strong"}, ensure_ascii=False)),
            )
            for modality, feat, media, spec in (
                ("audio", row["audio_feature"], "", "acoustic_1024_pooled_mean_std"),
                ("image", row["image_feature"], row["media_path"],
                 "openface_au_pose_gaze_mean_std"),
            ):
                conn.execute(
                    "INSERT INTO units VALUES (?,?,?,?,?,?)",
                    (f"{row['record_id']}-{'aud' if modality == 'audio' else 'img'}",
                     row["record_id"], modality,
                     np.asarray(feat, dtype=np.float32).tobytes(), media,
                     json.dumps({"dim": int(len(feat)), "feature_spec": spec},
                                ensure_ascii=False)),
                )
        for k, v in meta.items():
            conn.execute("INSERT INTO meta VALUES (?,?)",
                         (k, v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)))
        conn.commit()
    finally:
        conn.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", default=DEFAULT_ZIP)
    ap.add_argument("--subset", choices=("HDS", "SDS"), default="HDS")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--out", default=os.path.join(BACKEND, "data", "hashing", "avdd_corpus.db"))
    ap.add_argument("--media-dir", default=os.path.join(BACKEND, "data", "avdd_media"))
    args = ap.parse_args()
    if not os.path.exists(args.zip):
        raise SystemExit(f"找不到 AVDD zip：{args.zip}")
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    os.makedirs(args.media_dir, exist_ok=True)

    _log(f"读取 {args.subset} …")
    rows = _collect(args.zip, args.subset, args.limit, args.media_dir)
    if len(rows) < 8:
        raise SystemExit(f"样本不足：{len(rows)}")
    n_pos = sum(1 for r in rows if r["label"] == 1)
    meta = {
        "dataset": "AVDD-TCMI",
        "subset": args.subset,
        "n_records": len(rows),
        "n_positive": n_pos,
        "n_negative": len(rows) - n_pos,
        "pairing_type": "same_subject_same_session",
        "pairing_quality": "strong",
        "audio_dim": 2048,
        "image_dim": 88,
        "license": "CC BY-NC 4.0",
        "built_at": datetime.datetime.now().isoformat(timespec="seconds"),
    }
    _save_corpus(args.out, rows, meta)
    _log(f"已写入 {args.out}（{len(rows)} 条，阳性 {n_pos}）")
    _log("下一步：运行 scripts/integrate_avdd_into_engine.py 并入主索引")


if __name__ == "__main__":
    main()
