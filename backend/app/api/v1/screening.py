from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime

from app.db.session import get_db
from app.core.responses import success_response, paginated_response
from app.schemas.screening import (
    ScreeningCreate,
    ScreeningUpdate,
    ScreeningResponse,
    ScreeningListResponse,
    ScreeningDetail,
    QuestionnaireCreate,
    QuestionnaireResponse,
)
from app.services.screening_service import ScreeningService

router = APIRouter()


@router.get("/questionnaires")
async def list_questionnaires(db: Session = Depends(get_db)):
    service = ScreeningService(db)
    questionnaires = service.get_all_questionnaires()
    return success_response(data=[QuestionnaireResponse.model_validate(q) for q in questionnaires])


@router.post("/questionnaires")
async def create_questionnaire(
    data: QuestionnaireCreate,
    db: Session = Depends(get_db)
):
    service = ScreeningService(db)
    questionnaire = service.create_questionnaire(data)
    return success_response(data=QuestionnaireResponse.model_validate(questionnaire))


@router.get("")
async def list_screenings(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    status: Optional[str] = None,
    alert_level: Optional[str] = None,
    questionnaire_id: Optional[int] = None,
    keyword: Optional[str] = None,
    db: Session = Depends(get_db)
):
    service = ScreeningService(db)
    result = service.get_screenings(
        page=page,
        page_size=page_size,
        status=status,
        alert_level=alert_level,
        questionnaire_id=questionnaire_id,
        keyword=keyword,
    )
    return paginated_response(
        items=[ScreeningListResponse.model_validate(s) for s in result["items"]],
        total=result["total"],
        page=page,
        page_size=page_size,
    )


@router.post("")
async def create_screening(
    data: ScreeningCreate,
    db: Session = Depends(get_db)
):
    service = ScreeningService(db)
    screening = service.create_screening(data)
    return success_response(data=ScreeningResponse.model_validate(screening))


@router.get("/{screening_id}")
async def get_screening(
    screening_id: int,
    db: Session = Depends(get_db)
):
    service = ScreeningService(db)
    screening = service.get_screening_by_id(screening_id)
    if not screening:
        raise HTTPException(status_code=404, detail="筛查记录不存在")
    return success_response(data=ScreeningDetail.model_validate(screening))


@router.put("/{screening_id}")
async def update_screening(
    screening_id: int,
    data: ScreeningUpdate,
    db: Session = Depends(get_db)
):
    service = ScreeningService(db)
    screening = service.update_screening(screening_id, data)
    if not screening:
        raise HTTPException(status_code=404, detail="筛查记录不存在")
    return success_response(data=ScreeningResponse.model_validate(screening))


@router.delete("/{screening_id}")
async def delete_screening(
    screening_id: int,
    db: Session = Depends(get_db)
):
    service = ScreeningService(db)
    success = service.delete_screening(screening_id)
    if not success:
        raise HTTPException(status_code=404, detail="筛查记录不存在")
    return success_response(message="删除成功")


@router.post("/{screening_id}/complete")
async def complete_screening(
    screening_id: int,
    score: int,
    db: Session = Depends(get_db)
):
    service = ScreeningService(db)
    screening = service.complete_screening(screening_id, score)
    if not screening:
        raise HTTPException(status_code=404, detail="筛查记录不存在")
    return success_response(data=ScreeningResponse.model_validate(screening))
