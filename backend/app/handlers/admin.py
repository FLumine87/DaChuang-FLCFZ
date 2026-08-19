"""管理端接口 handler（保留前端响应字段结构）。"""
from datetime import datetime, timedelta

from app.core.responses import success_response
from app.core.auth import RequestContext
from app.db import database as db
from app.engines import get_hashing_engine, get_rag_engine


def _fmt(v, fmt="%Y-%m-%d"):
    return v.strftime(fmt) if hasattr(v, "strftime") and v else (v or "")


def test_admin(ctx: RequestContext):
    return success_response(data={"message": "Hello, admin!"})


def get_admin_dashboard(ctx: RequestContext):
    trend_data = []
    for i in range(11, -1, -1):
        date = datetime.now() - timedelta(days=i)
        day_start = date.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        count = db.query_one(
            "SELECT COUNT(*) AS c FROM screenings WHERE created_at >= ? AND created_at < ?",
            (day_start, day_end))["c"]
        alerts = db.query_one(
            "SELECT COUNT(*) AS c FROM alerts WHERE created_at >= ? AND created_at < ?",
            (day_start, day_end))["c"]
        trend_data.append({"date": date.strftime("%m-%d"), "count": count, "alerts": alerts})

    dist = {}
    for level in ("green", "yellow", "orange", "red"):
        dist[level] = db.query_one(
            "SELECT COUNT(*) AS c FROM alerts WHERE level = ?", (level,))["c"]
    alert_distribution = [
        {"name": "正常(绿)", "value": dist.get("green", 0), "color": "#22c55e"},
        {"name": "关注(黄)", "value": dist.get("yellow", 0), "color": "#f59e0b"},
        {"name": "警告(橙)", "value": dist.get("orange", 0), "color": "#f97316"},
        {"name": "危险(红)", "value": dist.get("red", 0), "color": "#ef4444"},
    ]

    alerts = db.query("SELECT * FROM alerts ORDER BY created_at DESC, id DESC LIMIT 10")
    alert_records = []
    for a in alerts:
        screening = db.query_one("SELECT * FROM screenings WHERE id = ?", (a.get("screening_id"),))
        counselor = None
        if screening:
            counselor = db.query_one("SELECT * FROM users WHERE id = ?", (screening.get("counselor_id"),))
        alert_records.append({
            "id": a.get("alert_id"),
            "screeningId": screening.get("screening_id") if screening else "",
            "name": a.get("name"),
            "level": a.get("level"),
            "trigger": a.get("trigger") or "",
            "description": a.get("description") or "",
            "status": a.get("status"),
            "assignee": counselor.get("name") if counselor else "未分配",
            "createdAt": _fmt(a.get("created_at"), "%Y-%m-%d %H:%M"),
            "updatedAt": _fmt(a.get("updated_at"), "%Y-%m-%d %H:%M"),
        })

    screenings = db.query("SELECT * FROM screenings ORDER BY screening_date DESC, id DESC LIMIT 20")
    screening_records = []
    for s in screenings:
        qn = db.query_one("SELECT name FROM questionnaires WHERE id = ?", (s.get("questionnaire_id"),))
        counselor = db.query_one("SELECT name FROM users WHERE id = ?", (s.get("counselor_id"),))
        screening_records.append({
            "id": s.get("screening_id"),
            "name": s.get("name"),
            "age": s.get("age") or 0,
            "gender": s.get("gender") or "",
            "questionnaire": qn["name"] if qn else "未知",
            "score": s.get("score"),
            "maxScore": s.get("max_score"),
            "status": s.get("status"),
            "alertLevel": s.get("alert_level"),
            "date": _fmt(s.get("screening_date") or s.get("created_at")),
            "counselor": counselor["name"] if counselor else "未分配",
        })

    cases = db.query("SELECT * FROM cases ORDER BY created_at DESC, id DESC LIMIT 20")
    case_records = []
    for c in cases:
        case_records.append({
            "id": c.get("case_id"),
            "name": c.get("name"),
            "age": c.get("age") or 0,
            "gender": c.get("gender") or "",
            "department": c.get("department") or "",
            "tags": [],
            "screeningCount": c.get("screening_count") or 0,
            "lastScreening": _fmt(c.get("last_screening_date")),
            "alertLevel": c.get("alert_level"),
            "status": c.get("status"),
        })

    return success_response(data={
        "trendData": trend_data,
        "alertDistribution": alert_distribution,
        "alertRecords": alert_records,
        "screeningRecords": screening_records,
        "caseRecords": case_records,
    })


def get_admin_screenings(ctx: RequestContext):
    rows = db.query("SELECT * FROM screenings ORDER BY screening_date DESC, id DESC LIMIT 100")
    items = []
    for s in rows:
        qn = db.query_one("SELECT name FROM questionnaires WHERE id = ?", (s.get("questionnaire_id"),))
        counselor = db.query_one("SELECT name FROM users WHERE id = ?", (s.get("counselor_id"),))
        items.append({
            "id": s.get("screening_id"),
            "name": s.get("name"),
            "age": s.get("age") or 0,
            "gender": s.get("gender") or "",
            "questionnaire": qn["name"] if qn else "未知",
            "score": s.get("score"),
            "maxScore": s.get("max_score"),
            "status": s.get("status"),
            "alertLevel": s.get("alert_level"),
            "date": _fmt(s.get("screening_date") or s.get("created_at")),
            "counselor": counselor["name"] if counselor else "未分配",
        })
    return success_response(data=items)


def get_admin_alerts(ctx: RequestContext):
    alerts = db.query("SELECT * FROM alerts ORDER BY created_at DESC, id DESC LIMIT 100")
    items = []
    for a in alerts:
        screening = db.query_one("SELECT * FROM screenings WHERE id = ?", (a.get("screening_id"),))
        counselor = None
        if screening:
            counselor = db.query_one("SELECT name FROM users WHERE id = ?", (screening.get("counselor_id"),))
        items.append({
            "id": a.get("alert_id"),
            "screeningId": screening.get("screening_id") if screening else "",
            "name": a.get("name"),
            "level": a.get("level"),
            "trigger": a.get("trigger") or "",
            "description": a.get("description") or "",
            "status": a.get("status"),
            "assignee": counselor["name"] if counselor else "未分配",
            "createdAt": _fmt(a.get("created_at"), "%Y-%m-%d %H:%M"),
            "updatedAt": _fmt(a.get("updated_at"), "%Y-%m-%d %H:%M"),
        })
    return success_response(data=items)


def get_admin_cases(ctx: RequestContext):
    cases = db.query("SELECT * FROM cases ORDER BY created_at DESC, id DESC LIMIT 100")
    items = []
    for c in cases:
        items.append({
            "id": c.get("case_id"),
            "name": c.get("name"),
            "age": c.get("age") or 0,
            "gender": c.get("gender") or "",
            "department": c.get("department") or "",
            "tags": [],
            "screeningCount": c.get("screening_count") or 0,
            "lastScreening": _fmt(c.get("last_screening_date")),
            "alertLevel": c.get("alert_level"),
            "status": c.get("status"),
        })
    return success_response(data=items)


async def admin_search(ctx: RequestContext):
    query = ctx.body.get("query", "")
    engine = get_hashing_engine()
    raw_results = await engine.search(query=query, modality="text", top_k=10)
    results = [{**r, "alertLevel": r.get("alert_level", "green")} for r in raw_results]

    rag_engine = get_rag_engine()
    report = await rag_engine.generate_report({
        "id": 0, "name": "综合检索报告", "questionnaire": "综合评估",
        "score": 0, "max_score": 100, "alert_level": "green",
    })
    if isinstance(report, dict) and "risk_level" in report:
        report["riskLevel"] = report.pop("risk_level")

    return success_response(data={"results": results, "report": report, "query": query})


def get_admin_data_collection(ctx: RequestContext):
    return success_response(data={
        "textSubmissions": [],
        "audioSubmissions": [],
        "imageSubmissions": [],
    })
