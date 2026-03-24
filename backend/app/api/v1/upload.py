from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Form
from sqlalchemy.orm import Session
from typing import Optional
import os
import uuid
from datetime import datetime

from app.db.session import get_db
from app.config import settings
from app.core.responses import success_response
from app.schemas.retrieval import MediaUploadResponse

router = APIRouter()


ALLOWED_AUDIO_TYPES = ["audio/mpeg", "audio/wav", "audio/mp3", "audio/m4a", "audio/ogg"]
ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"]
ALLOWED_DOC_TYPES = ["application/pdf", "text/plain", "application/msword"]


def get_file_type(mime_type: str) -> str:
    if mime_type in ALLOWED_AUDIO_TYPES:
        return "audio"
    elif mime_type in ALLOWED_IMAGE_TYPES:
        return "image"
    elif mime_type in ALLOWED_DOC_TYPES:
        return "document"
    return "other"


@router.post("")
async def upload_file(
    file: UploadFile = File(...),
    screening_id: Optional[int] = Form(None),
    description: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")
    
    file_type = get_file_type(file.content_type or "")
    
    if file_type == "other":
        raise HTTPException(
            status_code=400, 
            detail=f"不支持的文件类型: {file.content_type}"
        )
    
    file_id = f"FILE-{uuid.uuid4().hex[:8].upper()}"
    
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    safe_filename = f"{timestamp}_{file.filename}"
    
    upload_dir = os.path.join(settings.UPLOAD_DIR, file_type)
    os.makedirs(upload_dir, exist_ok=True)
    
    file_path = os.path.join(upload_dir, safe_filename)
    
    content = await file.read()
    file_size = len(content)
    
    if file_size > settings.MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=400, detail="文件大小超过限制")
    
    with open(file_path, "wb") as f:
        f.write(content)
    
    from app.db.models.media import MediaFile
    
    media = MediaFile(
        file_id=file_id,
        screening_id=screening_id,
        file_type=file_type,
        file_name=file.filename,
        file_path=file_path,
        file_size=file_size,
        mime_type=file.content_type,
        description=description,
    )
    
    db.add(media)
    db.commit()
    db.refresh(media)
    
    return success_response(data={
        "file_id": media.file_id,
        "file_type": media.file_type,
        "file_name": media.file_name,
        "file_path": f"/uploads/{file_type}/{safe_filename}",
        "file_size": media.file_size,
        "created_at": media.created_at.isoformat() if media.created_at else None
    })


@router.get("/{file_id}")
async def get_file_info(
    file_id: str,
    db: Session = Depends(get_db)
):
    from app.db.models.media import MediaFile
    
    media = db.query(MediaFile).filter(MediaFile.file_id == file_id).first()
    if not media:
        raise HTTPException(status_code=404, detail="文件不存在")
    
    return success_response(data={
        "file_id": media.file_id,
        "file_type": media.file_type,
        "file_name": media.file_name,
        "file_path": f"/uploads/{media.file_type}/{os.path.basename(media.file_path)}",
        "file_size": media.file_size,
        "description": media.description,
        "created_at": media.created_at.isoformat() if media.created_at else None
    })


@router.delete("/{file_id}")
async def delete_file(
    file_id: str,
    db: Session = Depends(get_db)
):
    from app.db.models.media import MediaFile
    
    media = db.query(MediaFile).filter(MediaFile.file_id == file_id).first()
    if not media:
        raise HTTPException(status_code=404, detail="文件不存在")
    
    if os.path.exists(media.file_path):
        os.remove(media.file_path)
    
    db.delete(media)
    db.commit()
    
    return success_response(message="文件删除成功")
