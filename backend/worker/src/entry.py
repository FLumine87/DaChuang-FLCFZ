"""Cloudflare Python Worker 入口（轻量：直接调用 app.router.dispatch，无 FastAPI/asgi）。

启动流程（首次请求触发，之后复用）：
  1. 注入 Worker 运行时环境（D1 bindings、vars/secrets）→ app.core.runtime；
  2. 将 vars/secrets 覆盖到全局配置；
  3. D1 建表（幂等）。
随后将请求解析为 (method, path, query, body, headers) 交给 app.router.dispatch。
"""
import json
from urllib.parse import urlparse

from workers import WorkerEntrypoint, Response

from app.core import runtime
from app.config import settings
from app.db.database import init_db
from app.router import dispatch

_bootstrapped = False

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
}


async def _bootstrap(env) -> None:
    """首次请求时初始化 Worker 运行时（幂等）。"""
    global _bootstrapped
    if _bootstrapped:
        return
    runtime.init_worker(env)
    settings.apply_worker_overrides(env)
    try:
        init_db()
    except Exception as e:  # 建表失败不应阻断请求，让后续业务层暴露具体错误
        print(f"[bootstrap] D1 init_db failed: {e}")
    _bootstrapped = True


def _read_headers(js_headers) -> dict:
    """把 JS Headers 转成 Python dict（通过 JS 迭代器）。"""
    headers = {}
    it = js_headers.entries()
    while True:
        n = it.next()
        if n.done:
            break
        pair = n.value
        headers[str(pair[0]).lower()] = str(pair[1])
    return headers


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        await _bootstrap(self.env)

        js_req = request.js_object
        method = str(js_req.method)

        # CORS 预检
        if method == "OPTIONS":
            return Response("", status=204, headers=CORS_HEADERS)

        parsed = urlparse(str(js_req.url))
        headers = _read_headers(js_req.headers)

        body = b""
        if method in ("POST", "PUT", "DELETE", "PATCH"):
            buf = await js_req.arrayBuffer()
            from js import Uint8Array
            body = bytes(Uint8Array.new(buf))

        status, payload = await dispatch(method, parsed.path, parsed.query, body, headers)

        resp_headers = dict(CORS_HEADERS)
        resp_headers["Content-Type"] = "application/json; charset=utf-8"
        return Response(
            json.dumps(payload, ensure_ascii=False),
            status=status,
            headers=resp_headers,
        )
