"""预警管理接口 handler。"""
from app.core.responses import success_response, paginated_response
from app.core.exceptions import HttpError
from app.core.auth import RequestContext
from app.services import alert_service


def list_rules(ctx: RequestContext):
    return success_response(data=alert_service.get_all_rules())


def create_rule(ctx: RequestContext):
    return success_response(data=alert_service.create_rule(ctx.body))


def update_rule(ctx: RequestContext, rule_id: int):
    rule = alert_service.update_rule(rule_id, ctx.body)
    if not rule:
        raise HttpError(404, "预警规则不存在")
    return success_response(data=rule)


def delete_rule(ctx: RequestContext, rule_id: int):
    if not alert_service.delete_rule(rule_id):
        raise HttpError(404, "预警规则不存在")
    return success_response(message="删除成功")


def get_stats(ctx: RequestContext):
    return success_response(data=alert_service.get_stats())


def list_alerts(ctx: RequestContext):
    q = ctx.query_params
    page = max(1, int(q.get("page", 1) or 1))
    page_size = min(max(1, int(q.get("page_size", 10) or 10)), 100)
    result = alert_service.get_alerts(
        page=page, page_size=page_size,
        level=q.get("level") or None,
        status=q.get("status") or None,
    )
    return paginated_response(items=result["items"], total=result["total"],
                              page=page, page_size=page_size)


def create_alert(ctx: RequestContext):
    return success_response(data=alert_service.create_alert(ctx.body))


def get_alert(ctx: RequestContext, alert_id: int):
    alert = alert_service.get_alert_by_id(alert_id)
    if not alert:
        raise HttpError(404, "预警记录不存在")
    return success_response(data=alert)


def update_alert(ctx: RequestContext, alert_id: int):
    alert = alert_service.update_alert(alert_id, ctx.body)
    if not alert:
        raise HttpError(404, "预警记录不存在")
    return success_response(data=alert)


def resolve_alert(ctx: RequestContext, alert_id: int):
    notes = ctx.query_params.get("notes", "") or ""
    alert = alert_service.resolve_alert(alert_id, notes)
    if not alert:
        raise HttpError(404, "预警记录不存在")
    return success_response(data=alert)
