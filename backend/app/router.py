"""路由分发：匹配路由表，构造请求上下文，执行 handler，统一异常/响应处理。

dispatch 为 async（Worker 的 fetch 直接 await；本地 HTTP 服务器用 asyncio.run 包装）。
"""
import asyncio
import re

from app.handlers import ROUTES
from app.core.auth import RequestContext, get_current_user, require_admin
from app.core.exceptions import HttpError
from app.core.responses import success_response, error_response

# 编译路由：{param} -> (?P<param>[^/]+)
_COMPILED = [
    (method, pattern, re.compile("^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", pattern) + "$"),
     handler, auth)
    for method, pattern, handler, auth in ROUTES
]

# 健康检查/根路径（公开）
_HEALTH = {
    "message": "心理筛查预警系统API",
    "version": None,  # 延迟注入
}


async def dispatch(method: str, path: str, query_string: str = "",
                   body: bytes = b"", headers: dict = None):
    """返回 (status_code, payload_dict)。"""
    ctx = RequestContext(method, path, query_string, body, headers)
    try:
        # 公开的健康检查
        if path in ("/", "/health"):
            from app.config import settings
            if path == "/health":
                return 200, {"status": "healthy"}
            return 200, {"message": _HEALTH["message"], "version": settings.APP_VERSION,
                         "docs": "/docs"}

        route = _match(ctx)
        if route is None:
            raise HttpError(404, "接口不存在")
        handler, auth, path_params = route

        if auth == "admin":
            require_admin(ctx)
        elif auth == "user":
            get_current_user(ctx)

        result = handler(ctx, **path_params)
        if asyncio.iscoroutine(result):
            result = await result
        if isinstance(result, dict) and "code" in result and "data" in result:
            payload = result
        else:
            payload = success_response(data=result)
        return 200, payload
    except HttpError as e:
        return e.status_code, error_response(e.detail, code=e.code)
    except Exception as e:  # 兜底：避免把堆栈暴露给客户端
        print(f"[dispatch] {method} {path} error: {e}")
        return 500, error_response("服务器内部错误", code=500)


def _match(ctx: RequestContext):
    for method, pattern, regex, handler, auth in _COMPILED:
        if method != ctx.method:
            continue
        m = regex.match(ctx.path)
        if m:
            return handler, auth, {k: _coerce_path(v) for k, v in m.groupdict().items()}
    return None


def _coerce_path(v: str):
    """路径参数尽量转为 int（id 类参数）。"""
    try:
        return int(v)
    except (TypeError, ValueError):
        return v


# 供本地/Worker 入口直接构建响应体（JSON 序列化由调用方处理）
def build_response(status: int, payload: dict) -> str:
    import json
    return json.dumps(payload, ensure_ascii=False)
