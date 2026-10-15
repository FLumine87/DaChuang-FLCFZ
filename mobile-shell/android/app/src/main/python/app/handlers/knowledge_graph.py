"""知识图谱查询接口。

接口只返回匿名证据包、审核规则和图谱路径，不能作为诊断结论使用。
"""
from app.core.auth import RequestContext
from app.core.responses import success_response
from app.engines.agent import build_evidence_pack
from app.services import agent_graph, screening_service
from app.db import database as db


async def _safe_history(screening: dict) -> list[dict]:
    """仅按内部 case_id 关联，绝不回退到姓名/电话等个人信息。"""
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


async def _evidence_payload(screening_id: int) -> dict | None:
    screening = await screening_service.get_screening_by_id(screening_id)
    if not screening:
        return None
    history = await _safe_history(screening)
    initial_pack = build_evidence_pack(screening, history=history)
    await agent_graph.ensure_seeded()
    paths = await agent_graph.evidence_paths(initial_pack)
    decisions = await agent_graph.evaluate(initial_pack)
    evidence_pack = build_evidence_pack(
        screening, history=history, knowledge_paths=paths
    )
    return {
        "screening_id": screening_id,
        "evidence_pack": evidence_pack,
        "knowledge_graph": {"paths": paths, "rule_decisions": decisions},
    }


async def get_overview(ctx: RequestContext):
    await agent_graph.ensure_seeded()
    return success_response(data=await agent_graph.overview())


async def get_screening_evidence(ctx: RequestContext, screening_id: int):
    payload = await _evidence_payload(screening_id)
    if payload is None:
        return success_response(data=None, message="筛查记录不存在")
    return success_response(data=payload)
