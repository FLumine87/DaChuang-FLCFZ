"""CSEMOTIONS 适配器（HF 中文情绪语音数据集，Apache 2.0）。

结构（HF parquet，8 个分片，共 4160 条）：
    data/train-*.parquet  列：audio(dict: bytes/path), text, emotion, speaker
        audio.bytes 是标准 WAV（RIFF，单声道 16bit，48kHz，约 8.5s）
        emotion     ：angry / fearful / happy / neutral / sad / surprise / playfulness
        speaker     ：female001 / female002 ...

处理
----
1. 读取 parquet（需要 pyarrow/pandas，已在项目 venv 安装）；
2. 把音频字节写成 .wav 缓存，供特征抽取与缩略图展示用；
3. 每条 = 1 个 record（text 单元 + audio 单元），文本即该句台词的转写。
"""
import os

from . import base


DATASET_NAME = "CSEMOTIONS"

# 情绪 -> (中文主题, 粗风险标签, 严重度, 预警色)
EMOTION_SPEC = {
    "angry":      ("情绪-愤怒", "high", 3, "orange"),
    "fearful":    ("情绪-恐惧", "high", 3, "orange"),
    "sad":        ("情绪-悲伤", "high", 3, "orange"),
    "happy":      ("情绪-高兴", "low",  2, "green"),
    "surprise":   ("情绪-惊讶", "low",  2, "green"),
    "neutral":    ("情绪-中性", "low",  1, "green"),
    "playfulness":("情绪-调皮", "low",  1, "green"),
}
_COARSE_EMOTION_SET = {e: spec[1] for e, spec in EMOTION_SPEC.items()}

# 情绪 -> FER2013 中语义对应的表情（用于按情绪挂接图像视图；CSEMOTIONS 无图像）
IMAGE_KEY = {
    "angry": "angry", "fearful": "fear", "sad": "sad", "happy": "happy",
    "surprise": "surprise", "neutral": "neutral", "playfulness": "happy",
}


def discover(root):
    import glob
    files = sorted(glob.glob(os.path.join(root, "data", "train-*.parquet")))
    return root, files


def _wav_cache_dir(root):
    # 缓存目录放在数据集下（_audio），不入仓库、不 for 版本管理
    d = os.path.join(root, "_audio")
    os.makedirs(d, exist_ok=True)
    return d


def _write_wav(cache_dir, idx, audio_bytes):
    path = os.path.join(cache_dir, f"cse_{idx:05d}.wav")
    if not os.path.exists(path) or os.path.getsize(path) != len(audio_bytes):
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(audio_bytes)
        os.replace(tmp, path)
    return path


def build(root, rng, records_per_class=None, sample_max=None, num_queries=120, **kw):
    import pandas as pd
    from app.engines.hashing import features as F

    _, files = discover(root)
    if not files:
        raise SystemExit(f"CSEMOTIONS：未在 {root}/data 下找到 train-*.parquet")
    cache_dir = _wav_cache_dir(root)

    # 增量读取 parquet：一旦攒够目标条数就停止，避免为小样本加载全部 3GB。
    target = int(kw.get("max_examples", 0)) or (sample_max or 0)
    max_files = int(kw.get("csemotions_max_files", len(files)))

    frames = []
    loaded = 0
    for f in files[:max_files]:
        frames.append(pd.read_parquet(f, columns=["audio", "text", "emotion", "speaker"]))
        loaded += len(frames[-1])
        if target and loaded >= max(target, 500):
            break
    df = pd.concat(frames, ignore_index=True)

    records, units, skipped = [], [], 0
    ridx = 0
    for i in range(len(df)):
        row = df.iloc[i]
        text = str(row["text"] or "").strip()
        emotion = str(row["emotion"] or "").strip().lower()
        audio_bytes = row["audio"]["bytes"] if isinstance(row["audio"], dict) else b""
        if not text or not audio_bytes:
            continue
        spec = EMOTION_SPEC.get(emotion)
        if spec is None:
            continue
        theme, risk, sev, level = spec

        wav = _write_wav(cache_dir, i, audio_bytes)
        themes = F.extract_themes(text)
        if theme not in themes:
            themes.append(theme)

        ridx += 1
        rid = f"CSEM-{ridx:05d}"
        created, win = base.simulated_created(ridx)
        rec = {
            "record_id": rid, "label": risk,
            "coarse_emotion": _COARSE_EMOTION_SET.get(emotion, risk),
            "themes": themes, "severity": sev, "alert_level": level,
            "created_at": created, "window": win,
            "context": f"CSEMOTIONS {emotion} · {row['speaker']}",
            "entry": text, "content": text,
            "image_keys": [IMAGE_KEY.get(emotion, "neutral")],
        }
        records.append(rec)
        units.append(base.make_text_unit(
            rid, text, themes, level, created, win, DATASET_NAME,
            entry=text, context=rec["context"]))
        au = base.make_audio_unit(
            rid, ridx, "", wav, themes, level, created, win, DATASET_NAME)
        if au is not None:
            units.append(au)
        else:
            skipped += 1

    if sample_max and len(records) > sample_max:
        keep = base.balanced_sample(records, sample_max, rng, key=lambda r: r["label"])
        keep_ids = {r["record_id"] for r in keep}
        records = [r for r in records if r["record_id"] in keep_ids]
        units = [u for u in units if u["record_id"] in keep_ids]

    base.attach_units(records, units)
    queries = base.build_queries(records, rng, num_queries)

    return {
        "records": records, "units": units, "queries": queries,
        "root": root,
        "meta": {
            "dataset_name": DATASET_NAME,
            "n_examples": len(df),
            "wav_cache_dir": cache_dir,
            "n_skipped_audio_feat": skipped,
            "pairing": "utterance level (transcript text <-> same audio, emotion label)",
            "label_rule": "emotion -> 高风险(angry/fearful/sad) / 低风险(happy/surprise/neutral/playfulness)",
            "license": "Apache-2.0",
        },
    }
