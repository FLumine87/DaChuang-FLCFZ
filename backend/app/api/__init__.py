from fastapi import APIRouter
from app.api.v1 import auth, personal, admin

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["认证"])
api_router.include_router(personal.router, prefix="/personal", tags=["个人端"])
api_router.include_router(admin.router, prefix="/admin", tags=["管理端"])