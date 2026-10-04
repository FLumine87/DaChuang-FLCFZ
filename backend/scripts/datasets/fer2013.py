"""FER2013 适配器（Kaggle 人脸表情识别，48×48 灰度面部图像）。

结构（解压后 Kaggle `archive` 包）：
    archive/train/{angry,disgust,fear,happy,neutral,sad,surprise}/*.jpg
    archive/test/{...}/*.jpg

处理
----
* 每条 = 1 张 48×48 灰度面部图像 + 其表情类别；
* 情感主题与 CSEMOTIONS 的 EMOTION_SPEC 命名对齐（如 happy→"情绪-高兴"、
  sad→"情绪-悲伤"），使 CMFH 的跨模态监督能借同主题把 image 编码与
  text/audio 编码对齐（弱监督跨模态对齐）；
* label="high"/"low"（与合并语料的粗风险口径一致），sad/angry/fear/disgust→high。
"""
import os

from . import base


DATASET_NAME = "FER2013"

# 表情 -> (中文主题, 粗风险, 严重度, 预警色)，与 CSEMOTIONS.EMOTION_SPEC 命名对齐
EMOTION_SPEC = {
    "angry":    ("情绪-愤怒", "high", 3, "orange"),
    "disgust":  ("情绪-厌恶", "high", 3, "orange"),
    "fear":     ("情绪-恐惧", "high", 3, "orange"),
    "sad":      ("情绪-悲伤", "high", 3, "orange"),
    "happy":    ("情绪-高兴", "low",  2, "green"),
    "surprise": ("情绪-惊讶", "low",  2, "green"),
    "neutral":  ("情绪-中性", "low",  1, "green"),
}


def discover(root):
    """返回 train/test 两个已按类别分目录的输入。"""
    cands = [os.path.join(root, "archive", "train"),
             os.path.join(root, "archive", "test"),
             os.path.join(root, "train"),
             os.path.join(root, "test")]
    split = None
    for c in cands:
        if os.path.isdir(c):
            split = c
            break
    if split is None:
        raise SystemExit(f"FER2013：未在 {root} 下找到 train/test 类别目录")
    clss = [d for d in os.listdir(split)
            if os.path.isdir(os.path.join(split, d))]
    if not clss:
        raise SystemExit(f"FER2013：{split} 下没有类别目录")
    return split, clss


def image_pool(root, per_class=0, seed=42):
    """返回 {fer_emotion: [image_paths]}，供「文本+语音」记录按情绪挂接图像视图。

    FER2013 是纯图像数据（每张图无同源的文本/语音）。当它与 EATD/CSEMOTIONS
    合并时，若作为独立记录加入会导致记录的模态集合不一致 —— 引擎的配对训练
    要求同组记录模态对齐，否则图像/语音编码器学不到东西。因此它的图像按
    **情绪对齐**挂到已有记录上，使每条记录都具备 text + audio + image 三视图。
    """
    import random as _random
    rng = _random.Random(seed)
    split, clss = discover(root)
    pool = {}
    for cls in sorted(clss):
        emo = cls.lower()
        if emo not in EMOTION_SPEC:
            continue
        d = os.path.join(split, cls)
        files = [f for f in os.listdir(d)
                 if f.lower().endswith((".jpg", ".jpeg", ".png"))]
        rng.shuffle(files)
        if per_class:
            files = files[:per_class]
        pool[emo] = [os.path.join(d, f) for f in files]
    return pool


def build(root, rng, records_per_class=None, sample_max=None, num_queries=0, **kw):
    from app.engines.hashing import real_features as RF  # noqa

    split, clss = discover(root)
    # 每类可控：records_per_class 优先，否则由 sample_max 均分，默认每类 150
    if records_per_class:
        per_class = int(records_per_class)
    elif sample_max:
        per_class = max(1, int(sample_max) // max(1, len(clss)))
    else:
        per_class = 120

    records, units = [], []
    ridx = 0
    for cls in sorted(clss):
        emo = cls.lower()
        spec = EMOTION_SPEC.get(emo)
        if spec is None:
            continue
        theme, risk, sev, level = spec
        d = os.path.join(split, cls)
        files = [f for f in os.listdir(d) if f.lower().endswith((".jpg", ".jpeg", ".png"))]
        rng.shuffle(files)
        for fn in files[:per_class]:
            img = os.path.join(d, fn)
            ridx += 1
            rid = f"FER-{ridx:06d}"
            created, win = base.simulated_created(ridx)
            rec = {
                "record_id": rid, "label": risk, "themes": [theme],
                "severity": sev, "alert_level": level,
                "created_at": created, "window": win,
                "context": f"FER2013 {emo}（48×48 灰度面部图像）",
                "entry": theme, "content": theme,
            }
            records.append(rec)
            iu = base.make_image_unit(
                rid, img, [theme], level, created, win, DATASET_NAME)
            if iu is not None:
                units.append(iu)

    base.attach_units(records, units)
    queries = base.build_queries(records, rng, num_queries)

    return {
        "records": records, "units": units, "queries": queries,
        "root": split,
        "meta": {
            "dataset_name": DATASET_NAME,
            "split_dir": split,
            "classes": {c: EMOTION_SPEC.get(c.lower(), ("?", "?", 0, "?"))[0]
                        for c in sorted(clss) if c.lower() in EMOTION_SPEC},
            "per_class": per_class,
            "pairing": "image only; emotion -> 高/低风险 (same naming as CSEMOTIONS)",
            "label_rule": "sad/angry/fear/disgust -> high; happy/surprise/neutral -> low",
            "license": "ODbL (FER2013) / research use",
        },
    }
