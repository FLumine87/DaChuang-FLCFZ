"""预警知识图谱 MVP。

图谱保存的是审核通过的规则、概念和关系，不保存自由文本病历，也不输出诊断。
运行时根据匿名证据包生成“证据路径”，给前端和人工审核者解释推荐动作。
"""
from __future__ import annotations

import json
from typing import Any

from app.db.database import fetch_all, fetch_one, execute


SEED_ENTITIES = (
    ("scale.phq9", "scale", "PHQ-9", "抑郁症状筛查量表", "project-rule-set", "1.0"),
    ("scale.gad7", "scale", "GAD-7", "焦虑症状筛查量表", "project-rule-set", "1.0"),
    ("feature.sleep_difficulty", "feature", "睡眠困难", "筛查中的非诊断性风险线索", "project-rule-set", "1.0"),
    ("feature.stress_overload", "feature", "压力负荷升高", "筛查中的非诊断性风险线索", "project-rule-set", "1.0"),
    ("risk.monitor", "risk_state", "持续观察", "需结合后续筛查变化判断", "project-rule-set", "1.0"),
    ("risk.manual_review", "risk_state", "人工复核", "须由授权人员确认的预警状态", "project-rule-set", "1.0"),
    ("alert.yellow", "alert_level", "黄色预警", "建议短期复筛", "project-rule-set", "1.0"),
    ("alert.orange", "alert_level", "橙色预警", "须人工研判", "project-rule-set", "1.0"),
    ("alert.red", "alert_level", "红色预警", "须优先人工研判和应急处置", "project-rule-set", "1.0"),
    ("action.rescreen_3d", "action", "三日内复筛", "由人工确认后安排", "project-rule-set", "1.0"),
    ("action.counselor_review", "action", "心理老师复核", "由具备权限的人员研判", "project-rule-set", "1.0"),
    ("action.crisis_review", "action", "应急流程复核", "按学校既定危机处置制度执行", "project-rule-set", "1.0"),
)

SEED_RELATIONS = (
    ("feature.sleep_difficulty", "SUPPORTS", "risk.monitor", 0.7, "project-rule-set", None),
    ("feature.stress_overload", "SUPPORTS", "risk.monitor", 0.7, "project-rule-set", None),
    ("risk.monitor", "MAPS_TO", "alert.yellow", 1.0, "project-rule-set", None),
    ("risk.monitor", "RECOMMENDS", "action.rescreen_3d", 1.0, "project-rule-set", None),
    ("risk.manual_review", "MAPS_TO", "alert.orange", 1.0, "project-rule-set", None),
    ("risk.manual_review", "MAPS_TO", "alert.red", 1.0, "project-rule-set", None),
    ("risk.manual_review", "RECOMMENDS", "action.counselor_review", 1.0, "project-rule-set", None),
    ("alert.red", "REQUIRES_REVIEW", "action.crisis_review", 1.0, "project-rule-set", None),
)

SEED_RULES = (
    (
        "agent.yellow-rescreen",
        "黄色预警复筛建议",
        20,
        {"alert_levels": ["yellow"]},
        {
            "requires_human_review": False,
            "recommended_actions": ["action.rescreen_3d"],
            "message": "建议由人工确认后安排三日内复筛。",
        },
    ),
    (
        "agent.high-risk-human-review",
        "橙红预警人工复核",
        100,
        {"alert_levels": ["orange", "red"]},
        {
            "requires_human_review": True,
            "recommended_actions": ["action.counselor_review"],
            "message": "须由授权心理工作人员进行人工复核；系统不作诊断结论。",
        },
    ),
    (
        "agent.red-crisis-review",
        "红色预警应急复核",
        110,
        {"alert_levels": ["red"]},
        {
            "requires_human_review": True,
            "recommended_actions": ["action.crisis_review"],
            "message": "请按学校既定危机处置制度，由人工确认后启动相应流程。",
        },
    ),
)


async def ensure_seeded() -> None:
    """幂等写入审核过的 MVP 图谱。"""
    for entity_key, entity_type, name, description, source, version in SEED_ENTITIES:
        await execute(
            """
            INSERT OR IGNORE INTO kg_entities
            (entity_key, entity_type, name, description, source, source_version, review_status)
            VALUES (?, ?, ?, ?, ?, ?, 'approved')
            """,
            (entity_key, entity_type, name, description, source, version),
        )
    for subject_key, predicate, object_key, confidence, source, rule_id in SEED_RELATIONS:
        await execute(
            """
            INSERT OR IGNORE INTO kg_relations
            (subject_key, predicate, object_key, confidence, source, rule_id, review_status)
            VALUES (?, ?, ?, ?, ?, ?, 'approved')
            """,
            (subject_key, predicate, object_key, confidence, source, rule_id),
        )
    for rule_key, name, priority, condition, action in SEED_RULES:
        await execute(
            """
            INSERT OR IGNORE INTO kg_rules
            (rule_key, name, priority, condition_json, action_json, source, review_status, is_active)
            VALUES (?, ?, ?, ?, ?, 'project-rule-set', 'approved', 1)
            """,
            (rule_key, name, priority, json.dumps(condition, ensure_ascii=False),
             json.dumps(action, ensure_ascii=False)),
        )


def _matches_condition(condition: dict[str, Any], evidence_pack: dict[str, Any]) -> bool:
    level = str(evidence_pack.get("screening", {}).get("alert_level") or "").lower()
    accepted_levels = condition.get("alert_levels")
    return not accepted_levels or level in accepted_levels


async def evaluate_rules(evidence_pack: dict[str, Any]) -> list[dict[str, Any]]:
    rows = await fetch_all(
        """
        SELECT rule_key, name, priority, condition_json, action_json
        FROM kg_rules
        WHERE is_active = 1 AND review_status = 'approved'
        ORDER BY priority DESC, id ASC
        """
    )
    decisions: list[dict[str, Any]] = []
    for row in rows:
        try:
            condition = json.loads(row["condition_json"])
            action = json.loads(row["action_json"])
        except (KeyError, TypeError, json.JSONDecodeError):
            continue
        if _matches_condition(condition, evidence_pack):
            decisions.append(
                {
                    "rule_key": row["rule_key"],
                    "rule_name": row["name"],
                    "priority": row["priority"],
                    "requires_human_review": bool(action.get("requires_human_review")),
                    "recommended_actions": action.get("recommended_actions", []),
                    "message": action.get("message", ""),
                }
            )
    return decisions


async def _entities_for_keys(keys: list[str]) -> list[dict[str, Any]]:
    if not keys:
        return []
    placeholders = ",".join("?" for _ in keys)
    rows = await fetch_all(
        f"""
        SELECT entity_key, entity_type, name, description
        FROM kg_entities
        WHERE entity_key IN ({placeholders}) AND review_status = 'approved'
        """,
        tuple(keys),
    )
    by_key = {row["entity_key"]: dict(row) for row in rows}
    return [by_key[key] for key in keys if key in by_key]


async def get_evidence_paths(evidence_pack: dict[str, Any]) -> list[dict[str, Any]]:
    """把当前匿名证据映射到简洁、可展示、可审计的图谱路径。"""
    screening = evidence_pack.get("screening", {})
    trend = evidence_pack.get("trend", {})
    level = str(screening.get("alert_level") or "none").lower()
    questionnaire = str(screening.get("questionnaire") or "").upper()
    scale_key = "scale.gad7" if "GAD" in questionnaire else "scale.phq9"
    feature_key = (
        "feature.stress_overload"
        if (trend.get("score_delta_from_previous") or 0) > 0
        else "feature.sleep_difficulty"
    )
    if level == "yellow":
        keys = [scale_key, feature_key, "risk.monitor", "alert.yellow", "action.rescreen_3d"]
        relations = [
            (feature_key, "SUPPORTS", "risk.monitor"),
            ("risk.monitor", "MAPS_TO", "alert.yellow"),
            ("risk.monitor", "RECOMMENDS", "action.rescreen_3d"),
        ]
        reason = "当前为黄色预警；该路径仅提出复筛建议，不构成心理诊断。"
    elif level in {"orange", "red"}:
        action = "action.crisis_review" if level == "red" else "action.counselor_review"
        keys = [scale_key, feature_key, "risk.manual_review", f"alert.{level}", action]
        relations = [
            ("risk.manual_review", "MAPS_TO", f"alert.{level}"),
            ("risk.manual_review", "RECOMMENDS", "action.counselor_review"),
        ]
        if level == "red":
            relations.append(("alert.red", "REQUIRES_REVIEW", "action.crisis_review"))
        reason = "当前预警等级要求人工复核；系统不自动下达干预或诊断结论。"
    else:
        return []
    return [
        {
            "path_id": f"screening-alert-{level}",
            "nodes": await _entities_for_keys(keys),
            "relations": [
                {"subject_key": subject, "predicate": predicate, "object_key": object_}
                for subject, predicate, object_ in relations
            ],
            "reason": reason,
        }
    ]


async def get_overview() -> dict[str, Any]:
    entity_count = await fetch_one("SELECT COUNT(*) AS count FROM kg_entities")
    relation_count = await fetch_one("SELECT COUNT(*) AS count FROM kg_relations")
    rule_count = await fetch_one("SELECT COUNT(*) AS count FROM kg_rules WHERE is_active = 1")
    return {
        "entity_count": int(entity_count["count"]) if entity_count else 0,
        "relation_count": int(relation_count["count"]) if relation_count else 0,
        "active_rule_count": int(rule_count["count"]) if rule_count else 0,
        "scope": "预警研判辅助；不用于自动诊断或自动干预。",
    }
