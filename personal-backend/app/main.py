from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.v1.alerts import router as alerts_router
from .api.v1.chat import router as chat_router
from .api.v1.checkin import router as checkin_router
from .api.v1.inference import router as inference_router
from .api.v1.kg import router as kg_router
from .config import settings
from .core.neo4j import neo4j_health
from .db.database import init_db

app = FastAPI(title=settings.app_name, version="0.2.0")

# 允许的来源：
#   · 前端 Vite 开发服务器（5173 被占用时 Vite 会自动用 5174/5175…）
#   · Capacitor 打包后的 App —— 它的 WebView 页面来源是 https://localhost
#     （见 mobile-shell/capacitor.config.json 的 server.androidScheme）。
#     少了这一条，App 里所有走本服务的功能（陪伴对话 / 知识图谱 / 推送）
#     都会被浏览器按 CORS 拦掉，表现为"未连接到服务端"。
#     capacitor://localhost 是 iOS 侧的对应约定，一并放行以备将来。
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:5174", "http://127.0.0.1:5174",
        "http://localhost:5175", "http://127.0.0.1:5175",
        "https://localhost", "capacitor://localhost",
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
app.include_router(chat_router, prefix="/api/v1")


@app.get("/api/v1/health")
def health() -> dict:
    """健康检查：返回 Neo4j 连接状态与运行模式。"""
    return {
        "status": "ok",
        "neo4j_connected": neo4j_health(),
        "mock_mode": settings.enable_mock_engines or not settings.llm_api_key,
    }
