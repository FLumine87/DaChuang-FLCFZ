"""管理端接口 handler（保留前端响应字段结构，async）。"""
from datetime import datetime, timedelta

from app.core.responses import success_response
from app.core.auth import RequestContext
from app.db import database as db
from app.engines import get_hashing_engine, get_rag_engine


def _fmt(v, fmt="%Y-%m-%d"):
    return v.strftime(fmt) if hasattr(v, "strftime") and v else (v or "")


async def _counselor_name(counselor_id):
    if not counselor_id:
        return None
    row = await db.query_one_a("SELECT name FROM users WHERE id = ?", (counselor_id,))
    return row["name"] if row else None


async def test_admin(ctx: RequestContext):
    return success_response(data={"message": "Hello, admin!"})


async def get_admin_dashboard(ctx: RequestContext):
    # 优化：合并统计查询，减少 D1 调用次数（免费计划 CPU 10ms 限制）

    # 12 天筛查/预警趋势：按天 GROUP BY 一次查出
    start = datetime.now() - timedelta(days=11)
    start_day = start.replace(hour=0, minute=0, second=0, microsecond=0)
    trend_map = {}
    for row in await db.query_a(
        "SELECT date(created_at) AS d, COUNT(*) AS c FROM screenings "
        "WHERE created_at >= ? GROUP BY d", (start_day,)):
        trend_map[row["d"]] = (row["c"], 0)
    for row in await db.query_a(
        "SELECT date(created_at) AS d, COUNT(*) AS c FROM alerts "
        "WHERE created_at >= ? GROUP BY d", (start_day,)):
        d, c = trend_map.get(row["d"], (0, 0))
        trend_map[row["d"]] = (d, row["c"])
    trend_data = []
    for i in range(11, -1, -1):
        date = (datetime.now() - timedelta(days=i))
        key = date.strftime("%Y-%m-%d")
        count, alerts = trend_map.get(key, (0, 0))
        trend_data.append({"date": date.strftime("%m-%d"), "count": count, "alerts": alerts})

    # 预警等级分布：GROUP BY 一次查出
    dist = {level: 0 for level in ("green", "yellow", "orange", "red")}
    for row in await db.query_a("SELECT level, COUNT(*) AS c FROM alerts GROUP BY level"):
        if row["level"] in dist:
            dist[row["level"]] = row["c"]
    alert_distribution = [
        {"name": "正常(绿)", "value": dist.get("green", 0), "color": "#22c55e"},
        {"name": "关注(黄)", "value": dist.get("yellow", 0), "color": "#f59e0b"},
        {"name": "警告(橙)", "value": dist.get("orange", 0), "color": "#f97316"},
        {"name": "危险(红)", "value": dist.get("red", 0), "color": "#ef4444"},
    ]

    # 预警列表：一次 JOIN 查询（避免 N+1）
    alerts = await db.query_a(
        "SELECT a.*, s.screening_id AS scr_id, u.name AS assignee_name "
        "FROM alerts a "
        "LEFT JOIN screenings s ON a.screening_id = s.id "
        "LEFT JOIN users u ON s.counselor_id = u.id "
        "ORDER BY a.created_at DESC, a.id DESC LIMIT 10")
    alert_records = [{
        "id": a.get("alert_id"),
        "screeningId": a.get("scr_id") or "",
        "name": a.get("name"),
        "level": a.get("level"),
        "trigger": a.get("trigger") or "",
        "description": a.get("description") or "",
        "status": a.get("status"),
        "assignee": a.get("assignee_name") or "未分配",
        "createdAt": _fmt(a.get("created_at"), "%Y-%m-%d %H:%M"),
        "updatedAt": _fmt(a.get("updated_at"), "%Y-%m-%d %H:%M"),
    } for a in alerts]

    # 筛查列表：一次 JOIN 查询
    screenings = await db.query_a(
        "SELECT s.*, q.name AS qname, u.name AS counselor_name "
        "FROM screenings s "
        "LEFT JOIN questionnaires q ON s.questionnaire_id = q.id "
        "LEFT JOIN users u ON s.counselor_id = u.id "
        "ORDER BY s.screening_date DESC, s.id DESC LIMIT 20")
    screening_records = [{
        "id": s.get("screening_id"),
        "name": s.get("name"),
        "age": s.get("age") or 0,
        "gender": s.get("gender") or "",
        "questionnaire": s.get("qname") or "未知",
        "score": s.get("score"),
        "maxScore": s.get("max_score"),
        "status": s.get("status"),
        "alertLevel": s.get("alert_level"),
        "date": _fmt(s.get("screening_date") or s.get("created_at")),
        "counselor": s.get("counselor_name") or "未分配",
    } for s in screenings]

    cases = await db.query_a("SELECT * FROM cases ORDER BY created_at DESC, id DESC LIMIT 20")
    case_records = [{
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
    } for c in cases]

    return success_response(data={
        "trendData": trend_data,
        "alertDistribution": alert_distribution,
        "alertRecords": alert_records,
        "screeningRecords": screening_records,
        "caseRecords": case_records,
    })


async def get_admin_screenings(ctx: RequestContext):
    rows = await db.query_a("SELECT * FROM screenings ORDER BY screening_date DESC, id DESC LIMIT 100")
    items = []
    for s in rows:
        qn = await db.query_one_a("SELECT name FROM questionnaires WHERE id = ?", (s.get("questionnaire_id"),))
        counselor = await _counselor_name(s.get("counselor_id"))
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
            "counselor": counselor or "未分配",
        })
    return success_response(data=items)


async def get_admin_alerts(ctx: RequestContext):
    alerts = await db.query_a("SELECT * FROM alerts ORDER BY created_at DESC, id DESC LIMIT 100")
    items = []
    for a in alerts:
        screening = await db.query_one_a("SELECT * FROM screenings WHERE id = ?", (a.get("screening_id"),))
        counselor = await _counselor_name(screening.get("counselor_id") if screening else None)
        items.append({
            "id": a.get("alert_id"),
            "screeningId": screening.get("screening_id") if screening else "",
            "name": a.get("name"),
            "level": a.get("level"),
            "trigger": a.get("trigger") or "",
            "description": a.get("description") or "",
            "status": a.get("status"),
            "assignee": counselor or "未分配",
            "createdAt": _fmt(a.get("created_at"), "%Y-%m-%d %H:%M"),
            "updatedAt": _fmt(a.get("updated_at"), "%Y-%m-%d %H:%M"),
        })
    return success_response(data=items)


async def get_admin_cases(ctx: RequestContext):
    cases = await db.query_a("SELECT * FROM cases ORDER BY created_at DESC, id DESC LIMIT 100")
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


async def get_admin_data_collection(ctx: RequestContext):
    return success_response(data={
        "textSubmissions": [],
        "audioSubmissions": [],
        "imageSubmissions": [],
    })
