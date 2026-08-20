"""Cloudflare Python Worker 入口（轻量：直接调用 app.router.dispatch，无 FastAPI/asgi）。

启动流程（首次请求触发，之后复用）：
  1. 注入 Worker 运行时环境（D1 bindings、vars/secrets）→ app.core.runtime；
  2. 将 vars/secrets 覆盖到全局配置；
  3. D1 建表（幂等）。
随后将请求解析为 (method, path, query, body, headers) 交给 app.router.dispatch。
所有异常在 fetch 顶层兜底为 500 JSON，避免连接中断无法排查。
"""
import json
from urllib.parse import urlparse

from workers import WorkerEntrypoint, Response

from app.core import runtime
from app.config import settings
from app.router import dispatch

_bootstrapped = False

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
}


async def _bootstrap(env) -> None:
    """首次请求时初始化 Worker 运行时（幂等）。

    注意：不在 Worker 下执行建表——D1 表结构已通过
    `wrangler d1 execute --file=worker/seed/schema.sql` 建好（见 DEVELOP.md），
    且 Worker 环境对请求路径上的 D1 exec 稳定性要求高，跳过建表最稳妥。
    """
    global _bootstrapped
    if _bootstrapped:
        return
    runtime.init_worker(env)
    settings.apply_worker_overrides(env)
    _bootstrapped = True


def _read_headers(js_headers) -> dict:
    """把 JS Headers 转成 Python dict（通过 JS 迭代器）；失败返回空 dict。"""
    headers = {}
    try:
        it = js_headers.entries()
        while True:
            n = it.next()
            if n.done:
                break
            pair = n.value
            headers[str(pair[0]).lower()] = str(pair[1])
    except Exception as e:
        print(f"[entry] read_headers error: {e}")
    return headers


async def _read_body(js_req) -> bytes:
    """读取请求体：JS ArrayBuffer → bytes（Pyodide 稳妥转换）。"""
    buf = await js_req.arrayBuffer()
    from js import Uint8Array
    return bytes(Uint8Array.new(buf).to_py())


def _json_response(payload: dict, status: int) -> Response:
    resp_headers = dict(CORS_HEADERS)
    resp_headers["Content-Type"] = "application/json; charset=utf-8"
    return Response(
        json.dumps(payload, ensure_ascii=False),
        status=status,
        headers=resp_headers,
    )


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        try:
            await _bootstrap(self.env)

            js_req = request.js_object
            method = str(js_req.method)

            # CORS 预检（204 无 body，带 CORS 头）
            if method == "OPTIONS":
                return Response(None, status=204, headers=CORS_HEADERS)

            parsed = urlparse(str(js_req.url))
            headers = _read_headers(js_req.headers)

            body = b""
            if method in ("POST", "PUT", "DELETE", "PATCH"):
                body = await _read_body(js_req)

            status, payload = await dispatch(method, parsed.path, parsed.query, body, headers)
            return _json_response(payload, status)
        except Exception as e:  # 兜底：返回 500 并带错误信息，避免连接中断
            print(f"[entry] unhandled error: {e}")
            return _json_response(
                {"code": 500, "message": f"server error: {e}", "data": None},
                status=500,
            )
