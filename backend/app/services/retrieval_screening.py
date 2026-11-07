"""Experimental retrieval-evidence screening; no questionnaire inputs or scores.

Similarity weights describe support among retrieved references, not disease
probability. Units from one record contribute at most one record's weight.
"""
from collections import defaultdict
import base64
import hashlib
import hmac
import json
import math
import time

from app.config import settings
from app.core.exceptions import HttpError
from app.services.screening_assessment import build_assessment, extract_signals

VERSION = "retrieval-evidence-v1"
MIN_SIMILARITY = .60  # engineering relevance gate, not a clinical threshold
POLARITY = {
    "happy": "positive", "positive": "positive", "高兴": "positive", "开心": "positive", "积极": "positive",
    "sad": "negative", "negative": "negative", "angry": "negative", "fear": "negative", "fearful": "negative",
    "disgust": "negative", "悲伤": "negative", "愤怒": "negative", "恐惧": "negative", "消极": "negative",
    "neutral": "neutral", "中性": "neutral", "surprise": "neutral", "playfulness": "positive",
}
FIELDS = ("id", "record_id", "recordId", "modality", "similarity", "summary", "tags", "emotion_label",
          "emotionLabel", "pairing_type", "pairingType", "label_source", "labelSource", "media_meta", "mediaMeta")


def snapshot(query, hits, modality):
    return {"query": str(query or "")[:6000], "modality": modality,
            "hits": [{key: value for key, value in hit.items() if key in FIELDS} for hit in hits[:50]]}


def seal_snapshot(user_id, data):
    payload = {"owner": str(user_id), "expires": int(time.time()) + 86400, "data": data}
    body = base64.urlsafe_b64encode(json.dumps(payload, ensure_ascii=False).encode()).decode()
    signature = hmac.new(settings.SECRET_KEY.encode(), ("retrieval-screening." + body).encode(), hashlib.sha256).hexdigest()
    return body + "." + signature  # deliberately not an authentication JWT


def open_snapshot(token, user_id):
    try:
        body, signature = str(token).split(".")
        expected = hmac.new(settings.SECRET_KEY.encode(), ("retrieval-screening." + body).encode(), hashlib.sha256).hexdigest()
        payload = json.loads(base64.urlsafe_b64decode(body))
        if not hmac.compare_digest(signature, expected) or payload["owner"] != str(user_id) or payload["expires"] < time.time():
            raise ValueError()
        return payload["data"]
    except (ValueError, KeyError, TypeError):
        raise HttpError(400, "本次检索依据已失效，请重新检索")


def build_retrieval_screening(query, hits, *, modality="text", supplement_id=None, observations=None):
    result = build_assessment("", observations=observations, supplement_id=supplement_id)
    weights = defaultdict(lambda: defaultdict(float))
    topics = defaultdict(set)
    refs, used, modalities = [], [], set()
    for hit in hits:
        unit = str(hit.get("id") or "")
        rid = str(hit.get("record_id") or hit.get("recordId") or unit)
        if not unit or not rid or rid.startswith(("sup-", "scr-", "alt-", "case-")):
            continue  # current input / runtime decisions must not echo into evidence
        try:
            sim = float(hit.get("similarity") or 0)
        except (ValueError, TypeError):
            sim = 0
        if not math.isfinite(sim):
            sim = 0
        sim = max(0., min(1., sim))
        tags = [str(t) for t in hit.get("tags", []) if not str(t).startswith("SDS-")]
        emotion = str(hit.get("emotion_label") or hit.get("emotionLabel") or "").lower()
        if not emotion:
            emotion = next((tag.removeprefix("情绪-") for tag in tags if tag.startswith("情绪-")), "")
        polarity = POLARITY.get(emotion)
        dimensions = extract_signals(str(hit.get("summary") or "") + "；" + "；".join(tags))["dimensions"]
        qualified = sim >= MIN_SIMILARITY and bool(polarity or dimensions)
        mode = str(hit.get("modality") or "text")
        reason = "低相关或没有可解释标签，不参与初筛汇总"
        if qualified:
            # Conflicting views remain visible; three units never become three people.
            if polarity:
                weights[rid][polarity] = max(weights[rid][polarity], sim)
            topics[rid].update(dimensions)
            modalities.add(mode)
            used.append(unit)
            reason = "用于初筛结论：" + "、".join(([emotion] if polarity else []) + dimensions) + "；同记录去重，不沿用风险颜色或量表标签"
        refs.append({"id": unit, "recordId": rid, "modality": mode, "similarity": sim,
                     "usage": "screening" if qualified else "candidate", "matchedDimensions": dimensions,
                     "reason": reason, "questionIds": []})
    totals = defaultdict(float)
    for values in weights.values():
        total = sum(values.values())
        if total:
            cap = max(values.values())
            for key, value in values.items():
                totals[key] += cap * value / total
    total = sum(totals.values())
    shares = {key: round(totals[key] / total, 4) if total else 0 for key in ("positive", "negative", "neutral")}
    topic_counts = defaultdict(int)
    for dimensions in topics.values():
        for dimension in dimensions:
            topic_counts[dimension] += 1
    names = {"sleep": "睡眠困扰", "interest": "兴趣下降", "low_mood": "低落情绪", "anger": "愤怒烦躁",
             "anxiety": "紧张担忧", "energy": "精力不足", "stress": "压力困扰"}
    matched_topics = [names[key] for key in sorted(topic_counts)]
    count = len(topics)
    level, label, status = None, "依据不足", "ready"
    if not used:
        conclusion = "本次检索缺少相关且可解释的参考结果，暂不能形成可靠的心理初筛结论。可更换输入或补充同一近况的其他模态。"
    elif shares["positive"] >= .6 and shares["negative"] < .25 and not matched_topics:
        level, label = "green", "积极情绪匹配"
        conclusion = "本次多模态检索以积极情绪参考模式为主，暂未检出明显负性情绪匹配。该结论仅针对本次匹配，不代表已排除心理问题。"
    elif shares["negative"] >= .6:
        level, label = "yellow", "负性情绪线索 · 建议关注"
        conclusion = "本次多模态检索以负性情绪参考模式为主，提示可能存在需要关注的情绪困扰线索。建议结合实际感受持续观察，困扰持续或影响生活时寻求专业支持。"
    elif shares["positive"] >= .25 and shares["negative"] >= .25:
        level, label = "yellow", "匹配结果存在分歧"
        conclusion = "本次检索同时命中积极和负性情绪模式，匹配依据存在分歧，暂不归为单一状态；建议补充同一近况的其他模态以核实。"
    elif matched_topics:
        level, label = "yellow", "心理相关线索 · 建议关注"
        conclusion = "本次检索集中匹配到" + "、".join(matched_topics) + "相关模式，初步建议关注这些方面；匹配到参考模式不等于已确认本人存在相同症状。"
    else:
        label = "中性或不明确的匹配"
        conclusion = "本次检索主要匹配中性或不明确的情绪模式，尚未形成明确的风险指向；可保留本次结果观察变化。"
    if extract_signals(query)["safetySignal"]:
        level, label, status = "red", "安全线索待及时复核", "needs_human_review"
        result["safetyStatus"] = "needs_review"
        conclusion = "本人输入包含需要及时核实的安全线索，应优先由专业人员评估；检索匹配不能覆盖该线索。"
    elif result["repeatedNegative"].get("triggered"):
        level, label, status = "orange", "重复负面记录 · 待复核", "needs_human_review"
        conclusion += "本人近期多个不同日期的负面记录另达到关注规则，建议人工复核。"
    distribution = [{"label": name, "support": shares[key]} for key, name in (("positive", "积极"), ("negative", "负性"), ("neutral", "中性"))]
    result.update({"analysisMode": "retrieval", "queryModality": modality, "level": level, "levelLabel": label,
        "status": status, "conclusion": conclusion, "questions": [], "missingFields": [], "recommendedScales": [],
        "screeningId": None, "scaleResult": None, "ruleVersion": VERSION,
        "references": refs, "retrievalContribution": f"采用{len(used)}个检索单元、按{count}条来源记录去重汇总情绪和心理相关模式，直接形成上方初筛结论。",
        "nextAction": {"type": "review" if status == "needs_human_review" else "finish", "label": "查看专业复核建议" if status == "needs_human_review" else "保留本次初筛结果，按需补充其他模态观察变化"},
        "evidence": [{"id": "references", "label": "采用的检索结果", "value": f"{len(used)}个单元 / {count}条来源记录", "source": "本次实际命中，经来源去重"},
                     {"id": "coverage", "label": "检索模态覆盖", "value": "、".join(sorted(modalities)) or "暂无可用参考", "source": "命中单元，不代表本人同时提交这些模态"},
                     {"id": "topics", "label": "心理相关参考主题", "value": "、".join(matched_topics) or "未匹配明确的困扰主题", "source": "检索样本内容与标签"},
                     {"id": "patterns", "label": "参考模式支持占比", "value": "；".join(f"{item['label']} {item['support']:.0%}" for item in distribution), "source": "相似度加权、同记录去重；不是患病概率"}],
        "trace": [{"step": "本次实际检索", "detail": f"输入模态{modality}；汇总该次返回结果，不重新用文字替代图像或语音检索"},
                  {"step": "筛选与去重", "detail": f"相关性门槛{MIN_SIMILARITY}，同源记录总权重受限；弱配对不视为本人证据", "referenceIds": used},
                  {"step": "初筛结论", "detail": "根据参考情绪标签和心理相关模式汇总；不读取量表答案、分数或参考风险颜色"},
                  {"step": "适用局限", "detail": "工程原型尚未验证临床效度；样本配对及标注质量会影响结论，不能据此确诊或排除疾病"}]})
    return result
