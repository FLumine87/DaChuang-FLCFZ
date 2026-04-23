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


@router.get("/test")
async def test_admin():
    return success_response(data={"message": "Hello, admin!"})

@router.get("/dashboard")
async def get_admin_dashboard(
    db: Session = Depends(get_db)
):
    return success_response(data={
        "trendData": [],
        "alertDistribution": [],
        "alertRecords": [],
        "screeningRecords": [],
        "caseRecords": []
    })


@router.get("/screenings")
async def get_admin_screenings(
    db: Session = Depends(get_db)
):
    service = ScreeningService(db)
    result = service.get_screenings(
        page=1,
        page_size=100
    )
    return success_response(data=result["items"])


@router.get("/alerts")
async def get_admin_alerts(
    db: Session = Depends(get_db)
):
    service = AlertService(db)
    result = service.get_alerts(
        page=1,
        page_size=100
    )
    return success_response(data=result["items"])


@router.get("/cases")
async def get_admin_cases(
    db: Session = Depends(get_db)
):
    service = CaseService(db)
    result = service.get_cases(
        page=1,
        page_size=100
    )
    return success_response(data=result["items"])


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