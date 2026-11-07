"""数据审核接口 handler。

新数据写入索引后默认 scope=reviewing：本人可检索，他人不可见，不进训练池。
管理员在这里审核，通过后进入公共池并写入训练队列。
"""
from app.core.auth import RequestContext, get_current_user
from app.core.responses import success_response
from app.core.exceptions import HttpError
from app.services import review_service


def _reviewer_id(ctx: RequestContext):
    user = get_current_user(ctx)
    try:
        return int(user.get("sub"))
    except (TypeError, ValueError):
        return None


async def pending(ctx: RequestContext):
    """待审列表。query: limit / offset / keyword。"""
    try:
        limit = int(ctx.query.get("limit") or 50)
        offset = int(ctx.query.get("offset") or 0)
    except (TypeError, ValueError):
        limit, offset = 50, 0
    data = await review_service.pending_list(
        limit=max(1, min(200, limit)), offset=max(0, offset),
        keyword=(ctx.query.get("keyword") or "").strip(),
    )
    return success_response(data=data)


async def stats(ctx: RequestContext):
    return success_response(data=await review_service.review_stats())


async def batch(ctx: RequestContext):
    """批量审核。body: {record_ids: [...], action: approve|reject, note}"""
    data = ctx.body or {}
    ids = data.get("record_ids") or data.get("ids") or []
    if isinstance(ids, str):
        ids = [ids]
    if not isinstance(ids, list) or not ids:
        raise HttpError(400, "record_ids 不能为空")
    action = (data.get("action") or "").strip()
    if action not in ("approve", "reject"):
        raise HttpError(400, "action 必须是 approve 或 reject")
    try:
        result = await review_service.review(
            [str(i) for i in ids], action,
            reviewer_id=_reviewer_id(ctx), note=data.get("note") or "",
        )
    except ValueError as exc:
        raise HttpError(503, str(exc)) from exc
    return success_response(data=result)


async def retrain(ctx: RequestContext):
    """手动触发增量重训（后台执行，立即返回）。"""
    from app.engines import get_hashing_engine
    engine = get_hashing_engine()
    await engine._ensure_initialized()
    if not hasattr(engine, "schedule_retrain"):
        raise HttpError(503, "当前引擎不支持重训")
    started = engine.schedule_retrain()
    return success_response(data={
        "started": started,
        "message": "已开始重训" if started else "已有重训任务在运行",
        **engine.retrain_status(),
    })


async def retrain_status(ctx: RequestContext):
    """重训状态：是否在跑、队列积压、最近版本、窗口模型数。"""
    from app.engines import get_hashing_engine
    engine = get_hashing_engine()
    await engine._ensure_initialized()
    if not hasattr(engine, "retrain_status"):
        return success_response(data={"supported": False})
    return success_response(data=engine.retrain_status())


async def drift(ctx: RequestContext):
    """漂移检测报告：主题 KL、OOV 率、近邻一致性下降。"""
    from app.engines import get_hashing_engine
    engine = get_hashing_engine()
    await engine._ensure_initialized()
    return success_response(data=engine.drift_report())


async def set_scope(ctx: RequestContext):
    """本人设置可见性。body: {record_id, scope: private|public}

    scope=public 表示申请公开，实际只是转回待审，仍需管理员审核。
    """
    data = ctx.body or {}
    record_id = str(data.get("record_id") or "")
    scope = (data.get("scope") or "").strip()
    if not record_id or scope not in ("private", "public"):
        raise HttpError(400, "record_id 与 scope(private|public) 必填")
    user = get_current_user(ctx)
    try:
        uid = int(user.get("sub"))
    except (TypeError, ValueError):
        uid = None
    result = await review_service.set_scope(record_id, scope, user_id=uid)
    if not result.get("ok"):
        raise HttpError(403, result.get("reason") or "操作失败")
    return success_response(data=result)
