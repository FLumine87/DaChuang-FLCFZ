"""EATD-Corpus 适配器（ICASSP 2022 中文抑郁语音-文本语料）。

结构
----
EATD-Corpus/EATD-Corpus/{t_*, v_*}  # 162 名受试者（83 t_ + 79 v_）
    每名受试者一个文件夹，含三个语气的问答：
        positive.{wav,txt}   positive_out.wav
        neutral.{wav,txt}     neutral_out.wav
        negative.{wav,txt}    negative_out.wav
        label.txt             = 原始 SDS 自评抑郁量表分（乘 1.25 前的粗分）
        new_label.txt         = 标准化分（= 粗分×1.25，≥53 记为抑郁，论文口径）

配对来自数据本身（受试者级 + 语句级）：WAV 与同名 .txt 转写是同一句作答，
这是跨模态检索同源目标的真实来源（T1 不再不可辨识）。
"""
import os

from . import base


DATASET_NAME = "EATD-Corpus"
VALIDENCES = ("positive", "neutral", "negative")
VALENCE_THEME = {"positive": "情绪-积极", "neutral": "情绪-中性", "negative": "情绪-消极"}

SDS_THRESHOLD = 53.0        # new_label >= 53 → 抑郁（数据集论文口径：30/132）


def discover(root):
    """返回受试者目录列表（按名称自然排序稳定）。"""
    inner = root
    # 兼容 EATD-Corpus/EATD-Corpus/ 双层目录
    if os.path.isdir(os.path.join(root, "EATD-Corpus")):
        inner = os.path.join(root, "EATD-Corpus")
    subs = [d for d in os.listdir(inner)
            if os.path.isdir(os.path.join(inner, d))]
    return inner, sorted(subs)


def _read_sds(inner, sub):
    label, new_label = None, None
    try:
        label = float(open(os.path.join(inner, sub, "label.txt"),
                           encoding="utf-8").read().strip())
    except Exception:
        pass
    try:
        new_label = float(open(os.path.join(inner, sub, "new_label.txt"),
                               encoding="utf-8").read().strip())
    except Exception:
        new_label = label
    return label, new_label


def build(root, rng, records_per_class=None, sample_max=None, **kw):
    from app.engines.hashing import features as F

    inner, subs = discover(root)
    if not subs:
        raise SystemExit(f"EATD-Corpus：未在 {root} 下找到任何受试者目录")

    records, units = [], []

    # 先解析全部受试者 + 三个语气的文本/音频，保证顺序确定、可复现
    all_samples = []     # (sub, valence, label_str, new_label, themes, text, wav)
    for sub in sorted(subs):
        _, new_label = _read_sds(inner, sub)
        label = "Depressed" if (new_label is not None and new_label >= SDS_THRESHOLD) else "Normal"
        for v in VALIDENCES:
            wav = os.path.join(inner, sub, f"{v}.wav")
            txt = os.path.join(inner, sub, f"{v}.txt")
            if not (os.path.exists(wav) and os.path.exists(txt)):
                continue
            try:
                text = open(txt, encoding="utf-8").read().strip()
            except Exception:
                text = ""
            if not text:
                continue
            themes = F.extract_themes(text)
            for extra in (base_theme(label), VALENCE_THEME[v]):
                if extra and extra not in themes:
                    themes.append(extra)
            all_samples.append({
                "sub": sub, "valence": v, "label": label,
                "new_label": new_label, "themes": themes,
                "text": text, "wav": wav,
            })

    dep = [s for s in all_samples if s["label"] == "Depressed"]
    nor = [s for s in all_samples if s["label"] == "Normal"]
    # 类别不均衡（30:132 受试者）是真实性质，默认不强行均衡；如需可以对每类限数
    chosen = []
    for s in all_samples:
        chosen.append(s)
    if sample_max:
        chosen = base.balanced_sample(chosen, sample_max, rng, key=lambda s: s["label"])

    ridx = 0
    for s in chosen:
        ridx += 1
        rid = f"EATD-{ridx:04d}"
        created, win = base.simulated_created(ridx)
        sev = 4 if s["label"] == "Depressed" else 2
        level = "red" if s["label"] == "Depressed" else (
            "green" if s["valence"] in ("positive", "neutral") else "yellow")

        rec = {
            "record_id": rid, "label": s["label"], "themes": list(s["themes"]),
            "severity": sev, "alert_level": level,
            "created_at": created, "window": win,
            "context": f"EATD-Corpus {s['sub']} {s['valence']}（SDS 标准化分 {s['new_label']:.2f}）",
            "entry": s["text"],
            "content": s["text"],
            # 供「按情绪挂接图像视图」使用（EATD 本身只有文本+语音，无图像）
            "image_keys": (["sad", "fear", "angry"] if s["label"] == "Depressed"
                           else ["neutral", "happy"]),
        }
        records.append(rec)

        tu = base.make_text_unit(
            rid, s["text"], s["themes"], level, created, win, DATASET_NAME,
            entry=s["text"], context=rec["context"])
        units.append(tu)
        au = base.make_audio_unit(
            rid, ridx, "", s["wav"], s["themes"], level, created, win, DATASET_NAME)
        if au is not None:
            units.append(au)
        # 若音频特征抽取失败，保留文本单元，仍可做文本内检索

    base.attach_units(records, units)
    queries = base.build_queries(records, rng, kw.get("num_queries", 120))

    n_dep = sum(1 for r in records if r["label"] == "Depressed")
    return {
        "records": records, "units": units, "queries": queries,
        "root": inner,
        "meta": {
            "dataset_name": DATASET_NAME,
            "subjects": len(subs),
            "n_depressed": n_dep,
            "n_normal": len(records) - n_dep,
            "sds_threshold": repr(SDS_THRESHOLD),
            "pairing": "subject+utterance level (wav <-> same-name txt, real SDS label)",
            "label_rule": f"new_label(SDS×1.25) >= {SDS_THRESHOLD:.0f} -> Depressed",
            "note": "1 record = 1 subject × 1 valence(positive/neutral/negative); text+audio same statement",
        },
    }


def base_theme(label):
    return "SDS-抑郁" if label == "Depressed" else "SDS-正常"
