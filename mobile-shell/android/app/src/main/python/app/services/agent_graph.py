"""可审计的预警知识图谱运行服务。

此模块只处理经审核的规则和匿名证据包；不读取姓名、电话、原始作答或备注。
"""
from __future__ import annotations

import json

from app.db import database as db


_ENTITIES = (
    ("scale.phq9", "scale", "PHQ-9", "抑郁症状筛查量表"),
    ("scale.gad7", "scale", "GAD-7", "焦虑症状筛查量表"),
    ("feature.sleep_difficulty", "feature", "睡眠困难", "非诊断性筛查线索"),
    ("feature.stress_overload", "feature", "压力负荷升高", "非诊断性筛查线索"),
    ("risk.monitor", "risk_state", "持续观察", "需结合后续筛查变化判断"),
    ("risk.manual_review", "risk_state", "人工复核", "须由授权人员确认"),
    ("alert.yellow", "alert_level", "黄色预警", "建议短期复筛"),
    ("alert.orange", "alert_level", "橙色预警", "须人工研判"),
    ("alert.red", "alert_level", "红色预警", "须优先人工研判"),
    ("action.rescreen_3d", "action", "三日内复筛", "由人工确认后安排"),
    ("action.counselor_review", "action", "心理老师复核", "由具备权限人员研判"),
    ("action.crisis_review", "action", "应急流程复核", "按学校制度执行"),
)
_RELATIONS = (
    ("feature.sleep_difficulty", "SUPPORTS", "risk.monitor", 0.7),
    ("feature.stress_overload", "SUPPORTS", "risk.monitor", 0.7),
    ("risk.monitor", "MAPS_TO", "alert.yellow", 1.0),
    ("risk.monitor", "RECOMMENDS", "action.rescreen_3d", 1.0),
    ("risk.manual_review", "MAPS_TO", "alert.orange", 1.0),
    ("risk.manual_review", "MAPS_TO", "alert.red", 1.0),
    ("risk.manual_review", "RECOMMENDS", "action.counselor_review", 1.0),
    ("alert.red", "REQUIRES_REVIEW", "action.crisis_review", 1.0),
)
_RULES = (
    ("agent.yellow-rescreen", "黄色预警复筛建议", 20, {"alert_levels": ["yellow"]},
     {"requires_human_review": False, "recommended_actions": ["action.rescreen_3d"],
      "message": "建议由人工确认后安排三日内复筛。"}),
    ("agent.high-risk-human-review", "橙红预警人工复核", 100,
     {"alert_levels": ["orange", "red"]},
     {"requires_human_review": True, "recommended_actions": ["action.counselor_review"],
      "message": "须由授权心理工作人员进行人工复核；系统不作诊断结论。"}),
    ("agent.red-crisis-review", "红色预警应急复核", 110, {"alert_levels": ["red"]},
     {"requires_human_review": True, "recommended_actions": ["action.crisis_review"],
      "message": "请按学校既定危机处置制度，由人工确认后启动相应流程。"}),
)


async def ensure_seeded() -> None:
    for key, kind, name, description in _ENTITIES:
        await db.execute_a(
            "INSERT OR IGNORE INTO kg_entities "
            "(entity_key, entity_type, name, description, source, source_version, review_status) "
            "VALUES (?, ?, ?, ?, 'project-rule-set', '1.0', 'approved')",
            (key, kind, name, description),
        )
    for subject, predicate, object_key, confidence in _RELATIONS:
        await db.execute_a(
            "INSERT OR IGNORE INTO kg_relations "
            "(subject_key, predicate, object_key, confidence, source, review_status) "
            "VALUES (?, ?, ?, ?, 'project-rule-set', 'approved')",
            (subject, predicate, object_key, confidence),
        )
    for key, name, priority, condition, action in _RULES:
        await db.execute_a(
            "INSERT OR IGNORE INTO kg_rules "
            "(rule_key, name, priority, condition_json, action_json, source, review_status, is_active) "
            "VALUES (?, ?, ?, ?, ?, 'project-rule-set', 'approved', 1)",
            (key, name, priority, json.dumps(condition, ensure_ascii=False),
             json.dumps(action, ensure_ascii=False)),
        )


async def evaluate(evidence_pack: dict) -> list[dict]:
    level = str(evidence_pack.get("screening", {}).get("alert_level") or "").lower()
    rows = await db.query_a(
        "SELECT rule_key, name, priority, condition_json, action_json FROM kg_rules "
        "WHERE is_active = 1 AND review_status = 'approved' ORDER BY priority DESC, id"
    )
    decisions = []
    for row in rows:
        try:
            condition = json.loads(row["condition_json"])
            action = json.loads(row["action_json"])
        except (KeyError, TypeError, json.JSONDecodeError):
            continue
        if level not in condition.get("alert_levels", []):
            continue
        decisions.append({
            "rule_key": row["rule_key"],
            "rule_name": row["name"],
            "priority": row["priority"],
            "requires_human_review": bool(action.get("requires_human_review")),
            "recommended_actions": action.get("recommended_actions", []),
            "message": action.get("message", ""),
        })
    return decisions


async def evidence_paths(evidence_pack: dict) -> list[dict]:
    screening = evidence_pack.get("screening", {})
    trend = evidence_pack.get("trend", {})
    level = str(screening.get("alert_level") or "").lower()
    questionnaire = str(screening.get("questionnaire") or "").upper()
    scale = "scale.gad7" if "GAD" in questionnaire else "scale.phq9"
    feature = "feature.stress_overload" if (trend.get("score_delta_from_previous") or 0) > 0 else "feature.sleep_difficulty"
    if level == "yellow":
        keys = [scale, feature, "risk.monitor", "alert.yellow", "action.rescreen_3d"]
        links = [(feature, "SUPPORTS", "risk.monitor"),
                 ("risk.monitor", "MAPS_TO", "alert.yellow"),
                 ("risk.monitor", "RECOMMENDS", "action.rescreen_3d")]
        reason = "当前为黄色预警；该路径仅提出复筛建议，不构成心理诊断。"
    elif level in ("orange", "red"):
        action = "action.crisis_review" if level == "red" else "action.counselor_review"
        keys = [scale, feature, "risk.manual_review", f"alert.{level}", action]
        links = [("risk.manual_review", "MAPS_TO", f"alert.{level}"),
                 ("risk.manual_review", "RECOMMENDS", "action.counselor_review")]
        if level == "red":
            links.append(("alert.red", "REQUIRES_REVIEW", "action.crisis_review"))
        reason = "当前预警等级要求人工复核；系统不自动下达干预或诊断结论。"
    else:
        return []
    placeholders = ",".join("?" for _ in keys)
    rows = await db.query_a(
        f"SELECT entity_key, entity_type, name, description FROM kg_entities "
        f"WHERE review_status = 'approved' AND entity_key IN ({placeholders})", keys)
    entities = {row["entity_key"]: row for row in rows}
    return [{
        "path_id": f"screening-alert-{level}",
        "nodes": [entities[key] for key in keys if key in entities],
        "relations": [{"subject_key": s, "predicate": p, "object_key": o} for s, p, o in links],
        "reason": reason,
    }]


async def overview() -> dict:
    entities = await db.query_one_a("SELECT COUNT(*) AS count FROM kg_entities")
    relations = await db.query_one_a("SELECT COUNT(*) AS count FROM kg_relations")
    rules = await db.query_one_a("SELECT COUNT(*) AS count FROM kg_rules WHERE is_active = 1")
    return {
        "entity_count": entities["count"] if entities else 0,
        "relation_count": relations["count"] if relations else 0,
        "active_rule_count": rules["count"] if rules else 0,
        "scope": "预警研判辅助；不用于自动诊断或自动干预。",
    }
