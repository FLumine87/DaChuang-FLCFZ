"""本地冒烟测试：不依赖 HTTP 服务器，直接调用路由分发验证核心链路。

用法（backend/ 目录下）：
    python scripts/smoke_test.py

覆盖：登录 → 鉴权访问 → 未授权拦截 → 检索（Mock 引擎）。
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.router import dispatch  # noqa: E402


async def main() -> None:
    # 1. 登录（admin/admin123，来自种子数据）
    body = '{"username": "admin", "password": "admin123"}'.encode("utf-8")
    status, payload = await dispatch(
        "POST", "/api/auth/login", "", body, {"content-type": "application/json"}
    )
    data = payload.get("data") or {}
    print("login:", status, "token?", "token" in data)
    token = data.get("token", "")
    auth = {"authorization": f"Bearer {token}"}

    # 2. 带 token 访问仪表盘
    status, payload = await dispatch("GET", "/api/dashboard/stats", "", b"", auth)
    print("stats:", status, "total:", (payload.get("data") or {}).get("total_screenings"))

    # 3. 未带 token 应 401
    status, payload = await dispatch("GET", "/api/dashboard/stats", "", b"", {})
    print("no-auth:", status, payload.get("message"))

    # 4. 检索（Worker 下为 Mock 引擎，本地为真实哈希引擎）
    body = '{"query": "焦虑", "top_k": 3}'.encode("utf-8")
    status, payload = await dispatch("POST", "/api/retrieval/search", "", body, auth)
    print("search:", status, "total:", (payload.get("data") or {}).get("total"))

    # 5. 个人端筛查列表（带 token）
    status, payload = await dispatch("GET", "/api/personal/screenings", "", b"", auth)
    print("personal-screenings:", status, "count:", len(payload.get("data") or []))

    # 6. 管理端 dashboard（含日期统计，覆盖 datetime 参数路径）
    status, payload = await dispatch("GET", "/api/admin/dashboard", "", b"", auth)
    data = payload.get("data") or {}
    print("admin-dashboard:", status, "trend:", len(data.get("trendData") or []),
          "alerts:", len(data.get("alertRecords") or []))


if __name__ == "__main__":
    asyncio.run(main())
