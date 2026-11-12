"""筛查 Agent 的匿名化证据包。"""
from __future__ import annotations

import hashlib
import hmac
from typing import Any, Dict, Iterable, List, Optional

from app.config import settings

EVIDENCE_SCHEMA_VERSION = "1.0"
HUMAN_REVIEW_LEVELS = frozenset({"orange", "red"})


def _as_number(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _pseudonymize(source: Any) -> Optional[str]:
    """返回稳定的 HMAC 化引用；未配置密钥时不生成可外发引用。"""
    key = (getattr(settings, "AGENT_PSEUDONYM_KEY", "") or "").strip()
    if not key or source is None:
        return None
    digest = hmac.new(
        key.encode("utf-8"), str(source).encode("utf-8"), hashlib.sha256,
    ).hexdigest()[:16]
    return f"subject-{digest}"


def _trend_summary(current: Dict, history: Iterable[Dict]) -> Dict:
    """从同一 case 的既往去标识化记录中提取趋势，不保留历史原文。"""
    prior = [row for row in (history or []) if row.get("id") != current.get("id")]
    prior = sorted(
        prior,
        key=lambda row: str(row.get("screening_date") or row.get("created_at") or ""),
        reverse=True,
    )
    current_score = _as_number(current.get("score"))
    previous_score = _as_number(prior[0].get("score")) if prior else None
    score_delta = None
    if current_score is not None and previous_score is not None:
        score_delta = round(current_score - previous_score, 2)

    return {
        "available": bool(prior),
        "prior_screening_count": len(prior),
        "score_delta_from_previous": score_delta,
        "previous_alert_level": prior[0].get("alert_level") if prior else None,
        "current_alert_level": current.get("alert_level") or "green",
    }


def _retrieval_summary(retrieval_results: Optional[Dict]) -> Dict:
    """只保留聚合相似模式，不泄露命中个案的摘要、标识或原始数据。"""
    if not retrieval_results:
        return {
            "available": False,
            "matched_count": 0,
            "high_risk_match_count": 0,
            "modalities": [],
            "shared_themes": [],
        }

    hits = retrieval_results.get("results") or []
    modalities, themes = set(), set()
    high_risk_match_count = 0
    for hit in hits:
        if hit.get("modality"):
            modalities.add(str(hit["modality"]))
        if hit.get("alert_level") in HUMAN_REVIEW_LEVELS:
            high_risk_match_count += 1
        explain = hit.get("explain") or {}
        themes.update(str(theme) for theme in (explain.get("shared_themes") or []) if theme)
        themes.update(str(tag) for tag in (hit.get("tags") or []) if tag)

    return {
        "available": True,
        "matched_count": len(hits),
        "high_risk_match_count": high_risk_match_count,
        "modalities": sorted(modalities),
        "shared_themes": sorted(themes)[:12],
    }


def build_evidence_pack(
    screening: Dict,
    history: Optional[List[Dict]] = None,
    retrieval_results: Optional[Dict] = None,
    knowledge_paths: Optional[List[Dict]] = None,
) -> Dict:
    """构建可审计、去标识化的 Agent 证据包。

    ``screening`` 可以是数据库原始行；本函数只白名单读取安全字段，因此调用方
    无须手动删除姓名、联系方式、原始作答或自由文本。
    """
    alert_level = str(screening.get("alert_level") or "green").lower()
    consent_status = str(screening.get("consent_status") or "unknown").lower()
    questionnaire = screening.get("questionnaire_name") or screening.get("questionnaire") or "未知量表"
    subject_ref = _pseudonymize(screening.get("case_id") or screening.get("id"))
    trend = _trend_summary(screening, history or [])
    retrieval = _retrieval_summary(retrieval_results)
    external_llm_allowed = bool(
        consent_status == "approved"
        and getattr(settings, "AGENT_ALLOW_EXTERNAL_LLM", False)
        and subject_ref
    )
    screening_summary = {
        "questionnaire": str(questionnaire),
        "score": screening.get("score"),
        "max_score": screening.get("max_score"),
        "alert_level": alert_level,
        "screening_date": str(screening.get("screening_date") or screening.get("created_at") or "")[:19],
        "consent_status": consent_status,
    }
    local_query = (
        f"{screening_summary['questionnaire']} "
        f"得分{screening_summary['score']}/{screening_summary['max_score']} "
        f"{alert_level}预警"
    )

    return {
        "schema_version": EVIDENCE_SCHEMA_VERSION,
        "subject_ref": subject_ref,
        "screening": screening_summary,
        "trend": trend,
        "retrieval": retrieval,
        "knowledge_paths": knowledge_paths or [],
        "controls": {
            "diagnosis_allowed": False,
            "requires_human_review": alert_level in HUMAN_REVIEW_LEVELS,
            "external_llm_allowed": external_llm_allowed,
            "rule_set_version": getattr(settings, "AGENT_RULESET_VERSION", "1.0"),
        },
        "local_retrieval_query": local_query,
        "rag_context": {
            "subject_ref": subject_ref or "匿名筛查对象",
            "questionnaire": screening_summary["questionnaire"],
            "score": screening_summary["score"],
            "max_score": screening_summary["max_score"],
            "alert_level": alert_level,
            "trend": trend,
            "retrieval": retrieval,
            "external_llm_allowed": external_llm_allowed,
            "diagnosis_allowed": False,
        },
    }
