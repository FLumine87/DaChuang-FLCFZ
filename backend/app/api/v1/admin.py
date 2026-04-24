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
    from app.db.models.screening import Screening, Questionnaire
    from app.db.models.alert import Alert
    from app.db.models.case import Case
    from sqlalchemy import func
    from datetime import datetime, timedelta

    trend_data = []
    for i in range(11, -1, -1):
        date = datetime.now() - timedelta(days=i)
        date_str = date.strftime("%m-%d")

        day_start = date.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)

        count = db.query(func.count(Screening.id)).filter(
            Screening.created_at >= day_start,
            Screening.created_at < day_end
        ).scalar() or 0

        alerts = db.query(func.count(Alert.id)).filter(
            Alert.created_at >= day_start,
            Alert.created_at < day_end
        ).scalar() or 0

        trend_data.append({
            "date": date_str,
            "count": count,
            "alerts": alerts
        })

    green_count = db.query(func.count(Alert.id)).filter(Alert.level == "green").scalar() or 0
    yellow_count = db.query(func.count(Alert.id)).filter(Alert.level == "yellow").scalar() or 0
    orange_count = db.query(func.count(Alert.id)).filter(Alert.level == "orange").scalar() or 0
    red_count = db.query(func.count(Alert.id)).filter(Alert.level == "red").scalar() or 0

    alert_distribution = [
        {"name": "正常(绿)", "value": green_count, "color": "#22c55e"},
        {"name": "关注(黄)", "value": yellow_count, "color": "#f59e0b"},
        {"name": "警告(橙)", "value": orange_count, "color": "#f97316"},
        {"name": "危险(红)", "value": red_count, "color": "#ef4444"}
    ]

    alerts = db.query(Alert).order_by(Alert.created_at.desc()).limit(10).all()
    alert_records = []
    for a in alerts:
        screening = db.query(Screening).filter(Screening.id == a.screening_id).first()
        counselor_name = screening.counselor.name if screening and screening.counselor else "未分配"
        alert_records.append({
            "id": a.alert_id,
            "screeningId": screening.screening_id if screening else "",
            "name": a.name,
            "level": a.level,
            "trigger": a.trigger or "",
            "description": a.description or "",
            "status": a.status,
            "assignee": counselor_name,
            "createdAt": a.created_at.strftime("%Y-%m-%d %H:%M") if a.created_at else "",
            "updatedAt": a.updated_at.strftime("%Y-%m-%d %H:%M") if a.updated_at else ""
        })

    screenings = db.query(Screening).order_by(Screening.screening_date.desc()).limit(20).all()
    screening_records = []
    for s in screenings:
        questionnaire = db.query(Questionnaire).filter(Questionnaire.id == s.questionnaire_id).first()
        counselor_name = s.counselor.name if s.counselor else "未分配"
        screening_records.append({
            "id": s.screening_id,
            "name": s.name,
            "age": s.age or 0,
            "gender": s.gender or "",
            "questionnaire": questionnaire.name if questionnaire else "未知",
            "score": s.score,
            "maxScore": s.max_score,
            "status": s.status,
            "alertLevel": s.alert_level,
            "date": s.screening_date.strftime("%Y-%m-%d") if s.screening_date else s.created_at.strftime("%Y-%m-%d"),
            "counselor": counselor_name
        })

    cases = db.query(Case).order_by(Case.created_at.desc()).limit(20).all()
    case_records = []
    for c in cases:
        case_records.append({
            "id": c.case_id,
            "name": c.name,
            "age": c.age or 0,
            "gender": c.gender or "",
            "department": c.department or "",
            "tags": [],
            "screeningCount": c.screening_count or 0,
            "lastScreening": c.last_screening_date.strftime("%Y-%m-%d") if c.last_screening_date else "",
            "alertLevel": c.alert_level,
            "status": c.status
        })

    return success_response(data={
        "trendData": trend_data,
        "alertDistribution": alert_distribution,
        "alertRecords": alert_records,
        "screeningRecords": screening_records,
        "caseRecords": case_records
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