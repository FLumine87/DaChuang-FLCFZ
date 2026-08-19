from fastapi import APIRouter, Depends
from app.api.v1 import screening, alerts, cases, retrieval, upload, dashboard, auth, personal, admin
from app.core.security import get_current_user, require_admin

api_router = APIRouter()

# 认证相关接口保持公开（登录/注册/登出）
api_router.include_router(auth.router, prefix="/auth", tags=["认证管理"])
# 其余所有接口均需携带合法 Bearer JWT；管理端额外要求 admin 角色
api_router.include_router(
    personal.router, prefix="/personal", tags=["个人端"],
    dependencies=[Depends(get_current_user)],
)
api_router.include_router(
    admin.router, prefix="/admin", tags=["管理端"],
    dependencies=[Depends(require_admin)],
)
api_router.include_router(
    screening.router, prefix="/screening", tags=["筛查管理"],
    dependencies=[Depends(get_current_user)],
)
api_router.include_router(
    alerts.router, prefix="/alerts", tags=["预警管理"],
    dependencies=[Depends(get_current_user)],
)
api_router.include_router(
    cases.router, prefix="/cases", tags=["案例管理"],
    dependencies=[Depends(get_current_user)],
)
api_router.include_router(
    retrieval.router, prefix="/retrieval", tags=["检索分析"],
    dependencies=[Depends(get_current_user)],
)
api_router.include_router(
    upload.router, prefix="/upload", tags=["文件上传"],
    dependencies=[Depends(get_current_user)],
)
api_router.include_router(
    dashboard.router, prefix="/dashboard", tags=["仪表盘"],
    dependencies=[Depends(get_current_user)],
)
