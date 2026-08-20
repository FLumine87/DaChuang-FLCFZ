"""文件上传接口 handler（占位）。

说明：轻量化版本暂未实现 multipart 解析与对象存储写入。
  - Worker：R2 尚未激活（wrangler.toml 中 r2_buckets 被注释），且 Python Worker 的
    multipart 解析存在 ~1MB body 限制（workerd issue #6127），故上传暂返回 503 占位；
  - 本地：如需在本地演示上传，可暂用 VITE_USE_MOCK 或后续按
    DEVELOP.md「八、待办 · R2 激活」恢复（实现 multipart 解析 + R2/磁盘双写）。

预留改进方向：解析 multipart/form-data → 写入 R2（或本地磁盘）→ 多模态 Mock 分析。
"""
from app.core.responses import success_response
from app.core.exceptions import HttpError
from app.core.auth import RequestContext
from app.core import runtime


async def upload_file(ctx: RequestContext):
    raise HttpError(503, "文件上传功能暂未启用（R2 存储未激活 / multipart 解析待实现），其余功能不受影响")


async def get_file_info(ctx: RequestContext, file_id: str):
    from app.db import database as db
    media = await db.query_one_a("SELECT * FROM media_files WHERE file_id = ?", (file_id,))
    if not media:
        raise HttpError(404, "文件不存在")
    file_type = media.get("file_type") or "document"
    file_name = str(media.get("file_path") or "").split("/")[-1]
    return success_response(data={
        "file_id": media.get("file_id"),
        "file_type": file_type,
        "file_name": media.get("file_name"),
        "file_path": f"/uploads/{file_type}/{file_name}",
        "file_size": media.get("file_size"),
        "description": media.get("description"),
        "created_at": media.get("created_at"),
    })


async def delete_file(ctx: RequestContext, file_id: str):
    from app.db import database as db
    media = await db.query_one_a("SELECT * FROM media_files WHERE file_id = ?", (file_id,))
    if not media:
        raise HttpError(404, "文件不存在")
    await db.execute_a("DELETE FROM media_files WHERE file_id = ?", (file_id,))
    return success_response(message="文件删除成功")
