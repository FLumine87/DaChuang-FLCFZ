"""仪表盘接口 handler（统计/近期预警/汇总）。"""
from datetime import datetime, timedelta

from app.core.responses import success_response
from app.core.auth import RequestContext
from app.db import database as db


def get_stats(ctx: RequestContext):
    def scalar(sql, params=()):
        return db.query_one(sql, params)["c"]

    total_screenings = scalar("SELECT COUNT(*) AS c FROM screenings")
    month_start = datetime.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    monthly_screenings = scalar(
        "SELECT COUNT(*) AS c FROM screenings WHERE created_at >= ?", (month_start,))
    pending_alerts = scalar("SELECT COUNT(*) AS c FROM alerts WHERE status = 'pending'")
    completed_screenings = scalar("SELECT COUNT(*) AS c FROM screenings WHERE status = 'completed'")
    completion_rate = (completed_screenings / total_screenings * 100) if total_screenings else 0

    by_level = {}
    for level in ("green", "yellow", "orange", "red"):
        by_level[level] = scalar("SELECT COUNT(*) AS c FROM alerts WHERE level = ?", (level,))

    trend_data = []
    for i in range(11, -1, -1):
        date = datetime.now() - timedelta(days=i)
        day_start = date.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        count = scalar(
            "SELECT COUNT(*) AS c FROM screenings WHERE created_at >= ? AND created_at < ?",
            (day_start, day_end))
        alerts = scalar(
            "SELECT COUNT(*) AS c FROM alerts WHERE created_at >= ? AND created_at < ?",
            (day_start, day_end))
        trend_data.append({"date": date.strftime("%m-%d"), "count": count, "alerts": alerts})

    return success_response(data={
        "total_screenings": total_screenings,
        "monthly_screenings": monthly_screenings,
        "pending_alerts": pending_alerts,
        "completion_rate": round(completion_rate, 1),
        "alert_distribution": by_level,
        "trend_data": trend_data,
    })


def get_recent_alerts(ctx: RequestContext):
    limit = min(max(1, int(ctx.query_params.get("limit", 5) or 5)), 100)
    rows = db.query(
        "SELECT a.*, u.name AS assignee_name FROM alerts a "
        "LEFT JOIN users u ON a.assignee_id = u.id "
        "ORDER BY a.created_at DESC LIMIT ?", (limit,))
    result = []
    for r in rows:
        result.append({
            "id": r.get("id"),
            "alert_id": r.get("alert_id"),
            "name": r.get("name"),
            "level": r.get("level"),
            "trigger": r.get("trigger"),
            "status": r.get("status"),
            "created_at": r.get("created_at"),
            "assignee_name": r.get("assignee_name"),
        })
    return success_response(data=result)


def get_summary(ctx: RequestContext):
    def scalar(sql):
        return db.query_one(sql)["c"]

    return success_response(data={
        "total_cases": scalar("SELECT COUNT(*) AS c FROM cases"),
        "active_cases": scalar("SELECT COUNT(*) AS c FROM cases WHERE status = 'active'"),
        "monitoring_cases": scalar("SELECT COUNT(*) AS c FROM cases WHERE status = 'monitoring'"),
    })
