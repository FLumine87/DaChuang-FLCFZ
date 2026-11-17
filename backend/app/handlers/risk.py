"""Personal/admin reads share exactly one summary; internal writes require HMAC."""
from app.core.responses import success_response
from app.core.exceptions import HttpError
from app.handlers.steward_bridge import authorize
from app.services import risk_summary as risk


async def personal(ctx):
    if ctx.user.get('role')!='user':raise HttpError(403,'仅限本人查看')
    return success_response(data=await risk.summary(int(ctx.user['sub'])))


async def case(ctx,case_id):
    uid=await risk.case_user(case_id)
    value=await risk.summary(uid)
    value['review_history']=await risk.db.query_a('SELECT item_id,action,note,actor_id,created_at FROM risk_reviews WHERE user_id=? ORDER BY id DESC',(uid,))
    return success_response(data=value)


async def population(ctx):
    return success_response(data=await risk.population())


async def review(ctx,case_id):
    return success_response(data=await risk.review(await risk.case_user(case_id),ctx.body,int(ctx.user['sub'])))


async def internal_summary(ctx):
    authorize(ctx)
    return await risk.summary(int(ctx.query['user_id']))


async def context(ctx):
    authorize(ctx)
    return await risk.extraction_context(int(ctx.query['user_id']),str(ctx.query.get('after') or ''))


async def consent(ctx):
    authorize(ctx)
    return await risk.set_consent(int(ctx.body['user_id']),ctx.body)


async def extraction(ctx):
    authorize(ctx)
    return await risk.save_extraction(int(ctx.body['user_id']),ctx.body)
