"""检索与分析接口 handler（动态跨模态哈希检索 + RAG 报告）。"""
from app.core.responses import success_response
from app.core.auth import RequestContext
from app.services import screening_service, agent_graph
from app.db import database as db
from app.engines import get_hashing_engine, get_rag_engine
from app.engines.agent import build_evidence_pack

# 前端可选的检索范围：全部 / 文本 / 图像 / 语音
_MODALITY_FILTERS = ("text", "image", "audio")


def _params(data: dict):
    """解析检索参数：模态过滤、返回条数、查询模态。"""
    mf = data.get("modality_filter") or data.get("scope")
    if mf in ("", "all", "any", None):
        mf = None
    if mf not in _MODALITY_FILTERS and mf is not None:
        mf = None
    modality = data.get("modality") or "text"
    if modality not in _MODALITY_FILTERS:
        modality = "text"
    try:
        top_k = int(data.get("top_k") or 5)
    except (TypeError, ValueError):
        top_k = 5
    return modality, mf, max(1, min(50, top_k))


def to_frontend_hit(hit: dict) -> dict:
    """把引擎返回的命中项转成前端字段风格（camelCase + 保留 explain）。

    引擎内部保持 snake_case，前端统一用 camelCase，转换集中在这里，
    学生端 / 管理端 / 分析端三处共用。
    """
    return {
        **hit,
        "recordId": hit.get("record_id"),
        "alertLevel": hit.get("alert_level", "green"),
        "modalityLabel": hit.get("modality_label"),
        "crossModal": hit.get("cross_modal", False),
    }


async def search(ctx: RequestContext):
    """跨模态检索：文本 / 图像线索 / 语音线索都可以作为查询。

    返回体除结果列表外还带 `index` 字段（检索过程信息：候选数、探测桶数、
    查询码、命中主题），供前端展示"哈希命中率"与可解释信息。
    """
    data = ctx.body or {}
    modality, modality_filter, top_k = _params(data)
    engine = get_hashing_engine()
    results, info = await engine.search_with_info(
        query=data.get("query", ""), modality=modality,
        top_k=top_k, modality_filter=modality_filter,
    )
    return success_response(data={
        "query": data.get("query"),
        "modality": modality,
        "modality_filter": modality_filter,
        "results": [to_frontend_hit(r) for r in results],
        "total": len(results),
        "index": info,
    })


async def index_stats(ctx: RequestContext):
    """哈希索引状态：规模、码长、时间窗表健康度（σ 信息量 / ρ 语义一致性）。"""
    engine = get_hashing_engine()
    if hasattr(engine, "_ensure_initialized"):
        await engine._ensure_initialized()
    if not hasattr(engine, "stats"):
        return success_response(data={"source": "mock"})
    return success_response(data=engine.stats())


async def analyze(ctx: RequestContext):
    data = ctx.body or {}
    screening = await screening_service.get_screening_by_id(data.get("screening_id"))
    if not screening:
        return success_response(data=None, message="筛查记录不存在")

    history = await _safe_history(screening)
    initial_pack = build_evidence_pack(screening, history=history)
    retrieval_results = None
    if data.get("include_retrieval"):
        modality, modality_filter, top_k = _params(data)
        engine = get_hashing_engine()
        results, info = await engine.search_with_info(
            query=f"{screening.get('name')} {screening.get('questionnaire_name') or ''}",
            modality=modality, top_k=top_k, modality_filter=modality_filter,
        )
        retrieval_results = {
            "query": initial_pack["local_retrieval_query"], "results": results,
            "total": len(results), "index": info,
        }

    await agent_graph.ensure_seeded()
    paths = await agent_graph.evidence_paths(initial_pack)
    decisions = await agent_graph.evaluate(initial_pack)
    evidence_pack = build_evidence_pack(screening, history=history, retrieval_results=retrieval_results, knowledge_paths=paths)
    rag_engine = get_rag_engine()
    await rag_engine.initialize()
    report = await rag_engine.generate_report(evidence_pack["rag_context"])

    return success_response(data={
        "screening_id": data.get("screening_id"),
        "retrieval_results": retrieval_results,
        "rag_report": report,
        "evidence_pack": evidence_pack,
        "knowledge_graph": {"paths": paths, "rule_decisions": decisions},
    })


async def get_report(ctx: RequestContext, screening_id: int):
    screening = await screening_service.get_screening_by_id(screening_id)
    if not screening:
        return success_response(data=None, message="筛查记录不存在")
    history = await _safe_history(screening)
    initial_pack = build_evidence_pack(screening, history=history)
    await agent_graph.ensure_seeded()
    paths = await agent_graph.evidence_paths(initial_pack)
    decisions = await agent_graph.evaluate(initial_pack)
    evidence_pack = build_evidence_pack(screening, history=history, knowledge_paths=paths)
    rag_engine = get_rag_engine()
    await rag_engine.initialize()
    report = await rag_engine.generate_report(evidence_pack["rag_context"])
    return success_response(data={"rag_report": report, "evidence_pack": evidence_pack, "knowledge_graph": {"paths": paths, "rule_decisions": decisions}})


def _screening_report_input(s: dict) -> dict:
    return {
        "id": s.get("id"),
        "name": s.get("name"),
        "questionnaire": s.get("questionnaire_name") or "未知量表",
        "score": s.get("score"),
        "max_score": s.get("max_score"),
        "alert_level": s.get("alert_level"),
    }

async def _safe_history(screening: dict):
    case_id = screening.get("case_id")
    if not case_id:
        return []
    return await db.query_a("SELECT id, score, max_score, alert_level, screening_date, created_at FROM screenings WHERE case_id = ? AND id != ? ORDER BY COALESCE(screening_date, created_at) DESC LIMIT 5", (case_id, screening.get("id")))