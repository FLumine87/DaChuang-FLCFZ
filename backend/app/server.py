"""本地轻量 HTTP 服务器（标准库 ThreadingHTTPServer）。

用于本地开发/演示，替代原 FastAPI + uvicorn：
    python -m app.main
服务地址：http://localhost:8000（默认）
"""
import asyncio
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from app.router import dispatch

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
}


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "MentalScreening/1.0"

    def log_message(self, fmt, *args):  # 静默访问日志
        pass

    def _handle(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        headers = {k: v for k, v in self.headers.items()}

        try:
            status, payload = asyncio.run(
                dispatch(self.command, parsed.path, parsed.query, body, headers)
            )
        except Exception as e:  # 兜底
            status = 500
            payload = {"code": 500, "message": f"服务器内部错误: {e}", "data": None}

        resp_body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(resp_body)))
        self.end_headers()
        self.wfile.write(resp_body)

    def do_OPTIONS(self):
        self.send_response(204)
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)
        self.send_header("Content-Length", "0")
        self.end_headers()

    do_GET = _handle
    do_POST = _handle
    do_PUT = _handle
    do_DELETE = _handle


def run_server(host: str = "0.0.0.0", port: int = 8000) -> None:
    # 启动前初始化数据库（幂等，本地同步建表）
    from app.db.database import init_db_sync
    import os
    os.makedirs("uploads", exist_ok=True)
    init_db_sync()
    httpd = ThreadingHTTPServer((host, port), ApiHandler)
    print(f"轻量后端已启动: http://{host}:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止")


if __name__ == "__main__":
    run_server()
