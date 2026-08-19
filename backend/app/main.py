"""后端入口（轻量、无 FastAPI/pydantic/SQLAlchemy 依赖）。

- 本地运行：python -m app.main  （标准库 HTTP 服务器，见 app/server.py）
- Cloudflare Worker：由 backend/worker/src/entry.py 调用 app.router.dispatch

业务引擎（哈希检索 / TF-IDF RAG / 多模态 Mock）与数据层
（本地 sqlite3 / Worker D1）均在本包内，单一代码源。
"""
from app.router import dispatch

__all__ = ["dispatch"]

if __name__ == "__main__":
    from app.server import run_server
    run_server()
