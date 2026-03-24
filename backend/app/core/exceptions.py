from fastapi import HTTPException, status
from typing import Any, Optional


class AppException(Exception):
    def __init__(
        self,
        message: str,
        code: int = 1,
        status_code: int = status.HTTP_400_BAD_REQUEST,
        details: Optional[Any] = None,
    ):
        self.message = message
        self.code = code
        self.status_code = status_code
        self.details = details
        super().__init__(self.message)


class NotFoundException(AppException):
    def __init__(self, resource: str, identifier: Any = None):
        message = f"{resource}不存在"
        if identifier:
            message = f"{resource} '{identifier}' 不存在"
        super().__init__(
            message=message,
            code=404,
            status_code=status.HTTP_404_NOT_FOUND,
        )


class ValidationError(AppException):
    def __init__(self, message: str, details: Optional[Any] = None):
        super().__init__(
            message=message,
            code=400,
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            details=details,
        )


class UnauthorizedError(AppException):
    def __init__(self, message: str = "未授权访问"):
        super().__init__(
            message=message,
            code=401,
            status_code=status.HTTP_401_UNAUTHORIZED,
        )


class ConflictError(AppException):
    def __init__(self, message: str):
        super().__init__(
            message=message,
            code=409,
            status_code=status.HTTP_409_CONFLICT,
        )


def exception_to_http(exc: AppException) -> HTTPException:
    return HTTPException(
        status_code=exc.status_code,
        detail={
            "code": exc.code,
            "message": exc.message,
            "details": exc.details,
        },
    )
