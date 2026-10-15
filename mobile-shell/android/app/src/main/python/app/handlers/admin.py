"""管理端接口 handler（保留前端响应字段结构，async）。"""
from datetime import datetime, timedelta

from app.core.dates import format_dt
from app.core.responses import success_response
from app.core.exceptions import HttpError
from app.core.auth import RequestContext
from app.db import database as db
from app.services import alert_service
from app.engines import get_rag_engine
from app.handlers.retrieval import perform_search, to_frontend_hit


async def _counselor_name(counselor_id):
    if not counselor_id:
        return None
    row = await db.query_one_a("SELECT name FROM users WHERE id = ?", (counselor_id,))
    return row["name"] if row else None


async def test_admin(ctx: RequestContext):
    return success_response(data={"message": "Hello, admin!"})


async def get_admin_dashboard(ctx: RequestContext):
    # 优化：合并统计查询，减少 D1 调用次数（免费计划 CPU 10ms 限制）

    month_start = datetime.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    counts = await db.query_one_a(
        "SELECT COUNT(*) AS total, "
        "SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS monthly, "
        "SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed, "
        "SUM(CASE WHEN screening_id LIKE 'SEED-%' THEN 1 ELSE 0 END) AS seeded "
        "FROM screenings", (month_start,)) or {}
    pending = await db.query_one_a(
        "SELECT COUNT(*) AS c FROM alerts WHERE status IN ('pending', 'processing')")
    total = counts.get("total") or 0
    stats = {
        "totalScreenings": total,
        "monthlyScreenings": counts.get("monthly") or 0,
        "openAlerts": pending["c"] if pending else 0,
        "completionRate": round((counts.get("completed") or 0) / total * 100, 1) if total else 0,
        "seedRecords": counts.get("seeded") or 0,
    }

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

    # 预警等级分布及本月黄/红预警：GROUP BY 一次查出
    month_start = datetime.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    next_month_start = (month_start + timedelta(days=32)).replace(day=1)
    dist = {level: 0 for level in ("green", "yellow", "orange", "red")}
    monthly_alert_counts = {"yellow": 0, "red": 0}
    for row in await db.query_a(
        "SELECT level, COUNT(*) AS c, "
        "SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) AS month_c "
        "FROM alerts GROUP BY level",
        (month_start.strftime("%Y-%m-%d"), next_month_start.strftime("%Y-%m-%d")),
    ):
        if row["level"] in dist:
            dist[row["level"]] = row["c"]
        if row["level"] in monthly_alert_counts:
            monthly_alert_counts[row["level"]] = row["month_c"] or 0
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
        "LEFT JOIN users u ON a.assignee_id = u.id "
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
        "createdAt": format_dt(a.get("created_at"), "%Y-%m-%d %H:%M"),
        "updatedAt": format_dt(a.get("updated_at"), "%Y-%m-%d %H:%M"),
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
        "date": format_dt(s.get("screening_date") or s.get("created_at")),
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
        "lastScreening": format_dt(c.get("last_screening_date")),
        "alertLevel": c.get("alert_level"),
        "status": c.get("status"),
    } for c in cases]

    return success_response(data={
        "stats": stats,
        "trendData": trend_data,
        "alertDistribution": alert_distribution,
        "monthlyAlertCounts": monthly_alert_counts,
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
            "date": format_dt(s.get("screening_date") or s.get("created_at")),
            "counselor": counselor or "未分配",
        })
    return success_response(data=items)


async def get_admin_alerts(ctx: RequestContext):
    q = ctx.query_params
    where, params = [], []
    if q.get("level") in ("green", "yellow", "orange", "red"):
        where.append("a.level = ?")
        params.append(q["level"])
    if q.get("status") in ("pending", "processing", "resolved", "closed"):
        where.append("a.status = ?")
        params.append(q["status"])
    if q.get("keyword"):
        where.append("(a.name LIKE ? OR a.alert_id LIKE ?)")
        term = f"%{str(q['keyword']).strip()}%"
        params.extend((term, term))
    clause = " WHERE " + " AND ".join(where) if where else ""
    try:
        page = max(1, int(q.get("page", 1)))
    except (ValueError, TypeError):
        page = 1
    total_row = await db.query_one_a("SELECT COUNT(*) AS c FROM alerts a" + clause, params)
    rows = await db.query_a(
        "SELECT a.*, s.screening_id AS public_screening_id, u.name AS assignee_name "
        "FROM alerts a LEFT JOIN screenings s ON a.screening_id = s.id "
        "LEFT JOIN users u ON a.assignee_id = u.id" + clause +
        " ORDER BY a.created_at DESC, a.id DESC LIMIT 50 OFFSET ?", params + [(page - 1) * 50])
    return success_response(data={
        "items": [_admin_alert_dict(a) for a in rows],
        "total": total_row["c"] if total_row else 0,
        "page": page,
        "pageSize": 50,
    })


def _admin_alert_dict(a: dict) -> dict:
    return {
        "id": a.get("alert_id"),
        "screeningId": a.get("public_screening_id") or "",
        "name": a.get("name") or "",
        "level": a.get("level") or "green",
        "trigger": a.get("trigger") or "",
        "description": a.get("description") or "",
        "status": a.get("status") or "pending",
        "assignee": a.get("assignee_name") or "未分配",
        "assigneeId": a.get("assignee_id"),
        "followUpNotes": a.get("follow_up_notes") or "",
        "createdAt": format_dt(a.get("created_at"), "%Y-%m-%d %H:%M"),
        "updatedAt": format_dt(a.get("updated_at"), "%Y-%m-%d %H:%M"),
    }


async def get_admin_alert_detail(ctx: RequestContext, alert_id: str):
    row = await db.query_one_a(
        "SELECT a.*, s.screening_id AS public_screening_id, s.score, s.max_score, "
        "q.name AS questionnaire_name, u.name AS assignee_name "
        "FROM alerts a LEFT JOIN screenings s ON a.screening_id = s.id "
        "LEFT JOIN questionnaires q ON s.questionnaire_id = q.id "
        "LEFT JOIN users u ON a.assignee_id = u.id WHERE a.alert_id = ?", (alert_id,))
    if not row:
        raise HttpError(404, "预警不存在")
    history = await db.query_a(
        "SELECT e.id, e.from_status, e.to_status, e.note, e.created_at, "
        "u.name AS actor_name FROM alert_events e "
        "LEFT JOIN users u ON e.actor_id = u.id WHERE e.alert_id = ? "
        "ORDER BY e.created_at DESC, e.id DESC", (row["id"],))
    return success_response(data={
        **_admin_alert_dict(row),
        "score": row.get("score"), "maxScore": row.get("max_score"),
        "questionnaire": row.get("questionnaire_name") or "",
        "history": [{
            "id": event["id"], "fromStatus": event.get("from_status"),
            "toStatus": event["to_status"], "note": event.get("note") or "",
            "actor": event.get("actor_name") or "未知账号",
            "createdAt": format_dt(event.get("created_at"), "%Y-%m-%d %H:%M"),
        } for event in history],
    })


async def update_admin_alert(ctx: RequestContext, alert_id: str):
    row = await db.query_one_a("SELECT id FROM alerts WHERE alert_id = ?", (alert_id,))
    if not row:
        raise HttpError(404, "预警不存在")
    await alert_service.update_alert(row["id"], ctx.body, int(ctx.user["sub"]))
    return await get_admin_alert_detail(ctx, alert_id)


async def get_admin_assignees(ctx: RequestContext):
    rows = await db.query_a(
        "SELECT id, name, role FROM users WHERE is_active = 1 "
        "AND role IN ('admin', 'counselor') ORDER BY name, id")
    return success_response(data=rows)


async def get_admin_cases(ctx: RequestContext):
    q = ctx.query_params
    where, params = [], []
    if q.get("status") in ("active", "monitoring", "closed"):
        where.append("c.status = ?")
        params.append(q["status"])
    if q.get("keyword"):
        where.append("(c.name LIKE ? OR c.case_id LIKE ?)")
        term = f"%{str(q['keyword']).strip()}%"
        params.extend((term, term))
    clause = " WHERE " + " AND ".join(where) if where else ""
    try:
        page = max(1, int(q.get("page", 1)))
    except (ValueError, TypeError):
        page = 1
    total_row = await db.query_one_a("SELECT COUNT(*) AS c FROM cases c" + clause, params)
    rows = await db.query_a(
        "SELECT c.* FROM cases c" + clause +
        " ORDER BY c.updated_at DESC, c.id DESC LIMIT 50 OFFSET ?", params + [(page - 1) * 50])
    tags_by_case = {case["id"]: [] for case in rows}
    if rows:
        placeholders = ",".join("?" for _ in rows)
        tags = await db.query_a(
            "SELECT a.case_id, t.name FROM case_tags_association a "
            "JOIN case_tag_master t ON a.tag_id = t.id "
            f"WHERE a.case_id IN ({placeholders}) ORDER BY t.name",
            [case["id"] for case in rows])
        for tag in tags:
            tags_by_case[tag["case_id"]].append(tag["name"])
    return success_response(data={
        "items": [await _admin_case_dict(c, tags_by_case[c["id"]]) for c in rows],
        "total": total_row["c"] if total_row else 0, "page": page, "pageSize": 50,
    })


async def _admin_case_dict(c: dict, tags: list = None) -> dict:
    if tags is None:
        tag_rows = await db.query_a(
            "SELECT t.name FROM case_tags_association a "
            "JOIN case_tag_master t ON a.tag_id = t.id WHERE a.case_id = ? ORDER BY t.name",
            (c["id"],))
        tags = [tag["name"] for tag in tag_rows]
    return {
        "id": c["case_id"], "userId": c.get("user_id"),
        "name": c.get("name") or "", "age": c.get("age"),
        "gender": c.get("gender") or "", "department": c.get("department") or "",
        "tags": tags,
        "screeningCount": c.get("screening_count") or 0,
        "lastScreening": format_dt(c.get("last_screening_date")),
        "alertLevel": c.get("alert_level") or "green",
        "status": c.get("status") or "active",
        "notes": c.get("notes") or "",
    }


async def get_admin_case_detail(ctx: RequestContext, case_id: str):
    case = await db.query_one_a("SELECT * FROM cases WHERE case_id = ?", (case_id,))
    if not case:
        raise HttpError(404, "案例不存在")
    user_id = case.get("user_id")
    screenings, alerts = [], []
    if user_id is not None:
        screenings = await db.query_a(
            "SELECT s.screening_id AS id, s.score, s.max_score AS maxScore, "
            "s.alert_level AS alertLevel, s.screening_date AS date, q.name AS questionnaire "
            "FROM screenings s LEFT JOIN questionnaires q ON s.questionnaire_id = q.id "
            "WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 50", (user_id,))
        alerts = await db.query_a(
            "SELECT a.alert_id AS id, a.level, a.status, a.created_at AS createdAt "
            "FROM alerts a JOIN screenings s ON a.screening_id = s.id "
            "WHERE s.user_id = ? ORDER BY a.created_at DESC LIMIT 50", (user_id,))
    follow_ups = await db.query_a(
        "SELECT id, event_type AS type, title, description, event_date AS date "
        "FROM case_timeline WHERE case_id = ? ORDER BY event_date DESC, id DESC", (case["id"],))
    level_labels = {"green": "绿色", "yellow": "黄色", "orange": "橙色", "red": "红色"}
    timeline = [{**event, "date": format_dt(event.get("date"), "%Y-%m-%d %H:%M")}
                for event in follow_ups]
    timeline.extend({
        "id": f"screening:{item['id']}", "type": "screening",
        "title": f"完成{item.get('questionnaire') or '量表'}筛查",
        "description": f"得分 {item.get('score')} / {item.get('maxScore')}",
        "date": format_dt(item.get("date"), "%Y-%m-%d %H:%M"),
    } for item in screenings)
    timeline.extend({
        "id": f"alert:{item['id']}", "type": "alert",
        "title": f"产生{level_labels.get(item.get('level'), '未知等级')}预警",
        "description": f"预警编号 {item['id']}",
        "date": format_dt(item.get("createdAt"), "%Y-%m-%d %H:%M"),
    } for item in alerts)
    timeline.sort(key=lambda event: event.get("date") or "", reverse=True)
    # screenings / alerts 这里原来直接把**原始行**返回，而它们的 date/createdAt
    # 是 sqlite 里的裸字符串（2026-10-14 13:53:29.910839），于是微秒会显示到
    # 案例详情的"筛查记录/预警历史"里。timeline 那份虽然格式化过，但页面读的是
    # screenings[].date，所以这里也必须格式化一遍。
    return success_response(data={
        **(await _admin_case_dict(case)),
        "screenings": [{**item, "date": format_dt(item.get("date"), "%Y-%m-%d %H:%M")}
                       for item in screenings],
        "alerts": [{**item, "createdAt": format_dt(item.get("createdAt"), "%Y-%m-%d %H:%M")}
                   for item in alerts],
        "timeline": timeline,
    })


async def update_admin_case(ctx: RequestContext, case_id: str):
    case = await db.query_one_a("SELECT id FROM cases WHERE case_id = ?", (case_id,))
    if not case:
        raise HttpError(404, "案例不存在")
    data = ctx.body
    if set(data) - {"status", "notes"}:
        raise HttpError(400, "只允许更新案例状态和备注")
    status = data.get("status")
    if status is not None and status not in ("active", "monitoring", "closed"):
        raise HttpError(400, "无效的案例状态")
    if status is not None:
        previous = await db.query_one_a("SELECT status FROM cases WHERE id = ?", (case["id"],))
        await db.execute_a(
            "UPDATE cases SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (status, case["id"]))
        if previous and previous["status"] != status:
            labels = {"active": "进行中", "monitoring": "持续观察", "closed": "已结案"}
            await db.execute_a(
                "INSERT INTO case_timeline (case_id, event_type, title, description, event_date) "
                "VALUES (?, 'status', ?, ?, CURRENT_TIMESTAMP)",
                (case["id"], "案例状态更新", f"{labels.get(previous['status'], previous['status'])} → {labels[status]}"))
    if "notes" in data:
        await db.execute_a(
            "UPDATE cases SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (str(data["notes"]).strip(), case["id"]))
    return await get_admin_case_detail(ctx, case_id)


async def add_admin_case_event(ctx: RequestContext, case_id: str):
    case = await db.query_one_a("SELECT id FROM cases WHERE case_id = ?", (case_id,))
    if not case:
        raise HttpError(404, "案例不存在")
    title = str(ctx.body.get("title") or "").strip()
    description = str(ctx.body.get("description") or "").strip()
    if not title or not description:
        raise HttpError(400, "跟进标题和内容不能为空")
    await db.execute_a(
        "INSERT INTO case_timeline (case_id, event_type, title, description, event_date) "
        "VALUES (?, 'follow_up', ?, ?, CURRENT_TIMESTAMP)",
        (case["id"], title, description))
    return await get_admin_case_detail(ctx, case_id)


async def admin_search(ctx: RequestContext):
    """管理端检索：与个人端共用跨模态检索链路（文本 / 图像 / 语音查询）。"""
    data = ctx.body or {}
    query = data.get("query", "")
    raw_results, info, modality, mf = await perform_search(data, default_top_k=10)
    results = [to_frontend_hit(r) for r in raw_results]

    rag_engine = get_rag_engine()
    report = await rag_engine.generate_report({
        "id": 0, "name": "综合检索报告", "questionnaire": "综合评估",
        "score": 0, "max_score": 100, "alert_level": "green",
    })
    if isinstance(report, dict) and "risk_level" in report:
        report["riskLevel"] = report.pop("risk_level")

    return success_response(data={
        "results": results, "report": report, "query": query,
        "modality": modality, "modality_filter": mf, "index": info,
    })


async def get_admin_data_collection(ctx: RequestContext):
    return success_response(data={
        "textSubmissions": [],
        "audioSubmissions": [],
        "imageSubmissions": [],
    })
