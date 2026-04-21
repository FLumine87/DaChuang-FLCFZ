from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from app.db.session import get_db
from app.core.responses import success_response, paginated_response
from app.services.screening_service import ScreeningService
from app.services.alert_service import AlertService
from app.services.case_service import CaseService
from app.engines.hashing.mock_engine import MockHashingEngine
from app.engines.rag.mock_engine import MockRAGEngine

router = APIRouter()


@router.get("/dashboard")
async def get_admin_dashboard(
    db: Session = Depends(get_db)
):
    screening_service = ScreeningService(db)
    alert_service = AlertService(db)
    case_service = CaseService(db)

    screenings = screening_service.get_screenings(page=1, page_size=100)
    alerts = alert_service.get_alerts(page=1, page_size=100)
    cases = case_service.get_cases(page=1, page_size=100)

    return success_response(data={
        "screeningRecords": screenings["items"],
        "alertRecords": alerts["items"],
        "caseRecords": cases["items"],
        "totalScreenings": screenings["total"],
        "totalAlerts": alerts["total"],
        "totalCases": cases["total"]
    })


@router.get("/screenings")
async def get_admin_screenings(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    status: Optional[str] = None,
    alert_level: Optional[str] = None,
    db: Session = Depends(get_db)
):
    service = ScreeningService(db)
    result = service.get_screenings(
        page=page,
        page_size=page_size,
        status=status,
        alert_level=alert_level
    )
    return paginated_response(
        items=result["items"],
        total=result["total"],
        page=page,
        page_size=page_size
    )


@router.get("/alerts")
async def get_admin_alerts(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    level: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db)
):
    service = AlertService(db)
    result = service.get_alerts(
        page=page,
        page_size=page_size,
        level=level,
        status=status
    )
    return paginated_response(
        items=result["items"],
        total=result["total"],
        page=page,
        page_size=page_size
    )


@router.get("/cases")
async def get_admin_cases(
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
        keyword=keyword
    )
    return paginated_response(
        items=result["items"],
        total=result["total"],
        page=page,
        page_size=page_size
    )


@router.post("/search")
async def admin_search(
    data: dict,
    db: Session = Depends(get_db)
):
    query = data.get("query", "")
    engine = MockHashingEngine()
    results = await engine.search(query=query, modality="text", top_k=10)

    rag_engine = MockRAGEngine()
    report = await rag_engine.generate_report({
        "id": 0,
        "name": "综合检索报告",
        "questionnaire": "综合评估",
        "score": 0,
        "max_score": 100,
        "alert_level": "green"
    })

    return success_response(data={
        "results": results,
        "report": report,
        "query": query
    })


@router.get("/data-collection")
async def get_admin_data_collection(
    db: Session = Depends(get_db)
):
    return success_response(data={
        "textSubmissions": [],
        "audioSubmissions": [],
        "imageSubmissions": []
    })