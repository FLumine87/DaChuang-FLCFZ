"""案例管理接口 handler（async）。"""
from app.core.responses import success_response, paginated_response
from app.core.exceptions import HttpError
from app.core.auth import RequestContext
from app.services import case_service


async def list_tags(ctx: RequestContext):
    return success_response(data=await case_service.get_all_tags())


async def create_tag(ctx: RequestContext):
    return success_response(data=await case_service.create_tag(ctx.body))


async def list_cases(ctx: RequestContext):
    q = ctx.query_params
    page = max(1, int(q.get("page", 1) or 1))
    page_size = min(max(1, int(q.get("page_size", 10) or 10)), 100)
    result = await case_service.get_cases(
        page=page, page_size=page_size,
        alert_level=q.get("alert_level") or None,
        status=q.get("status") or None,
        keyword=q.get("keyword") or None,
    )
    return paginated_response(items=result["items"], total=result["total"],
                              page=page, page_size=page_size)


async def create_case(ctx: RequestContext):
    return success_response(data=await case_service.create_case(ctx.body))


async def get_case(ctx: RequestContext, case_id: int):
    case = await case_service.get_case_by_id(case_id)
    if not case:
        raise HttpError(404, "案例不存在")
    return success_response(data=case)


async def update_case(ctx: RequestContext, case_id: int):
    case = await case_service.update_case(case_id, ctx.body)
    if not case:
        raise HttpError(404, "案例不存在")
    return success_response(data=case)


async def delete_case(ctx: RequestContext, case_id: int):
    if not await case_service.delete_case(case_id):
        raise HttpError(404, "案例不存在")
    return success_response(message="删除成功")


async def get_timeline(ctx: RequestContext, case_id: int):
    return success_response(data=await case_service.get_timeline(case_id))


async def add_timeline_event(ctx: RequestContext, case_id: int):
    return success_response(data=await case_service.add_timeline_event(case_id, ctx.body))
