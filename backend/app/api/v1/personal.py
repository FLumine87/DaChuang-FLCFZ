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
    db: Session = Depends(get_db)
):
    service = ScreeningService(db)
    result = service.get_screenings(page=1, page_size=100)
    return success_response(data=result["items"])


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
    from app.db.models.screening import Screening, Questionnaire
    from app.db.models.alert import Alert
    from sqlalchemy import func
    from datetime import datetime, timedelta

    questionnaires = db.query(Questionnaire).filter(Questionnaire.is_active == 1).all()
    questionnaire_catalog = [
        {
            "id": q.code,
            "name": q.name,
            "description": q.description or "",
            "questions": len(q.questions.split(",")) if q.questions else 0,
            "minutes": 3,
            "target": q.description or ""
        }
        for q in questionnaires
    ]

    screenings = db.query(Screening).order_by(Screening.screening_date.desc()).limit(10).all()
    screening_records = []
    for s in screenings:
        questionnaire_name = db.query(Questionnaire).filter(Questionnaire.id == s.questionnaire_id).first().name if s.questionnaire_id else "未知"
        screening_records.append({
            "id": s.screening_id,
            "questionnaire": questionnaire_name,
            "score": s.score,
            "maxScore": s.max_score,
            "level": s.alert_level,
            "status": s.status,
            "moodTag": s.notes or "已完成",
            "date": s.screening_date.strftime("%Y-%m-%d") if s.screening_date else s.created_at.strftime("%Y-%m-%d")
        })

    alerts = db.query(Alert).order_by(Alert.created_at.desc()).limit(5).all()
    warning_events = []
    for a in alerts:
        warning_events.append({
            "id": a.alert_id,
            "level": a.level,
            "title": a.trigger or "预警提醒",
            "reason": a.description or "",
            "suggestion": "建议及时关注并处理",
            "status": a.status if a.status in ["new", "tracking", "resolved"] else "new",
            "createdAt": a.created_at.strftime("%Y-%m-%d %H:%M") if a.created_at else "",
            "updatedAt": a.updated_at.strftime("%Y-%m-%d %H:%M") if a.updated_at else ""
        })

    mood_trend = []
    for i in range(10, 0, -1):
        date = datetime.now() - timedelta(days=i)
        date_str = date.strftime("%m-%d")
        mood_trend.append({
            "date": date_str,
            "mood": 60 + (i % 4) * 5,
            "stress": 50 + (i % 3) * 10,
            "sleep": 6.5 + (i % 3) * 0.5
        })

    green_count = db.query(func.count(Alert.id)).filter(Alert.level == "green").scalar() or 0
    yellow_count = db.query(func.count(Alert.id)).filter(Alert.level == "yellow").scalar() or 0
    orange_count = db.query(func.count(Alert.id)).filter(Alert.level == "orange").scalar() or 0
    red_count = db.query(func.count(Alert.id)).filter(Alert.level == "red").scalar() or 0

    warning_distribution = [
        {"name": "稳定", "value": green_count, "color": "#22c55e"},
        {"name": "关注", "value": yellow_count, "color": "#f59e0b"},
        {"name": "警告", "value": orange_count, "color": "#f97316"},
        {"name": "高危", "value": red_count, "color": "#ef4444"}
    ]

    action_plan = [
        {"id": "PLAN-1", "title": "定期筛查", "duration": "每周", "status": "tracking"},
        {"id": "PLAN-2", "title": "心理辅导", "duration": "每月", "status": "new"},
        {"id": "PLAN-3", "title": "情绪记录", "duration": "每日", "status": "resolved"}
    ]

    personal_timeline = []
    timeline_query = db.query(Screening).order_by(Screening.screening_date.desc()).limit(5).all()
    for idx, s in enumerate(timeline_query):
        questionnaire_name = db.query(Questionnaire).filter(Questionnaire.id == s.questionnaire_id).first().name if s.questionnaire_id else "筛查"
        personal_timeline.append({
            "date": s.screening_date.strftime("%Y-%m-%d") if s.screening_date else s.created_at.strftime("%Y-%m-%d"),
            "type": "screening",
            "title": f"完成{questionnaire_name}筛查",
            "detail": f"得分{s.score}分，风险等级:{s.alert_level}"
        })

    user_profile = {
        "name": "用户",
        "age": 0,
        "gender": "",
        "campus": "",
        "major": "",
        "stage": "",
        "emergencyContact": ""
    }
    if screenings:
        first_screening = screenings[0]
        user_profile["name"] = first_screening.name
        user_profile["gender"] = first_screening.gender or ""

    return success_response(data={
        "moodTrend": mood_trend,
        "warningDistribution": warning_distribution,
        "warningEvents": warning_events,
        "actionPlan": action_plan,
        "screeningRecords": screening_records,
        "userProfile": user_profile,
        "questionnaireCatalog": questionnaire_catalog,
        "personalTimeline": personal_timeline
    })


@router.get("/warnings")
async def get_personal_warnings(
    db: Session = Depends(get_db)
):
    service = AlertService(db)
    result = service.get_alerts(page=1, page_size=100)
    return success_response(data=result["items"])


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