from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta

from app.db.session import get_db
from app.core.responses import success_response

from app.db.models.screening import Screening
from app.db.models.alert import Alert

router = APIRouter()


@router.get("/stats")
async def get_dashboard_stats(db: Session = Depends(get_db)):
    total_screenings = db.query(func.count(Screening.id)).scalar() or 0
    
    month_start = datetime.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    monthly_screenings = db.query(func.count(Screening.id)).filter(
        Screening.created_at >= month_start
    ).scalar() or 0
    
    pending_alerts = db.query(func.count(Alert.id)).filter(
        Alert.status == "pending"
    ).scalar() or 0
    
    completed_screenings = db.query(func.count(Screening.id)).filter(
        Screening.status == "completed"
    ).scalar() or 0
    completion_rate = (completed_screenings / total_screenings * 100) if total_screenings > 0 else 0
    
    green_count = db.query(func.count(Alert.id)).filter(Alert.level == "green").scalar() or 0
    yellow_count = db.query(func.count(Alert.id)).filter(Alert.level == "yellow").scalar() or 0
    orange_count = db.query(func.count(Alert.id)).filter(Alert.level == "orange").scalar() or 0
    red_count = db.query(func.count(Alert.id)).filter(Alert.level == "red").scalar() or 0
    
    alert_distribution = {
        "green": green_count,
        "yellow": yellow_count,
        "orange": orange_count,
        "red": red_count,
    }
    
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
    
    return success_response(data={
        "total_screenings": total_screenings,
        "monthly_screenings": monthly_screenings,
        "pending_alerts": pending_alerts,
        "completion_rate": round(completion_rate, 1),
        "alert_distribution": alert_distribution,
        "trend_data": trend_data
    })


@router.get("/recent-alerts")
async def get_recent_alerts(
    limit: int = 5,
    db: Session = Depends(get_db)
):
    alerts = db.query(Alert).order_by(Alert.created_at.desc()).limit(limit).all()
    
    result = []
    for alert in alerts:
        result.append({
            "id": alert.id,
            "alert_id": alert.alert_id,
            "name": alert.name,
            "level": alert.level,
            "trigger": alert.trigger,
            "status": alert.status,
            "created_at": alert.created_at.strftime("%Y-%m-%d %H:%M"),
            "assignee_name": alert.assignee_user.name if alert.assignee_user else None
        })
    
    return success_response(data=result)


@router.get("/summary")
async def get_summary(db: Session = Depends(get_db)):
    from app.db.models.case import Case
    
    total_cases = db.query(func.count(Case.id)).scalar() or 0
    active_cases = db.query(func.count(Case.id)).filter(Case.status == "active").scalar() or 0
    monitoring_cases = db.query(func.count(Case.id)).filter(Case.status == "monitoring").scalar() or 0
    
    return success_response(data={
        "total_cases": total_cases,
        "active_cases": active_cases,
        "monitoring_cases": monitoring_cases
    })
