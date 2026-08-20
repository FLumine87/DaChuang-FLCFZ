"""筛查管理接口 handler（async）。"""
from app.core.responses import success_response, paginated_response
from app.core.exceptions import HttpError
from app.core.auth import RequestContext
from app.services import screening_service


async def list_questionnaires(ctx: RequestContext):
    return success_response(data=await screening_service.get_all_questionnaires())


async def create_questionnaire(ctx: RequestContext):
    q = await screening_service.create_questionnaire(ctx.body)
    return success_response(data=q)


async def list_screenings(ctx: RequestContext):
    q = ctx.query_params
    page = max(1, int(q.get("page", 1) or 1))
    page_size = min(max(1, int(q.get("page_size", 10) or 10)), 100)
    result = await screening_service.get_screenings(
        page=page,
        page_size=page_size,
        status=q.get("status") or None,
        alert_level=q.get("alert_level") or None,
        questionnaire_id=int(q["questionnaire_id"]) if q.get("questionnaire_id") else None,
        keyword=q.get("keyword") or None,
    )
    return paginated_response(items=result["items"], total=result["total"],
                              page=page, page_size=page_size)


async def create_screening(ctx: RequestContext):
    row = await screening_service.create_screening(ctx.body)
    return success_response(data=row)


async def get_screening(ctx: RequestContext, screening_id: int):
    row = await screening_service.get_screening_by_id(screening_id)
    if not row:
        raise HttpError(404, "筛查记录不存在")
    return success_response(data=row)


async def update_screening(ctx: RequestContext, screening_id: int):
    row = await screening_service.update_screening(screening_id, ctx.body)
    if not row:
        raise HttpError(404, "筛查记录不存在")
    return success_response(data=row)


async def delete_screening(ctx: RequestContext, screening_id: int):
    if not await screening_service.delete_screening(screening_id):
        raise HttpError(404, "筛查记录不存在")
    return success_response(message="删除成功")


async def complete_screening(ctx: RequestContext, screening_id: int):
    score = int(ctx.query_params.get("score", 0) or 0)
    row = await screening_service.complete_screening(screening_id, score)
    if not row:
        raise HttpError(404, "筛查记录不存在")
    return success_response(data=row)
