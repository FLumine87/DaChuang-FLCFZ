from fastapi import APIRouter
from app.api.v1 import screening, alerts, cases, retrieval, upload, dashboard

api_router = APIRouter()

api_router.include_router(screening.router, prefix="/screening", tags=["筛查管理"])
api_router.include_router(alerts.router, prefix="/alerts", tags=["预警管理"])
api_router.include_router(cases.router, prefix="/cases", tags=["案例管理"])
api_router.include_router(retrieval.router, prefix="/retrieval", tags=["检索分析"])
api_router.include_router(upload.router, prefix="/upload", tags=["文件上传"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["仪表盘"])
