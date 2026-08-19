"""轻量异常（纯标准库）：替代 FastAPI HTTPException，供路由层统一转 HTTP 响应。"""


class HttpError(Exception):
    """HTTP 层错误：status_code + 统一响应体（{code, message, data}）。"""

    def __init__(self, status_code: int = 400, detail: str = "请求错误", code: int = None):
        self.status_code = status_code
        self.detail = detail
        # 业务码默认与 HTTP 状态一致，可显式覆盖
        self.code = code if code is not None else status_code
        super().__init__(detail)


def not_found(detail: str = "资源不存在") -> HttpError:
    return HttpError(404, detail)


def unauthorized(detail: str = "未授权访问") -> HttpError:
    return HttpError(401, detail)


def forbidden(detail: str = "没有权限") -> HttpError:
    return HttpError(403, detail)


def bad_request(detail: str = "请求参数错误") -> HttpError:
    return HttpError(400, detail)
