"""本地轻量 HTTP 服务器（标准库 ThreadingHTTPServer）。

用于本地开发/演示，替代原 FastAPI + uvicorn：
    python -m app.main
服务地址：http://localhost:8000（默认）
"""
import asyncio
import json
import mimetypes
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

from app.router import dispatch

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
}

# 上传文件的静态目录（与 handlers/upload.py 的 UPLOAD_ROOT 一致）
UPLOAD_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads")


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "MentalScreening/1.0"

    def log_message(self, fmt, *args):  # 静默访问日志
        pass

    def _serve_upload(self, requested_path: str) -> bool:
        """GET /uploads/...：按文件返回（上传接口返回的 file_path 可直接打开）。

        只允许 UPLOAD_ROOT 之内的路径（normalize 后前缀校验，拒绝 ../ 穿越）。
        """
        rel = unquote(requested_path[len("/uploads/"):])
        target = os.path.realpath(os.path.join(UPLOAD_ROOT, rel))
        root = os.path.realpath(UPLOAD_ROOT)
        if not target.startswith(root + os.sep) or not os.path.isfile(target):
            return False
        ctype = mimetypes.guess_type(target)[0] or "application/octet-stream"
        with open(target, "rb") as fh:
            data = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "private, max-age=3600")
        self.end_headers()
        self.wfile.write(data)
        return True

    def _handle(self):
        parsed = urlparse(self.path)
        # 静态上传文件：命中直接返回，不进入 API 路由
        if self.command == "GET" and parsed.path.startswith("/uploads/"):
            if self._serve_upload(parsed.path):
                return
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
    os.makedirs(UPLOAD_ROOT, exist_ok=True)
    init_db_sync()
    httpd = ThreadingHTTPServer((host, port), ApiHandler)
    print(f"轻量后端已启动: http://{host}:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止")


if __name__ == "__main__":
    run_server()
