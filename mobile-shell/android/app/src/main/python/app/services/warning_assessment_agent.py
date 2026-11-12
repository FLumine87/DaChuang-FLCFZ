"""预警研判 Agent（MVP）。

它是一个可审计的规则编排器：汇总匿名证据、图谱路径和已审核规则，再提出
“待人工确认”的处置建议。它不诊断、不自行联系学生、不自动升级预警。
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any


def _due_at(days: int) -> str:
    return (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")


def _review_required(evidence_pack: dict[str, Any], rule_decisions: list[dict[str, Any]]) -> bool:
    if evidence_pack.get("controls", {}).get("requires_human_review"):
        return True
    return any(item.get("requires_human_review") for item in rule_decisions)


def _actions(rule_decisions: list[dict[str, Any]]) -> list[str]:
    seen: set[str] = set()
    actions: list[str] = []
    for decision in rule_decisions:
        for action in decision.get("recommended_actions", []):
            if action not in seen:
                actions.append(action)
                seen.add(action)
    return actions


def build_assessment(
    evidence_pack: dict[str, Any],
    knowledge_paths: list[dict[str, Any]],
    rule_decisions: list[dict[str, Any]],
) -> dict[str, Any]:
    """生成可展示、可确认、可拒绝的研判草案。"""
    screening = evidence_pack.get("screening", {})
    trend = evidence_pack.get("trend", {})
    level = str(screening.get("alert_level") or "green").lower()
    human_review = _review_required(evidence_pack, rule_decisions)
    actions = _actions(rule_decisions)
    delta = trend.get("score_delta_from_previous")
    evidence_summary = [
        f"{screening.get('questionnaire', '量表')} 得分 {screening.get('score', 0)}/{screening.get('max_score', 0)}",
        f"当前预警等级：{level}",
    ]
    if delta is not None:
        direction = "上升" if delta > 0 else ("下降" if delta < 0 else "持平")
        evidence_summary.append(f"与上次筛查相比得分{direction} {abs(delta)}")

    tasks: list[dict[str, Any]] = []
    if "action.rescreen_3d" in actions:
        tasks.append({
            "task_key": "rescreen-3d",
            "title": "安排三日内复筛",
            "due_at": _due_at(3),
            "status": "proposed",
            "requires_confirmation": True,
        })
    if "action.counselor_review" in actions:
        tasks.append({
            "task_key": "counselor-review",
            "title": "分配授权心理工作人员人工复核",
            "due_at": _due_at(1),
            "status": "proposed",
            "requires_confirmation": True,
        })
    if "action.crisis_review" in actions:
        tasks.append({
            "task_key": "crisis-review",
            "title": "按学校既定危机处置流程复核",
            "due_at": _due_at(0),
            "status": "proposed",
            "requires_confirmation": True,
        })

    return {
        "agent_name": "预警研判 Agent",
        "agent_version": "0.1.0",
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "subject_ref": evidence_pack.get("subject_ref"),
        "assessment_status": "pending_human_review" if human_review else "pending_confirmation",
        "diagnosis_allowed": False,
        "automatic_intervention_allowed": False,
        "requires_human_review": human_review,
        "evidence_summary": evidence_summary,
        "knowledge_path_count": len(knowledge_paths),
        "rule_decisions": rule_decisions,
        "proposed_tasks": tasks,
        "operator_actions": ["confirm", "modify", "reject"],
        "notice": "该结果是预警研判辅助草案，不构成心理或医学诊断。",
    }
