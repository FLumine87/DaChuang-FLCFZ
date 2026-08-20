"""检索与分析接口 handler（哈希检索 + RAG 报告）。"""
from app.core.responses import success_response
from app.core.auth import RequestContext
from app.services import screening_service
from app.engines import get_hashing_engine, get_rag_engine


async def search(ctx: RequestContext):
    data = ctx.body
    engine = get_hashing_engine()
    results = await engine.search(
        query=data.get("query", ""), modality=data.get("modality", "text"),
        top_k=int(data.get("top_k", 5) or 5),
    )
    return success_response(data={"query": data.get("query"), "results": results, "total": len(results)})


async def analyze(ctx: RequestContext):
    data = ctx.body
    screening = screening_service.get_screening_by_id(data.get("screening_id"))
    if not screening:
        return success_response(data=None, message="筛查记录不存在")

    retrieval_results = None
    if data.get("include_retrieval"):
        engine = get_hashing_engine()
        results = await engine.search(
            query=f"{screening.get('name')} {screening.get('questionnaire_name') or ''}",
            modality="text",
            top_k=int(data.get("top_k", 5) or 5),
        )
        retrieval_results = {
            "query": screening.get("name"), "results": results, "total": len(results)
        }

    rag_engine = get_rag_engine()
    await rag_engine.initialize()
    report = await rag_engine.generate_report(_screening_report_input(screening))

    return success_response(data={
        "screening_id": data.get("screening_id"),
        "retrieval_results": retrieval_results,
        "rag_report": report,
    })


async def get_report(ctx: RequestContext, screening_id: int):
    screening = await screening_service.get_screening_by_id(screening_id)
    if not screening:
        return success_response(data=None, message="筛查记录不存在")
    rag_engine = get_rag_engine()
    await rag_engine.initialize()
    report = await rag_engine.generate_report(_screening_report_input(screening))
    return success_response(data=report)


def _screening_report_input(s: dict) -> dict:
    return {
        "id": s.get("id"),
        "name": s.get("name"),
        "questionnaire": s.get("questionnaire_name") or "未知量表",
        "score": s.get("score"),
        "max_score": s.get("max_score"),
        "alert_level": s.get("alert_level"),
    }
