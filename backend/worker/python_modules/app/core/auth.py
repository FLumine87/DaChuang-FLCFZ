"""轻量请求上下文与认证（替代 FastAPI Depends / get_current_user / HTTPBearer）。

handler 统一签名：`handler(ctx: RequestContext, **path_params) -> dict`
返回值由路由层包装为统一 JSON 响应；认证失败抛出 HttpError。
"""
import json
from urllib.parse import parse_qs

from app.core.exceptions import HttpError
from app.core.security import decode_access_token


class RequestContext:
    """一次请求的上下文，由路由层（router / server / worker 入口）构造。"""

    def __init__(self, method: str, path: str, query_string: str = "",
                 body: bytes = b"", headers: dict = None, raw_path: str = ""):
        self.method = method.upper()
        self.path = path
        self.raw_path = raw_path
        self.query = {}
        if query_string:
            for k, vs in parse_qs(query_string).items():
                self.query[k] = vs[0] if len(vs) == 1 else vs
        self.headers = {k.lower(): v for k, v in (headers or {}).items()}
        self._body_bytes = body or b""
        self._body = None
        self._body_parsed = False
        self.user = None  # 认证通过后填充

    @property
    def body(self) -> dict:
        """请求体 JSON（解析失败或非 JSON 时返回 {}）。"""
        if not self._body_parsed:
            self._body_parsed = True
            try:
                data = json.loads(self._body_bytes.decode("utf-8")) if self._body_bytes else {}
                self._body = data if isinstance(data, dict) else {}
            except Exception:
                self._body = {}
        return self._body

    @property
    def query_params(self) -> dict:
        return self.query


def get_current_user(ctx: RequestContext) -> dict:
    """校验 Bearer JWT，返回 payload（含 sub/username/role）；未认证抛 401。"""
    if ctx.user is not None:
        return ctx.user
    auth = ctx.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HttpError(401, "未提供认证凭证")
    payload = decode_access_token(auth[7:].strip())
    if payload is None:
        raise HttpError(401, "无效或已过期的凭证")
    ctx.user = payload
    return payload


def require_admin(ctx: RequestContext) -> dict:
    """在已登录基础上要求 role == 'admin'，否则 403。"""
    user = get_current_user(ctx)
    if user.get("role") != "admin":
        raise HttpError(403, "需要管理员权限")
    return user
