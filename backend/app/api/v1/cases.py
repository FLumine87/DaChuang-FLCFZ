from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from app.db.session import get_db
from app.core.responses import success_response, paginated_response
from app.schemas.case import (
    CaseCreate,
    CaseUpdate,
    CaseResponse,
    CaseListResponse,
    CaseDetail,
    CaseTagCreate,
    CaseTagResponse,
    TimelineEventCreate,
    TimelineEventResponse,
)
from app.services.case_service import CaseService

router = APIRouter()


@router.get("/tags")
async def list_case_tags(db: Session = Depends(get_db)):
    service = CaseService(db)
    tags = service.get_all_tags()
    return success_response(data=[CaseTagResponse.model_validate(t) for t in tags])


@router.post("/tags")
async def create_case_tag(
    data: CaseTagCreate,
    db: Session = Depends(get_db)
):
    service = CaseService(db)
    tag = service.create_tag(data)
    return success_response(data=CaseTagResponse.model_validate(tag))


@router.get("")
async def list_cases(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    alert_level: Optional[str] = None,
    status: Optional[str] = None,
    keyword: Optional[str] = None,
    db: Session = Depends(get_db)
):
    service = CaseService(db)
    result = service.get_cases(
        page=page,
        page_size=page_size,
        alert_level=alert_level,
        status=status,
        keyword=keyword,
    )
    return paginated_response(
        items=[CaseListResponse.model_validate(c) for c in result["items"]],
        total=result["total"],
        page=page,
        page_size=page_size,
    )


@router.post("")
async def create_case(
    data: CaseCreate,
    db: Session = Depends(get_db)
):
    service = CaseService(db)
    case = service.create_case(data)
    return success_response(data=CaseResponse.model_validate(case))


@router.get("/{case_id}")
async def get_case(
    case_id: int,
    db: Session = Depends(get_db)
):
    service = CaseService(db)
    case = service.get_case_by_id(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="案例不存在")
    return success_response(data=CaseDetail.model_validate(case))


@router.put("/{case_id}")
async def update_case(
    case_id: int,
    data: CaseUpdate,
    db: Session = Depends(get_db)
):
    service = CaseService(db)
    case = service.update_case(case_id, data)
    if not case:
        raise HTTPException(status_code=404, detail="案例不存在")
    return success_response(data=CaseResponse.model_validate(case))


@router.delete("/{case_id}")
async def delete_case(
    case_id: int,
    db: Session = Depends(get_db)
):
    service = CaseService(db)
    success = service.delete_case(case_id)
    if not success:
        raise HTTPException(status_code=404, detail="案例不存在")
    return success_response(message="删除成功")


@router.get("/{case_id}/timeline")
async def get_case_timeline(
    case_id: int,
    db: Session = Depends(get_db)
):
    service = CaseService(db)
    events = service.get_timeline(case_id)
    return success_response(data=[TimelineEventResponse.model_validate(e) for e in events])


@router.post("/{case_id}/timeline")
async def add_timeline_event(
    case_id: int,
    data: TimelineEventCreate,
    db: Session = Depends(get_db)
):
    service = CaseService(db)
    event = service.add_timeline_event(case_id, data)
    return success_response(data=TimelineEventResponse.model_validate(event))
