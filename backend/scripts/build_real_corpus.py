"""从真实数据集构建动态跨模态哈希检索语料（real_corpus.db）。

背景
----
项目原本用 `Context-Aware Multimodal Depression Dataset`（已被核实为不合格：
文本是模板查表、音频是 TTS 单词串、图像是 FER2013 复制、三模态无被试级配对，
导致跨模态检索不可辨识、随机基线 mAP 已饱和）。本脚本改为从两个可下载的
真实数据集构造语料：

  * EATD-Corpus（ICASSP 2022 中文抑郁语料）：162 名受试者，语音+转写+SDS 量表
    受试者级 + 语句级配对；SDS 标准化分 ≥53 记为抑郁（30:132 真实类不平衡）。
  * CSEMOTIONS（HF 中文情绪语音，Apache 2.0）：4160 条 音频+中文文本+情绪。

两者都是「文本 + 语音」配对（无图像模态），因此记录由 text 单元 + audio 单元组成。
跨模态检索目标 = 同一句的转写 ↔ 语音，T1 不再不可辨识（相比旧语料是本质改进）。

适配器
------
解析逻辑按数据集拆分到 `datasets/` 包（base / eatd / csemotions），
本脚本只负责：定位数据集 → 调用适配器 → 合并 → 按固定 schema 落库。

用法
----
    python scripts/build_real_corpus.py                          # 默认合并两个数据集
    python scripts/build_real_corpus.py --dataset eatd           # 只用 EATD-Corpus
    python scripts/build_real_corpus.py --dataset csemotions     # 只用 CSEMOTIONS
    python scripts/build_real_corpus.py --out <path> --queries 150
    python scripts/build_real_corpus.py --sample-max 500         # 合并时限制样本数
"""
import argparse
import datetime
import json
import os
import random
import sqlite3
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
REPO = os.path.dirname(BACKEND)
sys.path.insert(0, BACKEND)

from app.engines.hashing import features as F            # noqa: E402
from app.engines.hashing import real_features as RF      # noqa: E402
from scripts.datasets import base as B                   # noqa: E402
from scripts.datasets import eatd, csemotions, fer2013   # noqa: E402

DEFAULT_OUT = os.path.join(BACKEND, "data", "hashing", "real_corpus.db")

# 数据集目录名 -> 定位逻辑（优先环境变量 / <仓库>/offline/datasets / D:\\DaChuang）
DATASET_DIRS = {
    "eatd": ("EATD", "EATD-Corpus"),
    "csemotions": ("CSEMOTIONS",),
    "fer": ("FER2013", "archive"),   # Kaggle FER2013 解压包根目录（内含 train/ 与 test/）
}

# 合并语料时的粗风险映射：让 T3 跨数据集类别一致率可对齐。
# 键为 数据集键 ; 值为 该数据集 label 值 -> 粗风险("high"/"low")
MERGE_RISK = {
    "eatd": {"Depressed": "high", "Normal": "low"},
    "csemotions": {"high": "high", "low": "low"},
    "fer": {"high": "high", "low": "low"},
}

# FER2013 参与合并时的默认每类样本数（7 类 → 约 7*221 ≈ 1547 张图像）
FER_PER_CLASS = 220


def _dataset_candidates():
    out = []
    env = os.environ.get("DACHUANG_ASSETS_ROOT", "")
    if env:
        out.append(env)
    out.append(os.path.join(REPO, "offline", "datasets"))
    out.append(os.path.join(os.path.dirname(REPO), "offline", "datasets"))
    out.append(r"D:\DaChuang")
    return out


def resolve(ds_key):
    """定位给定数据集的根目录。"""
    for base in _dataset_candidates():
        for name in DATASET_DIRS[ds_key]:
            cand = os.path.join(base, name)
            if os.path.isdir(cand):
                return cand
    raise SystemExit(
        f"未找到 {ds_key} 数据集。\n"
        f"请把它放到 D:\\DaChuang\\{DATASET_DIRS[ds_key][0]}，或设置 DACHUANG_ASSETS_ROOT。\n"
        f"已尝试：\n  " + "\n  ".join(
            os.path.join(b, n) for b in _dataset_candidates() for n in DATASET_DIRS[ds_key])
    )


# ---------------------------------------------------------------------------
# 落库（schema 保持不变，与 generate_retrieval_corpus.py 兼容）
# ---------------------------------------------------------------------------
SCHEMA = """
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE records(
    record_id TEXT PRIMARY KEY, themes TEXT, severity INTEGER,
    alert_level TEXT, created_at TEXT, window INTEGER, context TEXT, label TEXT);
CREATE TABLE units(
    unit_id TEXT PRIMARY KEY, record_id TEXT, modality TEXT, content TEXT,
    themes TEXT, alert_level TEXT, created_at TEXT, window INTEGER,
    media_path TEXT, media_kind TEXT, feature TEXT, dataset TEXT, meta TEXT);
CREATE TABLE queries(
    query_id TEXT PRIMARY KEY, record_id TEXT, text TEXT, themes TEXT,
    alert_level TEXT, created_at TEXT, modality TEXT, media_path TEXT);
CREATE INDEX ix_units_record ON units(record_id);
CREATE INDEX ix_units_window ON units(window);
CREATE INDEX ix_units_modality ON units(modality);
"""


def write_db(out_path, root, records, units, queries, build_meta):
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    if os.path.exists(out_path):
        os.remove(out_path)
    conn = sqlite3.connect(out_path)
    try:
        conn.executescript(SCHEMA)
        meta_rows = [
            ("kind", "real"),
            ("dataset_name", build_meta.get("dataset_name", "EATD+CSEMOTIONS")),
            ("dataset_root", root),
            ("pairing", build_meta.get("pairing", "utterance-level text<->audio pairing")),
            ("label_rule", build_meta.get("label_rule", "")),
            ("window_rule", f"epoch={B.EPOCH.isoformat()} window_days={B.WINDOW_DAYS}"),
            ("feature_spec", "text=%dd audio=%dd"
                            % (len(F.semantic_feature("probe")), RF.AUDIO_FEATURE_DIM)),
            ("modalities", ",".join(sorted({u["modality"] for u in units}))),
            ("built_at", datetime.datetime.now().isoformat(timespec="seconds")),
        ]
        for k, v in build_meta.get("extra", {}).items():
            meta_rows.append((k, str(v)))
        conn.executemany("INSERT INTO meta VALUES (?,?)", meta_rows)
        conn.executemany(
            "INSERT INTO records VALUES (?,?,?,?,?,?,?,?)",
            [(r["record_id"], json.dumps(r["themes"], ensure_ascii=False), r["severity"],
              r["alert_level"], r["created_at"], r["window"], r["context"], r["label"])
             for r in records],
        )
        conn.executemany(
            "INSERT INTO units VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [(u["unit_id"], u["record_id"], u["modality"], u["content"],
              json.dumps(u["themes"], ensure_ascii=False), u["alert_level"],
              u["created_at"], u["window"], u["media_path"], u["media_kind"],
              json.dumps(u["feature"]) if u["feature"] else None, u["dataset"],
              json.dumps(u.get("meta"), ensure_ascii=False) if u.get("meta") else None)
             for u in units],
        )
        conn.executemany(
            "INSERT INTO queries VALUES (?,?,?,?,?,?,?,?)",
            [(q["query_id"], q["record_id"], q["text"],
              json.dumps(q["themes"], ensure_ascii=False), q["alert_level"],
              q["created_at"], q["modality"], q["media_path"]) for q in queries],
        )
        conn.commit()
    finally:
        conn.close()


def _attach_images(records, units, pool):
    """按记录的情绪键（image_keys）从 FER2013 图像池挂接一个图像视图。

    FER2013 是纯图像集，没有与之同源的文本/语音；若单独成记录，会与
    「文本+语音」记录形成不一致的模态集合，导致引擎配对训练退化为单模态。
    因此这里把图像按**情绪语义对齐**挂到已有记录上，让每条记录都具备
    text + audio + image 三视图（文本↔语音配对仍是真实同源配对）。

    返回 (新增图像单元数, 被覆盖的记录数)。
    """
    have = {u["record_id"] for u in units if u["modality"] == "image"}
    cursor = {}
    added = covered = 0
    for n, rec in enumerate(records):
        rid = rec["record_id"]
        if rid in have:
            continue
        keys = rec.get("image_keys") or []
        if not keys:
            continue
        key = keys[n % len(keys)]
        paths = pool.get(key) or []
        i = cursor.get(key, 0)      # 每个情绪键各自单调取用 → 不重复、可复现
        if i >= len(paths):
            continue
        cursor[key] = i + 1
        iu = B.make_image_unit(rid, paths[i], rec["themes"], rec["alert_level"],
                               rec["created_at"], rec["window"], "FER2013")
        if iu is not None:
            units.append(iu)
            added += 1
            covered += 1
    return added, covered


def _image_queries(records, units, rng, n):
    """追加「图像 → 其他模态」方向的评测查询（图像查询走媒体特征）。"""
    img_of = {}
    for u in units:
        if u["modality"] == "image":
            img_of.setdefault(u["record_id"], u["media_path"])
    cands = [r for r in records if r["record_id"] in img_of]
    if not cands:
        return []
    out = []
    for _ in range(n):
        src = rng.choice(cands)
        out.append({
            "query_id": "",          # 稍后统一重编号
            "record_id": src["record_id"],
            "text": f"{B.PUBLIC_PREFIX}{src.get('content', '')}",
            "themes": list(src["themes"]),
            "alert_level": src.get("alert_level", "green"),
            "created_at": src.get("created_at", ""),
            "modality": "image",
            "media_path": img_of[src["record_id"]],
        })
    return out


def _normalize_merged(records, sources_key):
    """合并时把各数据集 label 映射为粗风险（跨数据集 T3 可对齐）。"""
    for rec in records:
        ds = rec.get("_ds")
        rec["label"] = MERGE_RISK.get(ds, {}).get(rec["label"], rec["label"])


def main():
    ap = argparse.ArgumentParser(description="从真实数据集构建跨模态检索语料")
    ap.add_argument("--dataset", choices=("eatd", "csemotions", "fer", "all"), default="all",
                    help="构建哪个数据集（默认 all=合并 EATD+CSEMOTIONS+FER2013）")
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--queries", type=int, default=120)
    ap.add_argument("--sample-max", type=int, default=0,
                    help="每个数据集最多保留的记录数（0=不限制）")
    ap.add_argument("--csemotions-max-files", type=int, default=0,
                    help="CSEMOTIONS 读取的 parquet 分片数（0=全量 8 个）")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    # all 模式：EATD + CSEMOTIONS 提供真实「文本↔语音」配对；FER2013 是纯图像集，
    # 不单独成记录（会造成记录间模态集合不一致），而是按情绪挂接为图像视图，
    # 使每条记录都具备 text + audio + image 三视图，供引擎做联合配对训练。
    attach_fer = (args.dataset == "all")
    keys = ["eatd", "csemotions"] if attach_fer else [args.dataset]

    all_records, all_units, all_queries = [], [], []
    build_meta = {"extra": {}}
    t0 = time.time()

    for key in keys:
        root = resolve(key)
        print(f"[{key}] 数据集根目录: {root}")
        if key == "eatd":
            res = eatd.build(root, rng, sample_max=args.sample_max,
                             num_queries=args.queries)
        elif key == "csemotions":
            res = csemotions.build(
                root, rng, sample_max=args.sample_max, num_queries=args.queries,
                csemotions_max_files=(args.csemotions_max_files or 8),
                max_examples=args.sample_max)
        elif key == "fer":
            # 纯图像数据集：不贡献文本/语音查询（图像查询由前端上传触发）
            fer_per = args.sample_max // 7 if args.sample_max else FER_PER_CLASS
            res = fer2013.build(root, rng, records_per_class=fer_per, num_queries=0)
        else:
            raise SystemExit("未知数据集")
        for rec in res["records"]:
            rec["_ds"] = key
        all_records.extend(res["records"])
        all_units.extend(res["units"])
        all_queries.extend(res["queries"])
        for k, v in res.get("meta", {}).items():
            build_meta.setdefault(k, v) if k not in ("dataset_name",) else None
            build_meta["extra"][f"{key}.{k}"] = v
        print(f"[{key}] 记录 {len(res['records'])} / 单元 {len(res['units'])} / "
              f"查询 {len(res['queries'])}  （已用 {time.time() - t0:.1f}s）")

    if attach_fer:
        fer_root = resolve("fer")
        print(f"[fer] 数据集根目录: {fer_root}（作为图像视图挂接到上述记录）")
        pool = fer2013.image_pool(fer_root, per_class=0, seed=args.seed)
        added, covered = _attach_images(all_records, all_units, pool)
        print(f"[fer] 已挂接图像单元 {added} 个 / 覆盖记录 {covered} 条"
              f"（已用 {time.time() - t0:.1f}s）")
        img_q = _image_queries(all_records, all_units, rng, max(1, args.queries // 3))
        all_queries.extend(img_q)
        print(f"[fer] 追加图像查询 {len(img_q)} 条")
        build_meta["extra"]["fer.attach_mode"] = (
            "emotion-aligned image view (weak cross-dataset pairing; "
            "text<->audio pairing remains real)")

    if args.dataset == "all":
        _normalize_merged(all_records, keys)
        build_meta["dataset_name"] = "EATD-Corpus + CSEMOTIONS + FER2013"
        build_meta["pairing"] = ("text/audio (utterance-level) + FER2013 images; "
                                 "labels: EATD SDS(53) + CSEMOTIONS/FER emotion -> 高/低风险")
    else:
        build_meta["dataset_name"] = {
            "eatd": "EATD-Corpus", "csemotions": "CSEMOTIONS", "fer": "FER2013",
        }[args.dataset]

    # 合并时各适配器的 query_id(RQxxxx) 会冲突，统一重编号
    for j, q in enumerate(all_queries):
        q["query_id"] = f"RQ{j + 1:05d}"

    write_db(args.out, ",".join(resolve(k) for k in keys),
             all_records, all_units, all_queries, build_meta)
    _summarize(args.out, all_records, all_units, all_queries)
    print(f"\n语料已生成: {args.out}  （总耗时 {time.time() - t0:.1f}s）")


def _summarize(out, records, units, queries):
    win, level, theme, label = {}, {}, {}, {}
    for r in records:
        win[r["window"]] = win.get(r["window"], 0) + 1
        level[r["alert_level"]] = level.get(r["alert_level"], 0) + 1
        label[r["label"]] = label.get(r["label"], 0) + 1
        for t in r["themes"]:
            theme[t] = theme.get(t, 0) + 1
    mod = {}
    for u in units:
        mod[u["modality"]] = mod.get(u["modality"], 0) + 1
    size_mb = os.path.getsize(out) / 1024 / 1024
    print(f"\n  输出文件: {out}  ({size_mb:.1f} MB)")
    print(f"  记录 {len(records)} / 单元 {len(units)} / 查询 {len(queries)}")
    print(f"  模态分布: {dict(sorted(mod.items()))}")
    print(f"  标签分布: {dict(sorted(label.items()))}")
    print(f"  风险等级: {level}")
    print(f"  时间窗分布: {dict(sorted(win.items()))}")
    print(f"  查询模态: " + str({m: sum(1 for q in queries if q['modality'] == m)
                                for m in ('text', 'audio')}))
    print(f"  主题分布: {dict(sorted(theme.items(), key=lambda kv: -kv[1]))}")
    print("\n样例记录（同一记录的两模态视图）:")
    seen = set()
    shown = 0
    for u in units:
        if u["record_id"] in seen:
            continue
        seen.add(u["record_id"])
        media = u["media_path"] and os.path.basename(u["media_path"]) or "—"
        print(f"  [{u['record_id']}] {u['content'][:46]}… | 媒体 {media} | 主题 {u['themes']}")
        shown += 1
        if shown >= 3:
            break
    print("\n样例查询:")
    for q in queries[:3]:
        print(f"  {q['query_id']} [{q['modality']}] -> {q['record_id']} | {q['text'][:56]}")


if __name__ == "__main__":
    main()
