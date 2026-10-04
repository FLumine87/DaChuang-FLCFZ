"""预警研判 Agent 的只读研判接口。"""
from app.core.auth import RequestContext
from app.core.responses import success_response
from app.engines.agent import build_evidence_pack
from app.services import agent_graph, screening_service
from app.services.warning_assessment_agent import build_assessment
from app.db import database as db


async def _safe_history(screening: dict) -> list[dict]:
    case_id = screening.get("case_id")
    if not case_id:
        return []
    return await db.query_a(
        """
        SELECT id, score, max_score, alert_level, screening_date, created_at
        FROM screenings
        WHERE case_id = ? AND id != ?
        ORDER BY COALESCE(screening_date, created_at) DESC
        LIMIT 5
        """,
        (case_id, screening.get("id")),
    )


async def assess(ctx: RequestContext):
    data = ctx.body or {}
    screening = await screening_service.get_screening_by_id(data.get("screening_id"))
    if not screening:
        return success_response(data=None, message="筛查记录不存在")

    history = await _safe_history(screening)
    initial_pack = build_evidence_pack(screening, history=history)
    await agent_graph.ensure_seeded()
    paths = await agent_graph.evidence_paths(initial_pack)
    decisions = await agent_graph.evaluate(initial_pack)
    evidence_pack = build_evidence_pack(
        screening, history=history, knowledge_paths=paths
    )
    assessment = build_assessment(evidence_pack, paths, decisions)
    return success_response(data={
        "assessment": assessment,
        "evidence_pack": evidence_pack,
        "knowledge_graph": {"paths": paths, "rule_decisions": decisions},
    })
