from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import os

from app.config import settings
from app.db.session import init_db
from app.api.v1 import api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    os.makedirs(f"{settings.UPLOAD_DIR}/audio", exist_ok=True)
    os.makedirs(f"{settings.UPLOAD_DIR}/image", exist_ok=True)
    os.makedirs(f"{settings.UPLOAD_DIR}/document", exist_ok=True)
    # 预热哈希检索引擎（训练/加载；失败不阻断启动，工厂已含 mock 回退）
    try:
        from app.engines import get_hashing_engine
        await get_hashing_engine().initialize()
    except Exception:
        pass
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if os.path.exists(settings.UPLOAD_DIR):
    app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

app.include_router(api_router, prefix="/api")


@app.get("/")
async def root():
    return {
        "message": "心理筛查预警系统API",
        "version": settings.APP_VERSION,
        "docs": "/docs"
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy"}
