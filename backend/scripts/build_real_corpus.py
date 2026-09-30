"""从真实数据集构建动态跨模态哈希检索语料（real_corpus.db）。

数据集：Context-Aware Multimodal Depression Dataset
    depression_dataset.csv
        1000 条自述文本 + 情境(活动/环境/互动) + 睡眠/压力/情绪评分 + 风险标签
    Images/Images/{depressed1,depressed2,normal1,normal2}
        12275 张 48×48 灰度面部图像（FER2013 风格）
    Audio/dataset-depression/{depression1,depression2,normal1,normal2}
        800 段 16-bit PCM 单声道 wav（约 2.5s，情感标签 sad/neutral）

⚠️ 数据集的真实约束
-------------------
三模态之间**没有被试级身份配对**，只有风险类别（Depressed / Normal）一级对齐：
CSV 的 Participant_ID 与图像/语音文件名没有任何对应关系。
因此本脚本按「**同类别配对**」构造记录：

    一条记录 = 1 条文本自述 + 1 张面部图像 + 1 段语音，三者风险类别一致

这样跨模态检索在「风险类别 / 文本主题」层面是成立的，而在「同一被试」层面
在数学上不可辨识（同类别下多张图像无法区分）。这是数据集本身的限制，
评测脚本的 T1 指标会体现这一点，报告里必须如实说明。

记录级语义标签 = 文本主题（THEME_KEYWORDS 抽取）∪ 风险类别主题（"风险-抑郁"/"风险-正常"）。
风险类别主题是**唯一跨模态可用的监督信号**，也是 CMFH 监督矩阵 S 的主要来源。

产出
----
backend/data/hashing/real_corpus.db，四张表：
    meta(key, value)                 数据集来源 / 特征规格 / 构建时间
    records(...)                     记录级：主题、风险、时间窗
    units(...)                       单元级：三模态视图 + media_path + 离线特征
    queries(...)                     评测查询：文本 / 图像 / 语音

units 与 queries 的 schema 是 generate_retrieval_corpus.py（合成语料）的超集，
上层哈希引擎与评测脚本无需区分两种语料。

离线特征
--------
图像/语音特征在本脚本内**离线预抽取**并写入 units.feature（JSON），
引擎启动时直接读取，避免每次重建索引都重新解码 900 个媒体文件。
文本特征不落库（由 content 现场重算，代价可忽略，且词表更新后自动生效）。

用法
----
    python backend/scripts/build_real_corpus.py
    python backend/scripts/build_real_corpus.py --records-per-class 200 --queries 150
    python backend/scripts/build_real_corpus.py --dataset-root "D:\\path\\to\\dataset"
"""
import argparse
import csv
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

DEFAULT_OUT = os.path.join(BACKEND, "data", "hashing", "real_corpus.db")

# 数据集根目录解析顺序（仓库内不留绝对路径硬编码，优先环境变量）
_DATASET_CANDIDATES = (
    os.environ.get("DACHUANG_ASSETS_ROOT", ""),
    os.path.join(REPO, "offline", "datasets"),
    os.path.join(os.path.dirname(REPO), "offline", "datasets"),
    r"D:\DaChuang",
)
DATASET_DIRNAME = "Context-Aware Multimodal Depression Dataset"

CSV_NAME = "depression_dataset.csv"
IMAGE_ROOT = os.path.join("Images", "Images")
AUDIO_ROOT = os.path.join("Audio", "dataset-depression")

# 类别 -> 媒体子目录（注意：图像用 depressed*/normal*，语音用 depression*/normal*）
IMAGE_DIRS = {
    "Depressed": ("depressed1", "depressed2"),
    "Normal": ("normal1", "normal2"),
}
AUDIO_DIRS = {
    "Depressed": ("depression1", "depression2"),
    "Normal": ("normal1", "normal2"),
}
LABEL_RISK_THEME = {"Depressed": "风险-抑郁", "Normal": "风险-正常"}
LABEL_SEVERITY = {"Depressed": 4, "Normal": 2}

# 时间窗：数据集时间跨度为 2023-01 ~ 2024-12，按 122 天切分 → 6 个窗口
EPOCH = datetime.date(2023, 1, 1)
WINDOW_DAYS = 122
MAX_WINDOW = 5

MODALITY_SUFFIX = {"text": "txt", "image": "img", "audio": "aud"}


# ---------------------------------------------------------------------------
# 数据集定位与解析
# ---------------------------------------------------------------------------

def resolve_dataset_root(explicit=None):
    """定位数据集根目录；找不到时给出可操作的提示。"""
    if explicit:
        cands = [explicit]
    else:
        cands = []
        for base in _DATASET_CANDIDATES:
            if not base:
                continue
            cands.append(os.path.join(base, DATASET_DIRNAME))
            cands.append(base)          # 也允许直接指向数据集目录
    for c in cands:
        if os.path.exists(os.path.join(c, CSV_NAME)):
            return os.path.abspath(c)
    raise SystemExit(
        "未找到数据集 " + DATASET_DIRNAME + "。\n"
        "请用 --dataset-root 指定目录，或设置环境变量 DACHUANG_ASSETS_ROOT，\n"
        "或把数据集放到 <仓库>/offline/datasets/ 下。\n"
        "已尝试：\n  " + "\n  ".join(cands)
    )


def _natural(v):
    """枚举值 -> 自然短语：With_Friends -> with friends（便于词表匹配与阅读）。"""
    return str(v or "").strip().replace("_", " ").lower()


def _to_float(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def load_text_rows(csv_path):
    """读取 CSV -> 结构化行（含标签、文本、情境短语、时间、评分）。"""
    rows = []
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            label = (r.get("Depression_Label") or "").strip()
            if label not in IMAGE_DIRS:
                continue
            entry = (r.get("Text_Entry") or "").strip()
            if not entry:
                continue
            activity = _natural(r.get("Context_Activity"))
            environment = _natural(r.get("Context_Environment"))
            interaction = _natural(r.get("Context_Interaction"))
            social = _natural(r.get("Social_Interaction_Level"))
            sleep = _to_float(r.get("Sleep_Hours"))
            stress = _to_float(r.get("Stress_Level"))
            mood = _to_float(r.get("Mood_Score"))
            ts = (r.get("Timestamp") or "").strip()
            rows.append({
                "label": label,
                "entry": entry,
                "activity": activity,
                "environment": environment,
                "interaction": interaction,
                "social": social,
                "sleep": sleep,
                "stress": stress,
                "mood": mood,
                "timestamp": ts,
                "participant": (r.get("Participant_ID") or "").strip(),
                # 情境短语既进入文本视图（丰富 TF 特征），也进入主题抽取
                "context": (f"情境：{activity}·{environment}·{interaction}；"
                            f"社交水平 {social}；睡眠 {sleep:g} 小时；"
                            f"压力 {stress:g}/10；情绪 {mood:g}/10。"),
            })
    return rows


def index_media(root):
    """扫描图像/语音目录 -> {label: {"image": [...], "audio": [...]}}。"""
    pools = {lb: {"image": [], "audio": []} for lb in IMAGE_DIRS}
    for label in IMAGE_DIRS:
        for sd in IMAGE_DIRS[label]:
            d = os.path.join(root, IMAGE_ROOT, sd)
            if os.path.isdir(d):
                pools[label]["image"].extend(
                    os.path.join(d, n) for n in sorted(os.listdir(d))
                    if n.lower().endswith((".jpg", ".jpeg", ".png"))
                )
        for sd in AUDIO_DIRS[label]:
            d = os.path.join(root, AUDIO_ROOT, sd)
            if os.path.isdir(d):
                pools[label]["audio"].extend(
                    os.path.join(d, n) for n in sorted(os.listdir(d))
                    if n.lower().endswith(".wav")
                )
    return pools


def text_content(row):
    """文本视图内容 = 自述 + 情境元数据（都是真实字段，非生成文本）。"""
    return f"{row['entry']} {row['context']}"


def themes_of(row):
    """记录/查询的语义标签 = 文本主题 ∪ 风险类别主题。"""
    tags = F.extract_themes(text_content(row))
    risk = LABEL_RISK_THEME[row["label"]]
    if risk not in tags:
        tags.append(risk)
    return tags


def alert_of(row):
    """风险等级：由真实压力评分细分（Depressed 至少 orange）。"""
    if row["label"] == "Depressed":
        return "red" if row["stress"] >= 8.0 else "orange"
    return "yellow" if row["stress"] >= 7.0 else "green"


def window_of(ts):
    try:
        d = datetime.date.fromisoformat(ts[:10])
    except Exception:
        return 0
    return max(0, min(MAX_WINDOW, (d - EPOCH).days // WINDOW_DAYS))


# ---------------------------------------------------------------------------
# 语料构建
# ---------------------------------------------------------------------------

def _extract_feature(modality, path):
    """离线抽取媒体特征；失败返回 None（该记录会被丢弃，保证维度一致）。"""
    if modality == "image":
        return RF.image_feature(path)
    if modality == "audio":
        return RF.audio_feature(path)
    return None


def _wav_header(path):
    """只读 wav 头取时长/采样率，不解码（开销可忽略）。失败返回 (None, None)。"""
    import wave
    try:
        with wave.open(path, "rb") as w:
            sr, n = w.getframerate() or 0, w.getnframes()
        return (round(n / sr, 2) if sr else None), (sr or None)
    except Exception:
        return None, None


def media_meta(path, modality):
    """媒体单元的真实元数据：全部来自文件名/目录，非生成文本。

    语音文件名形如 OAF_back_sad.wav = 说话人组_发音词_情绪，是数据集自带的真实标注；
    图像只有类别子目录（depressed1/normal2 ...）可用作真实来源标识。
    """
    base = os.path.basename(path)
    meta = {"file": base, "dir": os.path.basename(os.path.dirname(path))}
    if modality == "audio":
        parts = os.path.splitext(base)[0].split("_")
        meta["speaker"] = parts[0] if len(parts) > 0 else ""
        meta["word"] = parts[1] if len(parts) > 1 else ""
        meta["emotion"] = parts[2] if len(parts) > 2 else ""
        meta["duration_sec"], meta["sample_rate"] = _wav_header(path)
    return meta


def media_content(meta, modality):
    """图像/语音单元的展示内容：由真实元数据拼出（替代旧的"XX 组…"占位符）。"""
    if modality == "audio":
        bits = [f"情绪 {meta.get('emotion') or '未知'}"]
        for k, label in (("speaker", "说话人"), ("word", "发音")):
            if meta.get(k):
                bits.append(f"{label} {meta[k]}")
        if meta.get("duration_sec"):
            bits.append(f"{meta['duration_sec']}s")
        return f"真实语音 {meta['file']}（{' · '.join(bits)}）"
    return f"真实面部图像 {meta.get('dir', '')}/{meta['file']}"


def build(records_per_class=150, num_queries=120, seed=42,
          dataset_root=None, verbose=True):
    root = resolve_dataset_root(dataset_root)
    rows = load_text_rows(os.path.join(root, CSV_NAME))
    pools = index_media(root)
    if not rows:
        raise SystemExit("CSV 中未解析到任何可用样本")

    rng = random.Random(seed)
    by_label = {}
    for r in rows:
        by_label.setdefault(r["label"], []).append(r)

    records, units = [], []
    skipped = 0
    t0 = time.time()
    for label in ("Depressed", "Normal"):
        label_rows = by_label.get(label) or []
        images = pools[label]["image"]
        audios = pools[label]["audio"]
        if not label_rows or not images or not audios:
            raise SystemExit(f"类别 {label} 缺少文本/图像/语音，无法构建")
        for _ in range(records_per_class):
            row = rng.choice(label_rows)
            img = rng.choice(images)
            aud = rng.choice(audios)
            f_img = _extract_feature("image", img)
            f_aud = _extract_feature("audio", aud)
            if f_img is None or f_aud is None:
                skipped += 1
                continue

            idx = len(records) + 1
            rid = f"REAL-{idx:04d}"
            themes = themes_of(row)
            created = row["timestamp"] or f"{EPOCH.isoformat()} 09:00:00"
            win = window_of(created)
            level = alert_of(row)
            content = text_content(row)

            records.append({
                "record_id": rid, "label": label, "themes": themes,
                "severity": LABEL_SEVERITY[label], "alert_level": level,
                "created_at": created, "window": win, "context": row["context"],
                "entry": row["entry"],
            })
            for mod in ("text", "image", "audio"):
                uid = f"{rid}-{MODALITY_SUFFIX[mod]}"
                if mod == "text":
                    media_path, feature = None, None
                elif mod == "image":
                    media_path, feature = img, f_img
                else:
                    media_path, feature = aud, f_aud
                # 图像/语音的展示内容改为真实元数据（文件名 + 数据集自带标注），不再写占位符
                m_meta = None if mod == "text" else media_meta(media_path, mod)
                units.append({
                    "unit_id": uid, "record_id": rid, "modality": mod,
                    "content": content if mod == "text" else media_content(m_meta, mod),
                    "themes": themes, "alert_level": level,
                    "created_at": created, "window": win,
                    "media_path": media_path,
                    "media_kind": ("face48" if mod == "image" else
                                   "speech_pcm16" if mod == "audio" else "self_report"),
                    "feature": feature,
                    "meta": m_meta,
                    "dataset": "Context-Aware Multimodal Depression Dataset",
                })
    if verbose:
        print(f"记录构建完成：{len(records)} 条（跳过 {skipped} 条媒体抽取失败），"
              f"耗时 {time.time() - t0:.1f}s")

    # 把单元挂回记录（内存索引），供查询构造取用同一记录的媒体路径
    by_rec = {}
    for u in units:
        by_rec.setdefault(u["record_id"], []).append(u)
    for r in records:
        r["_units"] = by_rec.get(r["record_id"], [])

    queries = build_queries(rows, records, rng, num_queries)
    return root, records, units, queries


def build_queries(rows, records, rng, n):
    """构造评测查询：70% 文本 / 15% 图像 / 15% 语音。

    每条查询都绑定一条**同类别且同自述句**的记录（找不到则退化为同类别），
    这样 T1「跨模态同源召回」至少有类别级目标；同被试级对齐本就不存在。
    """
    by_entry = {}
    by_label = {}
    for r in records:
        by_label.setdefault(r["label"], []).append(r)
        by_entry.setdefault((r["label"], r["entry"]), []).append(r)

    queries = []
    for j in range(n):
        row = rng.choice(rows)
        pool = by_entry.get((row["label"], row["entry"])) or by_label[row["label"]]
        src = rng.choice(pool)
        u = rng.random()
        if u < 0.70:
            modality, media = "text", None
        else:
            modality = "image" if u < 0.85 else "audio"
            media = next((x["media_path"] for x in src["_units"]
                          if x["modality"] == modality), None)

        # 查询文本与记录文本同源同格式：运行时 extract_themes(query) 才能与
        # 这里存下来的 q["themes"] 保持一致（否则评测口径与线上行为不一致）
        qtext = f"检索相似情况：{row['entry']} {row['context']}"
        queries.append({
            "query_id": f"RQ{j + 1:04d}",
            "record_id": src["record_id"],
            "text": qtext,
            "themes": themes_of(row),
            "alert_level": alert_of(row),
            "created_at": f"{row['timestamp'] or EPOCH.isoformat()}",
            "modality": modality,
            "media_path": media,
        })
    return queries


# ---------------------------------------------------------------------------
# 落库
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


def write_db(out_path, root, records, units, queries, records_per_class):
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    if os.path.exists(out_path):
        os.remove(out_path)
    conn = sqlite3.connect(out_path)
    try:
        conn.executescript(SCHEMA)
        conn.executemany(
            "INSERT INTO meta VALUES (?,?)",
            [
                ("kind", "real"),
                ("dataset_name", "Context-Aware Multimodal Depression Dataset"),
                ("dataset_root", root),
                ("pairing", "same-label pairing (no subject-level alignment across modalities)"),
                ("label_rule", "text themes ∪ risk-label theme"),
                ("window_rule", f"epoch={EPOCH.isoformat()} window_days={WINDOW_DAYS}"),
                ("feature_spec", f"image={RF.IMAGE_FEATURE_DIM}d audio={RF.AUDIO_FEATURE_DIM}d "
                                 f"text={len(F.semantic_feature('probe'))}d"),
                ("built_at", datetime.datetime.now().isoformat(timespec="seconds")),
                ("records_per_class", str(records_per_class)),
            ],
        )
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


def main():
    ap = argparse.ArgumentParser(description="从真实数据集构建跨模态检索语料")
    ap.add_argument("--dataset-root", default=None, help="数据集根目录")
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--records-per-class", type=int, default=150)
    ap.add_argument("--queries", type=int, default=120)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    root, records, units, queries = build(
        records_per_class=args.records_per_class, num_queries=args.queries,
        seed=args.seed, dataset_root=args.dataset_root,
    )
    write_db(args.out, root, records, units, queries, args.records_per_class)

    win_dist, level_dist, theme_dist = {}, {}, {}
    for r in records:
        win_dist[r["window"]] = win_dist.get(r["window"], 0) + 1
        level_dist[r["alert_level"]] = level_dist.get(r["alert_level"], 0) + 1
        for t in r["themes"]:
            theme_dist[t] = theme_dist.get(t, 0) + 1
    mod_dist = {}
    for u in units:
        mod_dist[u["modality"]] = mod_dist.get(u["modality"], 0) + 1

    size_mb = os.path.getsize(args.out) / 1024 / 1024
    print(f"\n语料已生成: {args.out}  ({size_mb:.1f} MB)")
    print(f"  数据集: {root}")
    print(f"  记录 {len(records)} 条 / 单元 {len(units)} 个 / 查询 {len(queries)} 条")
    print(f"  模态分布: {dict(sorted(mod_dist.items()))}")
    print(f"  时间窗分布: {dict(sorted(win_dist.items()))}")
    print(f"  风险等级分布: {level_dist}")
    print(f"  查询模态分布: " + str({m: sum(1 for q in queries if q['modality'] == m)
                                    for m in ('text', 'image', 'audio')}))
    print(f"  主题分布: {dict(sorted(theme_dist.items(), key=lambda kv: -kv[1]))}")
    print("\n样例记录（同一记录的三模态视图）:")
    for u in units[:3]:
        media = u["media_path"] and os.path.basename(u["media_path"]) or "—"
        print(f"  [{u['modality']:5s}] {u['content'][:48]}… | 媒体 {media} | 主题 {u['themes']}")
    print("\n样例查询:")
    for q in queries[:3]:
        print(f"  {q['query_id']} [{q['modality']}] -> {q['record_id']} | {q['text'][:56]}")


if __name__ == "__main__":
    main()
