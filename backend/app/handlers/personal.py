"""个人端接口 handler（保留前端响应字段结构，async）。"""
from datetime import datetime, timedelta
import json

from app.core.responses import success_response
from app.core.exceptions import HttpError
from app.core.auth import RequestContext
from app.db import database as db
from app.services import screening_service, case_service
from app.engines import get_rag_engine
from app.handlers.retrieval import perform_search, to_frontend_hit


def _fmt(v, fmt="%Y-%m-%d"):
    return v.strftime(fmt) if hasattr(v, "strftime") and v else (v or "")


def _warning_dict(a: dict) -> dict:
    status = {"pending": "new", "processing": "tracking", "resolved": "resolved",
              "closed": "resolved"}.get(a.get("status"), "new")
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


async def _qn_name(questionnaire_id):
    q = await db.query_one_a("SELECT name FROM questionnaires WHERE id = ?", (questionnaire_id,))
    return q["name"] if q else "未知"


async def get_personal_screenings(ctx: RequestContext):
    user_id = int(ctx.user["sub"])
    rows = await db.query_a(
        "SELECT * FROM screenings WHERE user_id = ? ORDER BY screening_date DESC, id DESC LIMIT 100",
        (user_id,))
    items = []
    for s in rows:
        qn = await _qn_name(s["questionnaire_id"])
        items.append(_screening_item(s, qn))
    return success_response(data=items)


async def submit_personal_screening(ctx: RequestContext):
    data = ctx.body
    user_id = int(ctx.user["sub"])
    user = await db.query_one_a("SELECT name FROM users WHERE id = ?", (user_id,))
    q = await db.query_one_a("SELECT * FROM questionnaires WHERE code = ?", (data.get("questionnaire", ""),))
    if not q:
        raise HttpError(400, "问卷不存在")
    # 自助筛查以原始作答为准，不能相信浏览器上传的总分或风险等级。
    scale = {
        "PHQ-9": (9, 3, (4, 9, 14)),
        "GAD-7": (7, 3, (4, 9, 14)),
        "ISI": (7, 4, (7, 14, 21)),
        "PSS-10": (10, 4, (13, 26, 33)),
    }.get(q["code"])
    if not scale:
        raise HttpError(400, "该量表暂不支持个人自助提交")
    answers = data.get("answers")
    question_count, option_max, thresholds = scale
    if not isinstance(answers, dict) or set(answers) != {str(i) for i in range(1, question_count + 1)}:
        raise HttpError(400, "问卷答案不完整")
    if any(type(value) is not int or value < 0 or value > option_max for value in answers.values()):
        raise HttpError(400, "问卷答案无效")
    score = sum(answers.values())
    alert_level = next((level for limit, level in zip(thresholds, ("green", "yellow", "orange"))
                        if score <= limit), "red")
    row = await screening_service.create_screening({
        "user_id": user_id,
        "name": user["name"] if user else "用户",
        "age": data.get("age"),
        "gender": data.get("gender"),
        "department": data.get("department"),
        "questionnaire_id": q["id"],
        "score": score,
        "answers": json.dumps(answers, ensure_ascii=False, sort_keys=True),
        "status": "completed",
        "alert_level": alert_level,
        "screening_date": datetime.now(),
    })
    await case_service.sync_personal_case(user_id, row)
    if alert_level in ("orange", "red"):
        await screening_service._create_alert_if_needed(
            await screening_service.get_screening_by_id(row["id"]))
    return success_response(data={
        "id": row.get("screening_id"),
        "status": "success",
        "riskLevel": alert_level,
    })


async def get_personal_dashboard(ctx: RequestContext):
    user_id = int(ctx.user["sub"])
    questionnaires = await db.query_a("SELECT * FROM questionnaires WHERE is_active = 1")
    questionnaire_catalog = [
        {
            "id": q["code"], "name": q["name"], "description": q["description"] or "",
            "questions": len((q["questions"] or "").split(",")) if q.get("questions") else 0,
            "minutes": 3, "target": q["description"] or "",
        }
        for q in questionnaires
    ]

    screenings = await db.query_a(
        "SELECT * FROM screenings WHERE user_id = ? ORDER BY screening_date DESC, id DESC LIMIT 10",
        (user_id,))
    screening_records = []
    for s in screenings:
        qn = await _qn_name(s["questionnaire_id"])
        screening_records.append(_screening_item(s, qn))

    alerts = await db.query_a(
        "SELECT a.* FROM alerts a JOIN screenings s ON a.screening_id = s.id "
        "WHERE s.user_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 5", (user_id,))
    warning_events = [_warning_dict(a) for a in alerts]

    mood_trend = []

    dist = {}
    for level in ("green", "yellow", "orange", "red"):
        row = await db.query_one_a(
            "SELECT COUNT(*) AS c FROM alerts a JOIN screenings s ON a.screening_id = s.id "
            "WHERE s.user_id = ? AND a.level = ?", (user_id, level))
        dist[level] = row["c"] if row else 0
    warning_distribution = [
        {"name": "稳定", "value": dist.get("green", 0), "color": "#22c55e"},
        {"name": "关注", "value": dist.get("yellow", 0), "color": "#f59e0b"},
        {"name": "警告", "value": dist.get("orange", 0), "color": "#f97316"},
        {"name": "高危", "value": dist.get("red", 0), "color": "#ef4444"},
    ]

    action_plan = []

    timeline_query = screenings[:5]
    personal_timeline = []
    for s in timeline_query:
        qn = await _qn_name(s["questionnaire_id"])
        personal_timeline.append({
            "date": _fmt(s.get("screening_date") or s.get("created_at")),
            "type": "screening",
            "title": f"完成{qn}筛查",
            "detail": f"得分{s.get('score')}分，风险等级:{s.get('alert_level')}",
        })

    user = await db.query_one_a("SELECT name FROM users WHERE id = ?", (user_id,))
    user_profile = {"name": user["name"] if user else "用户", "age": 0, "gender": "", "campus": "",
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


async def get_personal_warnings(ctx: RequestContext):
    alerts = await db.query_a(
        "SELECT a.* FROM alerts a JOIN screenings s ON a.screening_id = s.id "
        "WHERE s.user_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 100",
        (int(ctx.user["sub"]),))
    return success_response(data=[_warning_dict(a) for a in alerts])


async def get_personal_profile(ctx: RequestContext):
    user_id = int(ctx.user["sub"])
    screenings = await db.query_a(
        "SELECT * FROM screenings WHERE user_id = ? ORDER BY screening_date DESC, id DESC LIMIT 10",
        (user_id,))
    screening_records = []
    for s in screenings:
        qn = await _qn_name(s["questionnaire_id"])
        screening_records.append(_screening_item(s, qn))

    alerts = await db.query_a(
        "SELECT a.* FROM alerts a JOIN screenings s ON a.screening_id = s.id "
        "WHERE s.user_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 10", (user_id,))
    warning_events = [_warning_dict(a) for a in alerts]

    user = await db.query_one_a("SELECT name FROM users WHERE id = ?", (user_id,))
    user_profile = {"name": user["name"] if user else "用户", "age": 0, "gender": "", "campus": "",
                    "major": "", "stage": "", "emergencyContact": ""}
    if screenings:
        user_profile["name"] = screenings[0].get("name") or "用户"
        user_profile["gender"] = screenings[0].get("gender") or ""

    personal_timeline = []
    for s in screenings[:5]:
        qn = await _qn_name(s["questionnaire_id"])
        personal_timeline.append({
            "date": _fmt(s.get("screening_date") or s.get("created_at")),
            "type": "screening",
            "title": f"完成{qn}筛查",
            "detail": f"得分{s.get('score')}分，风险等级:{s.get('alert_level')}",
        })

    return success_response(data={
        "screeningRecords": screening_records,
        "warningEvents": warning_events,
        "userProfile": user_profile,
        "personalTimeline": personal_timeline,
    })


async def personal_search(ctx: RequestContext):
    """个人端检索：文本 / 图像 / 语音线索均可作为查询，返回结果 + RAG 报告。

    查询模态由请求体的 `modality` 决定；图像/语音查询额外携带
    `media_base64`（+ `media_name`），由 perform_search 统一落盘与清理。
    """
    data = ctx.body or {}
    raw_results, info, modality, mf = await perform_search(data)
    # 本地检索引擎还可能包含真实筛查、预警和案例。个人端只展示语料命中。
    private_prefixes = ("scr-", "alt-", "case-")
    results = [to_frontend_hit(r) for r in raw_results
               if not str(r.get("record_id") or r.get("id") or "").lower().startswith(private_prefixes)]

    rag_engine = get_rag_engine()
    report = await rag_engine.generate_report({
        "id": 0, "name": "检索报告", "questionnaire": "综合",
        "score": 0, "max_score": 100, "alert_level": "green",
    })
    if isinstance(report, dict) and "risk_level" in report:
        report["riskLevel"] = report.pop("risk_level")

    return success_response(data={
        "results": results, "report": report, "query": data.get("query"),
        "modality": modality, "modality_filter": mf, "index": info,
    })
