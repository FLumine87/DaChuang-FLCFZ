from urllib.parse import unquote
from app.core.exceptions import HttpError
from app.core.responses import success_response
from app.services import agent_model
from app.services import agent_workspace as service
from app.services import agent_individual


def actor(ctx):
    return str((ctx.user or {}).get("username") or (ctx.user or {}).get("sub") or "admin")


async def overview(ctx):
    return success_response(data=await service.overview(service.scope_value(ctx.query.get("scope", "live"))))


async def run(ctx):
    body = ctx.body
    return success_response(data=await service.run(
        service.scope_value(body.get("scope", "live")), body.get("days", 90),
        body.get("department", "all"), actor(ctx)))


async def case_detail(ctx, case_id):
    return success_response(data=await agent_individual.detail(
        service.scope_value(ctx.query.get("scope", "live")), unquote(str(case_id))))


async def run_case(ctx, case_id):
    return success_response(data=await agent_individual.run(
        service.scope_value(ctx.body.get("scope", "live")), unquote(str(case_id)), actor(ctx)))


async def update_task(ctx, task_id):
    return success_response(data=await service.update_task(unquote(str(task_id)), ctx.body, actor(ctx)))


async def model_settings(ctx):
    return success_response(data=await agent_model.availability())


async def update_model_settings(ctx):
    value = ctx.body.get("enabled")
    if not isinstance(value, bool):
        raise HttpError(400, "enabled 必须为布尔值")
    await agent_model.set_enabled(value, actor(ctx))
    return success_response(data=await agent_model.availability())
