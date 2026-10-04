"""数据集适配器公共工具：媒体元数据 / 时间窗 / 特征抽取 / 查询构造。

只放与具体数据集无关的逻辑；各适配器只负责“如何把自家文件变成 record/unit”。
"""
import datetime
import os
import random

# 时间窗：新数据集没有真实时间戳，我们按记录顺序模拟一条时间轴，
# 用 window 切分以驱动“动态多表索引 + 权重衰减”机制（这是项目书 4.7 的核心卖点）。
EPOCH = datetime.date(2025, 1, 1)
WINDOW_DAYS = 30
MAX_WINDOW = 5

# 文本视图是“查询/展示”用的前缀；媒体视图展示由媒体元数据拼出。
PUBLIC_PREFIX = "检索相似情况："

MODALITY_SUFFIX = {"text": "txt", "audio": "aud", "image": "img"}


def _to_float(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _natural(v):
    return str(v or "").strip().replace("_", " ").lower()


def wav_header(path):
    """只读 wav 头取 (时长秒, 采样率)；失败返回 (None, None)。"""
    import wave
    try:
        with wave.open(path, "rb") as w:
            sr, n = w.getframerate() or 0, w.getnframes()
        return (round(n / sr, 2) if sr else None), (sr or None)
    except Exception:
        return None, None


def audio_feature(path):
    """离线音频特征；失败返回 None。"""
    from app.engines.hashing import real_features as RF
    return RF.audio_feature(path)


def media_meta(path, modality):
    """媒体单元的真实元数据（文件名 + 目录），展示用。"""
    base = os.path.basename(path)
    meta = {"file": base, "dir": os.path.basename(os.path.dirname(path))}
    if modality == "audio":
        dur, sr = wav_header(path)
        meta["duration_sec"] = dur
        meta["sample_rate"] = sr
    return meta


def _render_audio_meta(meta):
    bits = []
    if meta.get("duration_sec"):
        bits.append(f"{meta['duration_sec']}s")
    if meta.get("sample_rate"):
        bits.append(f"{meta['sample_rate']}Hz")
    return f"真实语音 {meta.get('file', '')}（{' · '.join(bits)}）"


def media_content(meta, modality):
    """图像/语音单元的展示内容：由真实元数据拼出（非占位符）。"""
    if modality == "audio":
        return _render_audio_meta(meta or {})
    if modality == "image":
        return f"真实面部图像 {meta.get('dir', '')}/{meta.get('file', '')}"
    return meta.get("file", "") if meta else ""


def simulated_created(idx, epoch=None, window_days=None, max_window=None):
    """按记录顺序模拟一条时间轴：粗略均匀铺开，并算出 window。

    真实数据集没有逐条时间戳；这样做既能让记录在时间上错开（供动态窗口表使用），
    又完全确定、可复现。window 用于多表索引的“新旧窗口”分层。
    """
    epoch = epoch or EPOCH
    wd = window_days or WINDOW_DAYS
    mw = max_window or MAX_WINDOW
    day_offset = (idx * 7) % ((mw + 1) * wd)   # 7 天一步，循环铺满多个窗口
    d = epoch + datetime.timedelta(days=day_offset)
    window = min(mw, day_offset // wd)
    return d.isoformat(), window


def build_queries(records, rng, n):
    """构造评测查询：70% 文本 / 30% 音频。

    每条查询绑定一条记录（同源）。文本查询内容=<前缀+记录文本>，运行时
    extract_themes(query) 与该记录 themes 口径一致；音频查询带记录的 media_path。
    """
    queries = []
    for j in range(n):
        src = rng.choice(records)
        u = rng.random()
        modality = "text" if u < 0.70 else "audio"
        units = src.get("_units") or []
        media = None
        if modality == "audio":
            for x in units:
                if x["modality"] == "audio":
                    media = x["media_path"]
                    break
        queries.append({
            "query_id": f"RQ{j + 1:04d}",
            "record_id": src["record_id"],
            "text": f"{PUBLIC_PREFIX}{src.get('content', '')}",
            "themes": list(src["themes"]),
            "alert_level": src.get("alert_level", "green"),
            "created_at": src.get("created_at", ""),
            "modality": modality,
            "media_path": media,
        })
    return queries


def attach_units(records, units):
    """把单元挂回记录（内存索引），供查询构造取 media_path。"""
    by_rec = {}
    for u in units:
        by_rec.setdefault(u["record_id"], []).append(u)
    for r in records:
        r["_units"] = by_rec.get(r["record_id"], [])


def make_audio_unit(record_id, ridx, content, wav_path, themes, alert_level,
                    created_at, window, dataset, modality="audio"):
    """构造一条音频单元：抽离线特征，失败返回 None。"""
    feat = audio_feature(wav_path)
    if feat is None:
        return None
    meta = media_meta(wav_path, "audio")
    return {
        "unit_id": f"{record_id}-{MODALITY_SUFFIX[modality]}",
        "record_id": record_id, "modality": modality,
        "content": media_content(meta, "audio"),
        "themes": list(themes), "alert_level": alert_level,
        "created_at": created_at, "window": window,
        "media_path": wav_path, "media_kind": "speech_pcm16",
        "feature": feat, "dataset": dataset, "meta": meta,
    }


def make_text_unit(record_id, content, themes, alert_level, created_at, window,
                   dataset, modality="text", entry=None, context=None, media_meta_val=None):
    """构造一条文本单元（不落 feature，由引擎现场重算）。"""
    return {
        "unit_id": f"{record_id}-{MODALITY_SUFFIX[modality]}",
        "record_id": record_id, "modality": modality,
        "content": content, "themes": list(themes), "alert_level": alert_level,
        "created_at": created_at, "window": window,
        "media_path": None, "media_kind": "self_report",
        "feature": None, "dataset": dataset,
        "meta": {"entry": entry or "", "context": context or ""} if (entry or context) else None,
    }


def make_image_unit(record_id, img_path, themes, alert_level, created_at, window,
                    dataset, media_kind="facial_image"):
    """构造一条图像单元：抽离线 192 维图像特征，失败返回 None。"""
    from app.engines.hashing import real_features as RF
    feat = RF.image_feature(img_path)
    if feat is None:
        return None
    meta = media_meta(img_path, "image")
    return {
        "unit_id": f"{record_id}-{MODALITY_SUFFIX['image']}",
        "record_id": record_id, "modality": "image",
        "content": media_content(meta, "image"),
        "themes": list(themes), "alert_level": alert_level,
        "created_at": created_at, "window": window,
        "media_path": img_path, "media_kind": media_kind,
        "feature": feat, "dataset": dataset, "meta": meta,
    }


def balanced_sample(items, count, rng, key=lambda x: x):
    """按 key 分桶、跨桶等量抽样，保证类别/情绪分布不跑偏。"""
    buckets = {}
    for it in items:
        buckets.setdefault(key(it), []).append(it)
    keys = sorted(buckets.keys(), key=str)
    if len(keys) <= 1:
        return rng.sample(items, min(count, len(items)))
    per = max(1, count // len(keys))
    out = []
    for k in keys:
        out.extend(rng.sample(buckets[k], min(per, len(buckets[k]))))
    rng.shuffle(out)
    return out[:count]
