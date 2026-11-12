"""Reference labels describe the indexed sample, never the querying person.

Old corpora mixed emotion classes and SDS screening labels into alert colours.
Resolve their provenance at read time as well, so correcting presentation and
assessment does not require rewriting a large corpus or retraining its model.
"""
from __future__ import annotations

import os


EMOTION_TAGS = {
    "情绪-愤怒": "angry", "情绪-恐惧": "fearful", "情绪-悲伤": "sad",
    "情绪-厌恶": "disgust", "情绪-高兴": "happy", "情绪-惊讶": "surprise",
    "情绪-中性": "neutral", "情绪-调皮": "playfulness",
    "情绪-积极": "positive", "情绪-消极": "negative",
}
SDS_POSITIVE_TAGS = {"SDS-抑郁", "SDS-筛查阳性"}
SDS_NEGATIVE_TAGS = {"SDS-正常", "SDS-筛查阴性"}


def reference_labels(meta: dict) -> dict:
    """Return safe, explicit metadata for both legacy and newly built units."""
    media_meta = meta.get("media_meta") or meta.get("meta") or {}
    if not isinstance(media_meta, dict):
        media_meta = {}
    details = {**media_meta, **{k: v for k, v in meta.items() if v is not None}}
    dataset = str(details.get("dataset") or "")
    rid = str(details.get("record_id") or "")
    modality = details.get("modality") or "text"
    tags = list(details.get("tags") or details.get("themes") or [])
    is_fer = "FER" in dataset.upper() or rid.startswith("FER-")
    is_cse = "CSEM" in dataset.upper() or rid.startswith("CSEM-")
    is_eatd = "EATD" in dataset.upper() or rid.startswith("EATD-")
    is_avdd = "AVDD" in dataset.upper() or rid.startswith("AVDD-")
    weak_image = bool(is_fer and modality == "image" and not rid.startswith("FER-"))
    emotion = details.get("emotion_label")
    if not emotion:
        path = str(details.get("media_path") or "").replace("\\", "/")
        parent = os.path.basename(os.path.dirname(path)).lower()
        if is_fer and parent in {"angry", "disgust", "fear", "happy", "neutral", "sad", "surprise"}:
            emotion = parent
        else:
            emotion = next((EMOTION_TAGS[t] for t in tags if t in EMOTION_TAGS), None)

    result = {
        "emotion_label": emotion,
        "screening_label": "unknown",
        "label_source": details.get("label_source") or "business_record",
        "label_validity": "unverified_reference",
        "pairing_type": details.get("pairing_type") or "unspecified",
        "screening_usable": False,
        "reference_only": True,
        "alert_level": details.get("alert_level") or "unknown",
        "label_description": "参考记录标签，不是本次用户结论",
    }
    # FER images attached to EATD/CSEM inherit the record id and old alert colour.
    # Their own source only supplies an expression class, not the subject's SDS.
    if is_fer or is_cse:
        result.update({
            "alert_level": "unknown",
            "label_source": "FER2013/expression" if is_fer else "CSEMOTIONS/emotion",
            "label_validity": "emotion_only",
            "pairing_type": "weak_cross_dataset" if weak_image else (
                "image_only" if is_fer else "same_source_text_audio"),
            "label_description": "仅有情绪或表情标签，心理筛查状态未知",
            "tags": [t for t in tags if not str(t).startswith("SDS-")],
        })
        return result

    if is_avdd:
        explicit = details.get("screening_label")
        if explicit in ("positive", "negative"):
            screening = explicit
        elif "抑郁-阳性" in tags:
            screening = "positive"
        elif "抑郁-阴性" in tags:
            screening = "negative"
        else:
            screening = "unknown"
        result.update({
            "screening_label": screening,
            "label_source": details.get("label_source") or "AVDD-TCMI/HDS 临床诊断",
            "label_validity": details.get("label_validity") or "clinical_diagnosis",
            "pairing_type": details.get("pairing_type") or "same_subject_same_session",
            "screening_usable": screening != "unknown",
            "alert_level": {"positive": "orange", "negative": "green"}.get(screening, "unknown"),
            "label_description": "AVDD-TCMI 同受试者音-图强配对；临床标签仅作研究参考，不是本次用户结论",
        })
        return result

    if is_eatd:
        explicit = details.get("screening_label")
        if explicit in ("positive", "negative"):
            screening = explicit
        elif set(tags) & SDS_POSITIVE_TAGS:
            screening = "positive"
        elif set(tags) & SDS_NEGATIVE_TAGS:
            screening = "negative"
        else:
            screening = "unknown"
        result.update({
            "screening_label": screening,
            "label_source": "EATD-Corpus/SDS",
            "label_validity": "self_report_screening",
            "pairing_type": "same_source_text_audio",
            "screening_usable": screening != "unknown",
            "alert_level": {"positive": "orange", "negative": "green"}.get(screening, "unknown"),
            "label_description": {
                "positive": "参考样本SDS筛查阳性，需进一步评估，非确诊或危机结论",
                "negative": "参考样本SDS筛查阴性，不代表本次用户心理健康",
                "unknown": "参考样本的SDS筛查标签缺失",
            }[screening],
        })
    return result
