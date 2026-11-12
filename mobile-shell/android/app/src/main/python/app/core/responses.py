"""统一响应结构（纯标准库，去掉 pydantic）。"""


def success_response(data=None, message: str = "success"):
    return {
        "code": 0,
        "message": message,
        "data": data,
    }


def error_response(message: str, code: int = 1, details=None):
    return {
        "code": code,
        "message": message,
        "data": details,
    }


def paginated_response(items, total: int, page: int, page_size: int):
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
