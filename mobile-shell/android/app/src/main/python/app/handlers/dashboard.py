"""仪表盘接口 handler（统计/近期预警/汇总，async）。"""
from datetime import datetime, timedelta

from app.core.responses import success_response
from app.core.auth import RequestContext
from app.db import database as db


async def get_stats(ctx: RequestContext):
    async def scalar(sql, params=()):
        row = await db.query_one_a(sql, params)
        return row["c"] if row else 0

    total_screenings = await scalar("SELECT COUNT(*) AS c FROM screenings")
    month_start = datetime.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    monthly_screenings = await scalar(
        "SELECT COUNT(*) AS c FROM screenings WHERE created_at >= ?", (month_start,))
    pending_alerts = await scalar("SELECT COUNT(*) AS c FROM alerts WHERE status = 'pending'")
    completed_screenings = await scalar("SELECT COUNT(*) AS c FROM screenings WHERE status = 'completed'")
    completion_rate = (completed_screenings / total_screenings * 100) if total_screenings else 0

    by_level = {level: 0 for level in ("green", "yellow", "orange", "red")}
    for row in await db.query_a("SELECT level, COUNT(*) AS c FROM alerts GROUP BY level"):
        if row["level"] in by_level:
            by_level[row["level"]] = row["c"]

    # 12 天趋势：按天 GROUP BY（避免 24 次查询）
    start_day = (datetime.now() - timedelta(days=11)).replace(hour=0, minute=0, second=0, microsecond=0)
    trend_map = {}
    for row in await db.query_a(
        "SELECT date(created_at) AS d, COUNT(*) AS c FROM screenings WHERE created_at >= ? GROUP BY d",
        (start_day,)):
        trend_map[row["d"]] = (row["c"], 0)
    for row in await db.query_a(
        "SELECT date(created_at) AS d, COUNT(*) AS c FROM alerts WHERE created_at >= ? GROUP BY d",
        (start_day,)):
        d, c = trend_map.get(row["d"], (0, 0))
        trend_map[row["d"]] = (d, row["c"])
    trend_data = []
    for i in range(11, -1, -1):
        date = datetime.now() - timedelta(days=i)
        key = date.strftime("%Y-%m-%d")
        count, alerts = trend_map.get(key, (0, 0))
        trend_data.append({"date": date.strftime("%m-%d"), "count": count, "alerts": alerts})

    return success_response(data={
        "total_screenings": total_screenings,
        "monthly_screenings": monthly_screenings,
        "pending_alerts": pending_alerts,
        "completion_rate": round(completion_rate, 1),
        "alert_distribution": by_level,
        "trend_data": trend_data,
    })


async def get_recent_alerts(ctx: RequestContext):
    limit = min(max(1, int(ctx.query_params.get("limit", 5) or 5)), 100)
    rows = await db.query_a(
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


async def get_summary(ctx: RequestContext):
    async def scalar(sql):
        row = await db.query_one_a(sql)
        return row["c"] if row else 0

    return success_response(data={
        "total_cases": await scalar("SELECT COUNT(*) AS c FROM cases"),
        "active_cases": await scalar("SELECT COUNT(*) AS c FROM cases WHERE status = 'active'"),
        "monitoring_cases": await scalar("SELECT COUNT(*) AS c FROM cases WHERE status = 'monitoring'"),
    })
