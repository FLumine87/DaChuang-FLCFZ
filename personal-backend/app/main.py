from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.v1.alerts import router as alerts_router
from .api.v1.checkin import router as checkin_router
from .api.v1.inference import router as inference_router
from .api.v1.kg import router as kg_router
from .config import settings
from .core.neo4j import neo4j_health
from .db.database import init_db

app = FastAPI(title=settings.app_name, version="0.2.0")

# 前端 Vite 开发服务器（5173 被占用时 Vite 会自动用 5174/5175…，全部放行）
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:5174", "http://127.0.0.1:5174",
        "http://localhost:5175", "http://127.0.0.1:5175",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    init_db()
    # 启动定时日常问询调度器（可选，默认开启）
    if settings.enable_daily_checkin:
        try:
            from .services.daily_checkin_scheduler import start_scheduler
            start_scheduler()
        except Exception as e:
            print(f"[warn] 定时问询调度器启动失败: {e}")


app.include_router(kg_router, prefix="/api/v1")
app.include_router(inference_router, prefix="/api/v1")
app.include_router(alerts_router, prefix="/api/v1")
app.include_router(checkin_router, prefix="/api/v1")


@app.get("/api/v1/health")
def health() -> dict:
    """健康检查：返回 Neo4j 连接状态与运行模式。"""
    return {
        "status": "ok",
        "neo4j_connected": neo4j_health(),
        "mock_mode": settings.enable_mock_engines or not settings.llm_api_key,
    }
