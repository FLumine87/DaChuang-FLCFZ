"""个人端接口 handler（保留前端响应字段结构）。"""
from datetime import datetime, timedelta

from app.core.responses import success_response
from app.core.auth import RequestContext
from app.db import database as db
from app.services import screening_service
from app.engines import get_hashing_engine, get_rag_engine


def _fmt(v, fmt="%Y-%m-%d"):
    return v.strftime(fmt) if hasattr(v, "strftime") and v else (v or "")


def _warning_dict(a: dict) -> dict:
    status = a.get("status") if a.get("status") in ("new", "tracking", "resolved") else "new"
    return {
        "id": a.get("alert_id"),
        "level": a.get("level"),
        "title": a.get("trigger") or "预警提醒",
        "reason": a.get("description") or "",
        "suggestion": "建议及时关注并处理",
        "status": status,
        "createdAt": _fmt(a.get("created_at"), "%Y-%m-%d %H:%M"),
        "updatedAt": _fmt(a.get("updated_at"), "%Y-%m-%d %H:%M"),
    }


def _screening_item(s: dict, qn: str) -> dict:
    return {
        "id": s.get("screening_id"),
        "questionnaire": qn,
        "score": s.get("score"),
        "maxScore": s.get("max_score"),
        "level": s.get("alert_level"),
        "status": s.get("status"),
        "moodTag": s.get("notes") or "已完成",
        "date": _fmt(s.get("screening_date") or s.get("created_at")),
    }


def get_personal_screenings(ctx: RequestContext):
    rows = db.query("SELECT * FROM screenings ORDER BY screening_date DESC, id DESC LIMIT 100")
    items = []
    for s in rows:
        qn = db.query_one("SELECT name FROM questionnaires WHERE id = ?", (s["questionnaire_id"],))
        items.append(_screening_item(s, qn["name"] if qn else "未知"))
    return success_response(data=items)


def submit_personal_screening(ctx: RequestContext):
    data = ctx.body
    q = db.query_one("SELECT * FROM questionnaires WHERE code = ?", (data.get("questionnaire", ""),))
    if not q:
        return success_response(data={"id": "unknown", "status": "error"}, message="问卷不存在")
    alert_level = data.get("level", "green")
    row = screening_service.create_screening({
        "name": data.get("name", "匿名用户"),
        "age": data.get("age"),
        "gender": data.get("gender"),
        "department": data.get("department"),
        "questionnaire_id": q["id"],
        "score": data.get("score", 0),
        "answers": data.get("answers"),
        "status": "completed",
        "alert_level": alert_level,
        "screening_date": datetime.now(),
    })
    return success_response(data={
        "id": row.get("screening_id"),
        "status": "success",
        "riskLevel": alert_level,
    })


def get_personal_dashboard(ctx: RequestContext):
    questionnaires = db.query("SELECT * FROM questionnaires WHERE is_active = 1")
    questionnaire_catalog = [
        {
            "id": q["code"], "name": q["name"], "description": q["description"] or "",
            "questions": len((q["questions"] or "").split(",")) if q.get("questions") else 0,
            "minutes": 3, "target": q["description"] or "",
        }
        for q in questionnaires
    ]

    screenings = db.query("SELECT * FROM screenings ORDER BY screening_date DESC, id DESC LIMIT 10")
    screening_records = []
    for s in screenings:
        qn = db.query_one("SELECT name FROM questionnaires WHERE id = ?", (s["questionnaire_id"],))
        screening_records.append(_screening_item(s, qn["name"] if qn else "未知"))

    alerts = db.query("SELECT * FROM alerts ORDER BY created_at DESC, id DESC LIMIT 5")
    warning_events = [_warning_dict(a) for a in alerts]

    mood_trend = []
    for i in range(10, 0, -1):
        date = datetime.now() - timedelta(days=i)
        mood_trend.append({
            "date": date.strftime("%m-%d"),
            "mood": 60 + (i % 4) * 5,
            "stress": 50 + (i % 3) * 10,
            "sleep": 6.5 + (i % 3) * 0.5,
        })

    dist = {}
    for level in ("green", "yellow", "orange", "red"):
        dist[level] = db.query_one(
            "SELECT COUNT(*) AS c FROM alerts WHERE level = ?", (level,))["c"]
    warning_distribution = [
        {"name": "稳定", "value": dist.get("green", 0), "color": "#22c55e"},
        {"name": "关注", "value": dist.get("yellow", 0), "color": "#f59e0b"},
        {"name": "警告", "value": dist.get("orange", 0), "color": "#f97316"},
        {"name": "高危", "value": dist.get("red", 0), "color": "#ef4444"},
    ]

    action_plan = [
        {"id": "PLAN-1", "title": "定期筛查", "duration": "每周", "status": "tracking"},
        {"id": "PLAN-2", "title": "心理辅导", "duration": "每月", "status": "new"},
        {"id": "PLAN-3", "title": "情绪记录", "duration": "每日", "status": "resolved"},
    ]

    timeline_query = db.query("SELECT * FROM screenings ORDER BY screening_date DESC, id DESC LIMIT 5")
    personal_timeline = []
    for s in timeline_query:
        qn = db.query_one("SELECT name FROM questionnaires WHERE id = ?", (s["questionnaire_id"],))
        personal_timeline.append({
            "date": _fmt(s.get("screening_date") or s.get("created_at")),
            "type": "screening",
            "title": f"完成{(qn['name'] if qn else '筛查')}筛查",
            "detail": f"得分{s.get('score')}分，风险等级:{s.get('alert_level')}",
        })

    user_profile = {"name": "用户", "age": 0, "gender": "", "campus": "",
                    "major": "", "stage": "", "emergencyContact": ""}
    if screenings:
        user_profile["name"] = screenings[0].get("name") or "用户"
        user_profile["gender"] = screenings[0].get("gender") or ""

    return success_response(data={
        "moodTrend": mood_trend,
        "warningDistribution": warning_distribution,
        "warningEvents": warning_events,
        "actionPlan": action_plan,
        "screeningRecords": screening_records,
        "userProfile": user_profile,
        "questionnaireCatalog": questionnaire_catalog,
        "personalTimeline": personal_timeline,
    })


def get_personal_warnings(ctx: RequestContext):
    alerts = db.query("SELECT * FROM alerts ORDER BY created_at DESC, id DESC LIMIT 100")
    return success_response(data=[_warning_dict(a) for a in alerts])


def get_personal_profile(ctx: RequestContext):
    screenings = db.query("SELECT * FROM screenings ORDER BY screening_date DESC, id DESC LIMIT 10")
    screening_records = []
    for s in screenings:
        qn = db.query_one("SELECT name FROM questionnaires WHERE id = ?", (s["questionnaire_id"],))
        screening_records.append(_screening_item(s, qn["name"] if qn else "未知"))

    alerts = db.query("SELECT * FROM alerts ORDER BY created_at DESC, id DESC LIMIT 10")
    warning_events = [_warning_dict(a) for a in alerts]

    user_profile = {"name": "用户", "age": 0, "gender": "", "campus": "",
                    "major": "", "stage": "", "emergencyContact": ""}
    if screenings:
        user_profile["name"] = screenings[0].get("name") or "用户"
        user_profile["gender"] = screenings[0].get("gender") or ""

    personal_timeline = []
    for s in screenings[:5]:
        qn = db.query_one("SELECT name FROM questionnaires WHERE id = ?", (s["questionnaire_id"],))
        personal_timeline.append({
            "date": _fmt(s.get("screening_date") or s.get("created_at")),
            "type": "screening",
            "title": f"完成{(qn['name'] if qn else '筛查')}筛查",
            "detail": f"得分{s.get('score')}分，风险等级:{s.get('alert_level')}",
        })

    return success_response(data={
        "screeningRecords": screening_records,
        "warningEvents": warning_events,
        "userProfile": user_profile,
        "personalTimeline": personal_timeline,
    })


async def personal_search(ctx: RequestContext):
    query = ctx.body.get("query", "")
    engine = get_hashing_engine()
    raw_results = await engine.search(query=query, modality="text", top_k=5)
    results = [{**r, "alertLevel": r.get("alert_level", "green")} for r in raw_results]

    rag_engine = get_rag_engine()
    report = await rag_engine.generate_report({
        "id": 0, "name": "检索报告", "questionnaire": "综合",
        "score": 0, "max_score": 100, "alert_level": "green",
    })
    if isinstance(report, dict) and "risk_level" in report:
        report["riskLevel"] = report.pop("risk_level")

    return success_response(data={"results": results, "report": report, "query": query})
