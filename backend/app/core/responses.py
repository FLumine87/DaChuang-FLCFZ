from typing import Any, Optional, Generic, TypeVar
from pydantic import BaseModel

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    code: int = 0
    message: str = "success"
    data: Optional[T] = None

    class Config:
        from_attributes = True


class PaginatedData(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int


def success_response(data: Any = None, message: str = "success") -> dict:
    return {
        "code": 0,
        "message": message,
        "data": data,
    }


def error_response(message: str, code: int = 1, details: Any = None) -> dict:
    return {
        "code": code,
        "message": message,
        "data": details,
    }


def paginated_response(
    items: list,
    total: int,
    page: int,
    page_size: int,
) -> dict:
    total_pages = (total + page_size - 1) // page_size if page_size > 0 else 0
    return success_response(
        data={
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        }
    )
