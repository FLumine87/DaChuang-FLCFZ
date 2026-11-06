from urllib.parse import unquote
from app.services import review_service as service

async def send(ctx):
    return await service.send(ctx)

async def staff_list(ctx):
    return await service.list_requests(ctx, staff=True)

async def personal_list(ctx):
    return await service.list_requests(ctx)

async def acknowledge(ctx, request_id):
    return await service.acknowledge(ctx, unquote(str(request_id)))

async def submit(ctx, request_id):
    return await service.submit(ctx, unquote(str(request_id)))

async def staff_action(ctx, request_id):
    return await service.staff_action(ctx, unquote(str(request_id)))

async def notifications(ctx):
    return await service.notifications(ctx)

async def read(ctx, notification_id):
    return await service.read_notification(ctx, unquote(str(notification_id)))
