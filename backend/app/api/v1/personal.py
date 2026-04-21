from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from app.db.session import get_db
from app.core.responses import success_response, paginated_response
from app.services.screening_service import ScreeningService
from app.services.alert_service import AlertService
from app.engines.hashing.mock_engine import MockHashingEngine
from app.engines.rag.mock_engine import MockRAGEngine

router = APIRouter()


@router.get("/screenings")
async def get_personal_screenings(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db)
):
    service = ScreeningService(db)
    result = service.get_screenings(page=page, page_size=page_size)
    return paginated_response(
        items=result["items"],
        total=result["total"],
        page=page,
        page_size=page_size
    )


@router.post("/screenings")
async def submit_personal_screening(
    data: dict,
    db: Session = Depends(get_db)
):
    service = ScreeningService(db)
    from app.db.models.screening import Questionnaire

    questionnaire_code = data.get("questionnaire", "")
    questionnaire = db.query(Questionnaire).filter(Questionnaire.code == questionnaire_code).first()

    if not questionnaire:
        return success_response(data={"id": "unknown", "status": "error"}, message="问卷不存在")

    from app.schemas.screening import ScreeningCreate
    from datetime import datetime

    screening_data = ScreeningCreate(
        name=data.get("name", "匿名用户"),
        age=data.get("age"),
        gender=data.get("gender"),
        department=data.get("department"),
        questionnaire_id=questionnaire.id,
        score=data.get("score", 0),
        answers=data.get("answers"),
        status="completed",
        notes=""
    )

    alert_level = data.get("level", "green")
    screening = service.create_screening(screening_data)
    screening.score = data.get("score", 0)
    screening.alert_level = alert_level
    screening.status = "completed"
    screening.screening_date = datetime.now()
    db.commit()
    db.refresh(screening)

    return success_response(data={
        "id": screening.screening_id,
        "status": "success",
        "riskLevel": alert_level
    })


@router.get("/dashboard")
async def get_personal_dashboard(
    db: Session = Depends(get_db)
):
    screening_service = ScreeningService(db)
    alert_service = AlertService(db)

    screenings = screening_service.get_screenings(page=1, page_size=100)["items"]
    alerts = alert_service.get_alerts(page=1, page_size=100)["items"]

    return success_response(data={
        "screeningRecords": screenings,
        "warningEvents": alerts,
        "totalScreenings": len(screenings),
        "totalAlerts": len(alerts)
    })


@router.get("/warnings")
async def get_personal_warnings(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db)
):
    service = AlertService(db)
    result = service.get_alerts(page=page, page_size=page_size)
    return paginated_response(
        items=result["items"],
        total=result["total"],
        page=page,
        page_size=page_size
    )


@router.get("/profile")
async def get_personal_profile(
    db: Session = Depends(get_db)
):
    return success_response(data={
        "screeningRecords": [],
        "warningEvents": [],
        "userProfile": None,
        "personalTimeline": []
    })


@router.post("/search")
async def personal_search(
    data: dict,
    db: Session = Depends(get_db)
):
    query = data.get("query", "")
    engine = MockHashingEngine()
    results = await engine.search(query=query, modality="text", top_k=5)

    rag_engine = MockRAGEngine()
    report = await rag_engine.generate_report({
        "id": 0,
        "name": "检索报告",
        "questionnaire": "综合",
        "score": 0,
        "max_score": 100,
        "alert_level": "green"
    })

    return success_response(data={
        "results": results,
        "report": report,
        "query": query
    })


@router.post("/upload")
async def personal_upload(
    file_data: dict,
    db: Session = Depends(get_db)
):
    return success_response(data={
        "url": "/uploads/temp/file",
        "filename": file_data.get("filename", "unknown"),
        "analysis": "文件分析完成"
    })