"""文件上传接口 handler。

本地：完整实现——解析 multipart/form-data，落盘到 backend/uploads/，
     并对图像 / 语音跑**与检索同一套**的真实特征提取（real_features），
     结果作为 analysis 返回、同时写入 media_files 表留档；
     返回的 file_path 是可直接访问的 /uploads/... 静态地址（见 server.py）。
Worker：保持 503 占位——R2 尚未激活（wrangler.toml 中 r2_buckets 被注释），
     且 Python Worker 的 multipart 解析存在 ~1MB body 限制（workerd issue #6127）。

本地实现为什么值得做：个人端「多模态采集」页把音频/图像文件上传后挂到筛查记录上
（POST /api/personal/screenings/{id}/supplement），此前 /api/upload 固定 503，
整条采集链路在真实模式下不可用（2026-10-14 修复）。
"""
import os
import re
import time
import uuid
from email.parser import BytesParser
from email.policy import default as email_policy

from app.core.responses import success_response
from app.core.exceptions import HttpError
from app.core.auth import RequestContext
from app.core import runtime
from app.db import database as db

# 与 server.py 的 os.makedirs("uploads") 指向同一目录；用绝对路径兜底 CWD 差异
UPLOAD_ROOT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "uploads",
)

# 单文件上限（本地演示足够；更大的视频等素材不在采集场景里）
MAX_UPLOAD_BYTES = 30 * 1024 * 1024

_MIME_KIND = (
    ("image/", "images"),
    ("audio/", "audio"),
    ("video/", "video"),
)


def _kind_dir(mime: str) -> str:
    for prefix, kind in _MIME_KIND:
        if (mime or "").startswith(prefix):
            return kind
    return "files"


def _safe_name(name: str) -> str:
    """文件名白名单化：只留基本字符，防止路径穿越与奇怪字符。"""
    base = os.path.basename(name or "").replace("\\", "/").split("/")[-1]
    base = re.sub(r"[^\w\u4e00-\u9fff.\-() ]+", "_", base).strip(" .")
    return base[:120] or "unnamed"


def _parse_multipart(body: bytes, content_type: str) -> tuple[str, str, bytes]:
    """解析 multipart/form-data，取第一个文件字段。

    用标准库 email 模块解析（Python 3.13 起 cgi 已移除，不再有 FieldStorage）。
    返回 (字段名, 文件名, 内容字节)。
    """
    header = (
        f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n"
    ).encode("utf-8")
    msg = BytesParser(policy=email_policy).parsebytes(header + body)
    if not msg.is_multipart():
        raise HttpError(400, "请求不是 multipart/form-data 格式")
    for part in msg.iter_parts():
        filename = part.get_filename()
        field = part.get_param("name", header="content-disposition") or ""
        payload = part.get_payload(decode=True) or b""
        if filename is not None or field == "file":
            return field, filename or "unnamed", payload
    raise HttpError(400, "请求里没有文件字段")


def _analyze(kind_dir: str, path: str) -> str:
    """对上传文件跑真实特征提取（与跨模态检索共用 real_features）。

    抽不出特征（依赖缺失 / 文件损坏）时返回通用说明，不阻塞上传。
    """
    try:
        from app.engines.hashing import real_features as RF

        if kind_dir == "images":
            feat = RF.image_feature(path)
            if feat:
                return f"已完成 {len(feat)} 维面部图像特征提取与哈希编码，可在「检索与分析」中按图检索。"
        elif kind_dir == "audio":
            feat = RF.audio_feature(path)
            if feat:
                return f"已完成 {len(feat)} 维语音特征（MFCC+韵律）提取与哈希编码，可在「检索与分析」中按语音检索。"
    except Exception:
        pass
    return "文件已保存并登记到你的档案；该类型暂未纳入哈希编码。"


async def upload_file(ctx: RequestContext):
    if runtime.is_worker():
        raise HttpError(503, "文件上传功能暂未启用（R2 存储未激活 / multipart 解析受限），其余功能不受影响")

    content_type = ctx.headers.get("content-type", "")
    if "multipart/form-data" not in content_type:
        raise HttpError(400, "请使用 multipart/form-data 上传文件")
    body = getattr(ctx, "_body_bytes", b"") or b""
    if not body:
        raise HttpError(400, "请求体为空")
    if len(body) > MAX_UPLOAD_BYTES:
        raise HttpError(413, f"文件过大（上限 {MAX_UPLOAD_BYTES // 1024 // 1024}MB）")

    _, filename, payload = _parse_multipart(body, content_type)
    if not payload:
        raise HttpError(400, "文件内容为空")

    ext = os.path.splitext(filename)[1].lower()
    mime = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".webp": "image/webp", ".gif": "image/gif",
        ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
        ".webm": "audio/webm", ".ogg": "audio/ogg",
    }.get(ext, "application/octet-stream")
    kind_dir = _kind_dir(mime)

    # 落盘：时间戳 + 随机串前缀，避免同名覆盖；目录按类型分，静态服务直接按 URL 取
    stored_name = f"{int(time.time())}_{uuid.uuid4().hex[:8]}_{_safe_name(filename)}"
    dir_path = os.path.join(UPLOAD_ROOT, kind_dir)
    os.makedirs(dir_path, exist_ok=True)
    file_path_abs = os.path.join(dir_path, stored_name)
    with open(file_path_abs, "wb") as fh:
        fh.write(payload)

    analysis = _analyze(kind_dir, file_path_abs)
    file_id = uuid.uuid4().hex[:16]
    uploaded_by = None
    try:
        uploaded_by = int((ctx.user or {}).get("sub"))
    except (TypeError, ValueError):
        pass
    await db.execute_a(
        "INSERT INTO media_files (file_id, screening_id, file_type, file_name, file_path, "
        "file_size, mime_type, description, analysis_result, uploaded_by) "
        "VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)",
        (file_id, kind_dir, _safe_name(filename), f"/uploads/{kind_dir}/{stored_name}",
         len(payload), mime, analysis, analysis, uploaded_by),
    )

    return success_response(data={
        "file_id": file_id,
        "file_name": _safe_name(filename),
        "file_path": f"/uploads/{kind_dir}/{stored_name}",
        "file_size": len(payload),
        "mime_type": mime,
        "analysis": analysis,
    })


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
