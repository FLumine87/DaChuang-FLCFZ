"""个人端接口 handler（保留前端响应字段结构，async）。"""
from datetime import datetime, timedelta
import json
import os
import uuid

from app.core.dates import format_dt
from app.core.responses import success_response
from app.core.exceptions import HttpError
from app.core.auth import RequestContext
from app.db import database as db
from app.services import screening_service, case_service, alert_service
# 检索结论用规则模板（MockRAGEngine）秒出；RAG 报告走 get_rag_engine（大模型，前端异步取）
from app.engines import get_rag_engine
from app.engines.rag.mock_engine import MockRAGEngine
from app.handlers.retrieval import perform_search, to_frontend_hit


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
        "createdAt": format_dt(a.get("created_at"), "%Y-%m-%d %H:%M"),
        "updatedAt": format_dt(a.get("updated_at"), "%Y-%m-%d %H:%M"),
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
        "date": format_dt(s.get("screening_date") or s.get("created_at")),
    }


async def _attach_supplements(items: list) -> None:
    """给筛查记录挂上「多模态采集」补充（最新的那条）。

    前端约定：记录带 supplement 字段才会进「最近一次输入」与检索页「我的记录」
    （见 pages/Dashboard.tsx、pages/Retrieval.tsx）。一条筛查可能补过多次
    （文本/语音/图片都算补充），这里只挂最新一条，历史仍保留在表里。
    """
    ids = [it.get("id") for it in items if it.get("id")]
    if not ids:
        return
    placeholders = ",".join("?" for _ in ids)
    rows = await db.query_a(
        f"SELECT * FROM screening_supplements WHERE screening_id IN ({placeholders}) ORDER BY id DESC",
        ids,
    )
    latest: dict = {}
    for r in rows:
        latest.setdefault(r["screening_id"], r)  # DESC 排序 → 首见即最新
    for it in items:
        sup = latest.get(it.get("id"))
        if not sup:
            continue
        analysis = None
        if sup.get("analysis"):
            try:
                analysis = json.loads(sup["analysis"])
            except Exception:
                analysis = None
        it["supplement"] = {
            k: v for k, v in {
                "kind": sup.get("kind"),
                "text": sup.get("text"),
                "filename": sup.get("filename"),
                "url": sup.get("url"),
                "description": sup.get("description"),
                "analysis": analysis,
            }.items() if v is not None
        }


async def _qn_name(questionnaire_id):
    q = await db.query_one_a("SELECT name FROM questionnaires WHERE id = ?", (questionnaire_id,))
    return q["name"] if q else "未知"


async def _current_user_name(ctx: RequestContext):
    """当前登录用户的显示名。

    此前档案接口的 name 字段写死为「用户」，只有存在筛查记录时才从 screenings
    里取名字 —— 结果新账号（没有任何筛查）永远显示「用户」，users.name 白存了。
    这里改成以 users 表为准，筛查记录只作为兜底。
    """
    payload = getattr(ctx, "user", None) or {}
    user_id = payload.get("sub")
    if user_id is not None:
        row = await db.query_one_a("SELECT name, username FROM users WHERE id = ?", (user_id,))
        if row:
            return (row.get("name") or "").strip() or row.get("username") or ""
    return ""


async def get_personal_screenings(ctx: RequestContext):
    user_id = int(ctx.user["sub"])
    rows = await db.query_a(
        "SELECT * FROM screenings WHERE user_id = ? ORDER BY screening_date DESC, id DESC LIMIT 100",
        (user_id,))
    items = []
    for s in rows:
        qn = await _qn_name(s["questionnaire_id"])
        items.append(_screening_item(s, qn))
    await _attach_supplements(items)
    return success_response(data=items)


async def save_screening_supplement(ctx: RequestContext, screening_id):
    """把「多模态采集」的一次补充挂到指定筛查记录上（有筛查记录时的默认路径）。

    前端在每次上传成功后调用（见 pages/DataCollection.tsx 的 persistCollection
    → services/mockApi.ts saveScreeningSupplement）；按 user_id 校验归属，
    只能给自己的记录补充。screening_id 为公开编号（SCR-xxx）。
    保存后立即跑一次哈希检索分析：报告随响应返回（前端在采集页底部展示），
    并回写到本条补充上，达到预警级别时同步生成预警记录。
    """
    data = ctx.body or {}
    kind = data.get("kind")
    if kind not in ("text", "audio", "image"):
        raise HttpError(400, "补充类型必须是 text / audio / image")
    user_id = int(ctx.user["sub"])
    row = await db.query_one_a(
        "SELECT id FROM screenings WHERE screening_id = ? AND user_id = ?",
        (str(screening_id), user_id),
    )
    if not row:
        raise HttpError(404, "筛查记录不存在")
    sup_id = await db.execute_a(
        "INSERT INTO screening_supplements (user_id, screening_id, kind, text, filename, url, description) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (user_id, str(screening_id), kind, data.get("text"), data.get("filename"),
         data.get("url"), data.get("description")),
    )
    report = await _analyze_collection(ctx, sup_id, kind, data, user_id, row)
    return success_response(data={"id": sup_id, "report": report}, message="补充已保存")


async def save_personal_supplement(ctx: RequestContext):
    """把一次补充挂到**用户名下**（没有筛查记录时的路径）。

    新账号一次筛查都没做过时，采集内容此前无处可挂（只上传不挂靠、
    首页与检索页都看不到）。这里允许直接按 user_id 落库，
    读取侧（首页「最近一次输入」/ 检索页「我的记录」）会把它一并展示。
    同样跑哈希检索分析，预警挂在用户名下（screening_id 为空）。
    """
    data = ctx.body or {}
    kind = data.get("kind")
    if kind not in ("text", "audio", "image"):
        raise HttpError(400, "补充类型必须是 text / audio / image")
    user_id = int(ctx.user["sub"])
    row_id = await db.execute_a(
        "INSERT INTO screening_supplements (user_id, screening_id, kind, text, filename, url, description) "
        "VALUES (?, NULL, ?, ?, ?, ?, ?)",
        (user_id, kind, data.get("text"), data.get("filename"),
         data.get("url"), data.get("description")),
    )
    report = await _analyze_collection(ctx, row_id, kind, data, user_id, None)
    return success_response(data={"id": row_id, "report": report}, message="已保存到你的档案")


# ─── 采集的哈希检索分析 ────────────────────────────────────────────────────────

_SEVERITY = {"green": 0, "yellow": 1, "orange": 2, "red": 3}
_LEVEL_LABEL = {"green": "稳定", "yellow": "关注", "orange": "警告", "red": "高危"}
_KIND_LABEL = {"text": "文本", "audio": "语音", "image": "图像"}


def _resolve_upload_path(url: str) -> str | None:
    """/uploads/audio/xxx.wav → 磁盘绝对路径（前缀校验防穿越；不存在返回 None）。"""
    from app.handlers.upload import UPLOAD_ROOT
    rel = (url or "")[len("/uploads/"):] if (url or "").startswith("/uploads/") else ""
    if not rel:
        return None
    root = os.path.realpath(UPLOAD_ROOT)
    candidate = os.path.realpath(os.path.join(root, rel))
    if candidate.startswith(root + os.sep) and os.path.isfile(candidate):
        return candidate
    return None


def _report_hit(h: dict) -> dict:
    """报告里的命中记录（精简版：去掉缩略图/媒体元数据，保留可解释信息）。"""
    return {
        k: v for k, v in {
            "id": h.get("id"),
            "modality": h.get("modality"),
            "modalityLabel": h.get("modality_label"),
            "summary": h.get("summary"),
            "similarity": round(float(h.get("similarity") or 0), 4),
            "alertLevel": h.get("alert_level") or "green",
            "tags": h.get("tags") or [],
            "date": h.get("date"),
            "explain": h.get("explain"),
        }.items() if v is not None
    }


async def _analyze_collection(ctx: RequestContext, sup_id, kind: str, data: dict,
                              user_id: int, screening_row) -> dict | None:
    """对一次采集跑哈希检索引擎，生成检索报告；达到预警级别时生成预警记录。

    评估口径（相似度 × 风险等级 双条件，避免每次检索都误报）：
      · 最高相似记录 sim >= 0.75 且其等级为 orange/red → 取该等级（生成预警）
      · 最高相似记录 sim >= 0.65 且等级非 green → yellow（关注，不生成预警记录，
        与筛查预警的既有口径一致：只有 orange/red 才建档）
      · 其余 → green
    分析失败（引擎未就绪等）返回 None，不影响补充本身的挂载。
    """
    try:
        from app.engines import get_hashing_engine

        engine = get_hashing_engine()
        media_path = None
        if kind in ("audio", "image"):
            media_path = _resolve_upload_path(data.get("url") or "")
        query = (data.get("text") or "").strip()
        results, info = await engine.search_with_info(
            query=query, modality=kind, top_k=5, modality_filter=None,
            media_path=media_path,
        )
        hits = sorted([_report_hit(h) for h in (results or [])],
                      key=lambda h: h.get("similarity") or 0, reverse=True)

        top = hits[0] if hits else None
        sim = (top.get("similarity") or 0) if top else 0
        top_level = (top.get("alertLevel") or "green") if top else "green"

        if top and sim >= 0.75 and _SEVERITY.get(top_level, 0) >= 2:
            level = top_level
        elif top and sim >= 0.65 and _SEVERITY.get(top_level, 0) >= 1:
            level = "yellow"
        else:
            level = "green"

        reason = (
            f"最相似记录（{top.get('id')}）相似度 {sim:.2f}，风险等级{_LEVEL_LABEL.get(top_level)}"
            if top else "未检索到相似记录"
        )
        # 结论：把命中规模、最高相似度和处置建议写成一段话
        high_count = sum(1 for h in hits if _SEVERITY.get(h.get("alertLevel"), 0) >= 2)
        parts = [f"在真实跨模态语料库中检索到 {len(hits)} 条相似记录，最高相似度 {sim:.2f}。"]
        if high_count:
            parts.append(f"其中 {high_count} 条为高风险等级记录，与本次输入存在情绪风险特征重合。")
        if level in ("orange", "red"):
            parts.append("已生成预警并同步到预警中心，建议尽快完成一次量表筛查或联系咨询师。")
        elif level == "yellow":
            parts.append("存在一定风险信号，建议持续记录并关注情绪变化。")
        else:
            parts.append("暂未发现明显风险信号，请继续保持记录习惯。")
        conclusion = "".join(parts)

        # 达到预警级别（orange/red）→ 建档挂载；x/y 为补充所在记录（可空）
        alert_id = None
        if level in ("orange", "red"):
            name = await _current_user_name(ctx) or "用户"
            alert_id = f"ALT-{uuid.uuid4().hex[:6].upper()}"
            await db.execute_a(
                "INSERT INTO alerts (alert_id, screening_id, user_id, name, level, trigger, description, "
                "status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)",
                (
                    alert_id,
                    screening_row["id"] if screening_row else None,
                    user_id, name, level,
                    f"多模态采集 · {_KIND_LABEL[kind]}线索与{_LEVEL_LABEL[level]}案例高度相似（相似度 {sim:.2f}）",
                    conclusion,
                ),
            )

        report = {
            "modality": kind,
            "query": (query[:120] or data.get("filename") or ""),
            "level": level,
            "levelLabel": _LEVEL_LABEL[level],
            "isAlert": level in ("orange", "red"),
            "reason": reason,
            "conclusion": conclusion,
            "hits": hits,
            "alertId": alert_id,
            "index": info if isinstance(info, dict) else None,
            "createdAt": datetime.now().strftime("%Y-%m-%d %H:%M"),
        }
        # 回写到补充记录上：首页/检索页/采集页都从这里取「结论」
        await db.execute_a(
            "UPDATE screening_supplements SET analysis = ? WHERE id = ?",
            (json.dumps(report, ensure_ascii=False), sup_id),
        )
        return report
    except Exception:
        # 分析失败不阻塞挂载（服务端无访问日志，打印堆栈便于本地排查）
        import traceback
        traceback.print_exc()
        return None


def _supplement_dict(r: dict) -> dict:
    """补充记录的对外形状（前端 Supplement 类型：kind + 可选 text/filename/url/description）。"""
    analysis = None
    raw = r.get("analysis")
    if raw:
        try:
            analysis = json.loads(raw)
        except Exception:
            analysis = None
    return {
        k: v for k, v in {
            "id": r.get("id"),
            "context": "screening" if r.get("screening_id") else "user",
            "kind": r.get("kind"),
            "text": r.get("text"),
            "filename": r.get("filename"),
            "url": r.get("url"),
            "description": r.get("description"),
            "screeningId": r.get("screening_id"),
            "analysis": analysis,
            "createdAt": format_dt(r.get("created_at"), "%Y-%m-%d %H:%M"),
        }.items() if v is not None
    }


async def get_personal_supplements(ctx: RequestContext):
    """当前用户的全部采集补充（含挂记录与挂用户名下两种），按时间倒序。

    检索页「我的记录」用它把新账号的用户级采集也纳入历史列表；
    首页以其中最新一条作为「最近一次输入」的兜底。
    """
    user_id = int(ctx.user["sub"])
    rows = await db.query_a(
        "SELECT * FROM screening_supplements WHERE user_id = ? ORDER BY id DESC LIMIT 100",
        (user_id,),
    )
    return success_response(data=[_supplement_dict(r) for r in rows])


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


def _build_action_plan(screenings, alerts, supplements):
    """按**真实数据**排出行动计划。

    背景：这里原本写死 `action_plan = []`，前端个人首页那张"行动计划"卡
    因此永远只有前端自己按预警等级补的那一条（`Dashboard.tsx` 的 levelPlan），
    看着像"平台只有一条建议"。

    刻意**不重复等级条目**：前端已经会按最新预警等级在前面补
    「预约心理辅导 / 与可信赖的人聊一聊 / 继续每日情绪记录」，
    后端再发一条同义的会变成两条一样的话。这里只发"数据本身能证明该做"的事，
    而且每条都能追溯到一条查询结果，不是套话：

      · 完全没做过筛查   → 先去测一次（否则后面所有建议都无从谈起）
      · 做过筛查         → 回看报告；做过两次以上才算"已完成"
      · 没做过三模态采集 → 补一次记录（采集是本平台区别于纯量表的点）
      · 有采集记录       → 保持每日记录（进行中）
      · 有未处置的预警   → 去跟进
      · 最近一次是高危   → 优先稳住作息（睡眠是这类个案最普遍的可干预项）

    字段形状与前端 mock 及 DashboardV2 的读取保持一致：
      {id, title, duration, status}，status ∈ new | tracking | resolved
    """
    plan = []
    latest = screenings[0] if screenings else None
    pending = [
        a for a in alerts
        if (a.get("status") or "pending") in ("pending", "processing")
    ]

    if not screenings:
        plan.append({"id": "PLAN-FIRST-SCREEN", "title": "完成一次首次心理筛查",
                     "duration": "约 3 分钟", "status": "new"})
    else:
        plan.append({"id": "PLAN-REVIEW-LATEST", "title": "回看最近一次筛查报告",
                     "duration": "约 5 分钟",
                     "status": "resolved" if len(screenings) > 1 else "new"})

    if not supplements:
        plan.append({"id": "PLAN-SUPPLEMENT", "title": "补充一次三模态采集记录",
                     "duration": "约 5 分钟", "status": "new"})
    else:
        plan.append({"id": "PLAN-KEEP-LOG", "title": "保持每日情绪记录",
                     "duration": "每日", "status": "tracking"})

    if pending:
        plan.append({"id": "PLAN-FOLLOW-ALERT", "title": "跟进尚未处置的预警",
                     "duration": "本周内", "status": "new"})

    if (latest or {}).get("alert_level") in ("orange", "red"):
        plan.append({"id": "PLAN-REGULAR-SLEEP", "title": "先稳住作息：固定起床时间",
                     "duration": "连续 7 天", "status": "new"})

    return plan


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
    await _attach_supplements(screening_records)

    alerts = await db.query_a(
        "SELECT a.* FROM alerts a LEFT JOIN screenings s ON a.screening_id = s.id "
        "WHERE (s.user_id = ? OR a.user_id = ?) ORDER BY a.created_at DESC, a.id DESC LIMIT 5",
        (user_id, user_id))
    warning_events = [_warning_dict(a) for a in alerts]

    mood_trend = []

    dist = {}
    for level in ("green", "yellow", "orange", "red"):
        row = await db.query_one_a(
            "SELECT COUNT(*) AS c FROM alerts a LEFT JOIN screenings s ON a.screening_id = s.id "
            "WHERE (s.user_id = ? OR a.user_id = ?) AND a.level = ?", (user_id, user_id, level))
        dist[level] = row["c"] if row else 0
    warning_distribution = [
        {"name": "稳定", "value": dist.get("green", 0), "color": "#22c55e"},
        {"name": "关注", "value": dist.get("yellow", 0), "color": "#f59e0b"},
        {"name": "警告", "value": dist.get("orange", 0), "color": "#f97316"},
        {"name": "高危", "value": dist.get("red", 0), "color": "#ef4444"},
    ]

    timeline_query = screenings[:5]
    personal_timeline = []
    for s in timeline_query:
        qn = await _qn_name(s["questionnaire_id"])
        personal_timeline.append({
            "date": format_dt(s.get("screening_date") or s.get("created_at")),
            "type": "screening",
            "title": f"完成{qn}筛查",
            "detail": f"得分{s.get('score')}分，风险等级:{s.get('alert_level')}",
        })

    user = await db.query_one_a("SELECT name FROM users WHERE id = ?", (user_id,))
    user_profile = {"name": user["name"] if user else "用户", "age": 0, "gender": "", "campus": "",
                    "major": "", "stage": "", "emergencyContact": ""}
    # 显示名以 users 表为准（筛查记录仅作兜底），否则新账号永远显示「用户」
    profile_name = await _current_user_name(ctx)
    if screenings:
        user_profile["name"] = profile_name or screenings[0].get("name") or "用户"
        user_profile["gender"] = screenings[0].get("gender") or ""
    elif profile_name:
        user_profile["name"] = profile_name

    # 采集补充列表（含挂用户名下、未挂记录的）：首页「最近一次输入」
    # 在记录级补充之外用它兜底，新账号首次采集也能在首页看到。
    supplement_rows = await db.query_a(
        "SELECT * FROM screening_supplements WHERE user_id = ? ORDER BY id DESC LIMIT 20",
        (user_id,),
    )
    supplements = [_supplement_dict(r) for r in supplement_rows]

    # 行动计划要在 supplements 取到之后再算 —— 它有一条判据就是"有没有采集记录"
    action_plan = _build_action_plan(screenings, alerts, supplements)

    return success_response(data={
        "moodTrend": mood_trend,
        "warningDistribution": warning_distribution,
        "warningEvents": warning_events,
        "actionPlan": action_plan,
        "screeningRecords": screening_records,
        "supplements": supplements,
        "userProfile": user_profile,
        "questionnaireCatalog": questionnaire_catalog,
        "personalTimeline": personal_timeline,
    })


async def get_personal_warnings(ctx: RequestContext):
    uid = int(ctx.user["sub"])
    # 挂记录的预警按记录归属查；采集产生的用户名下预警（screening_id 为空）按 a.user_id 查
    alerts = await db.query_a(
        "SELECT a.* FROM alerts a LEFT JOIN screenings s ON a.screening_id = s.id "
        "WHERE (s.user_id = ? OR a.user_id = ?) ORDER BY a.created_at DESC, a.id DESC LIMIT 100",
        (uid, uid))
    return success_response(data=[_warning_dict(a) for a in alerts])


async def update_personal_warning(ctx: RequestContext, alert_id: str):
    """个人端自助改自己预警的状态（标记为跟踪中 / 已缓解）。

    路径参数用的是**展示码**（alerts.alert_id，如 ALT-41CA2F），不是数据库主键 ——
    个人端列表返回的就是展示码，前端手里没有主键。
    （router 会把纯数字的路径参数 coerce 成 int，这里显式转回 str 兼容。）
    返回体沿用列表同一套 _warning_dict，前端拿到即可直接替换本地那一条。
    """
    updated = await alert_service.update_alert_by_user(
        str(alert_id), int(ctx.user["sub"]), ctx.body or {})
    if not updated:
        raise HttpError(404, "预警记录不存在")
    return success_response(data=_warning_dict(updated))


async def get_personal_profile(ctx: RequestContext):
    user_id = int(ctx.user["sub"])
    screenings = await db.query_a(
        "SELECT * FROM screenings WHERE user_id = ? ORDER BY screening_date DESC, id DESC LIMIT 10",
        (user_id,))
    screening_records = []
    for s in screenings:
        qn = await _qn_name(s["questionnaire_id"])
        screening_records.append(_screening_item(s, qn))
    await _attach_supplements(screening_records)

    alerts = await db.query_a(
        "SELECT a.* FROM alerts a LEFT JOIN screenings s ON a.screening_id = s.id "
        "WHERE (s.user_id = ? OR a.user_id = ?) ORDER BY a.created_at DESC, a.id DESC LIMIT 10",
        (user_id, user_id))
    warning_events = [_warning_dict(a) for a in alerts]

    user = await db.query_one_a("SELECT name FROM users WHERE id = ?", (user_id,))
    user_profile = {"name": user["name"] if user else "用户", "age": 0, "gender": "", "campus": "",
                    "major": "", "stage": "", "emergencyContact": ""}
    # 显示名以 users 表为准（筛查记录仅作兜底），否则新账号永远显示「用户」
    profile_name = await _current_user_name(ctx)
    if screenings:
        user_profile["name"] = profile_name or screenings[0].get("name") or "用户"
        user_profile["gender"] = screenings[0].get("gender") or ""
    elif profile_name:
        user_profile["name"] = profile_name

    personal_timeline = []
    for s in screenings[:5]:
        qn = await _qn_name(s["questionnaire_id"])
        personal_timeline.append({
            "date": format_dt(s.get("screening_date") or s.get("created_at")),
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


# 危机线索关键词：命中即判高风险（心理筛查里漏判的代价远高于误判）
_CRISIS_KEYWORDS = ("自杀", "想死", "不想活", "轻生", "自伤", "伤害自己",
                    "结束一切", "活着没意思", "活着没什么意思", "结束生命")


def _hits_alert_level(raw_results: list, query: str = "") -> str:
    """按"确有相似的命中"的风险分布给本次检索定级（纯规则，不调大模型）。

    三道过滤，避免误判与语料偏斜：
      1. 查询含危机线索 → 直接高风险（安全兜底，不等检索结果）；
      2. 相似度低于 0.70 的命中不算"相似"，不参与定级；
      3. 一条记录含 text/image/audio 多个单元，按 record_id 去重后统计，
         否则同一条高风险记录会被重复计数成"多条证据"。
    规则（预警要谨慎，高风险需多条证据）：
      red 或 orange≥2 → 高；orange 单条或 yellow≥2 → 中；其余 → 低。
    """
    if any(kw in query for kw in _CRISIS_KEYWORDS):
        return "red"

    counts = {"red": 0, "orange": 0, "yellow": 0}
    seen: set[str] = set()
    for r in raw_results:
        try:
            sim = float(r.get("similarity") or r.get("score") or 0)
        except (TypeError, ValueError):
            sim = 0.0
        if sim < 0.70:
            continue
        rid = str(r.get("record_id") or r.get("recordId") or r.get("id") or "")
        if rid:
            if rid in seen:
                continue
            seen.add(rid)
        level = str(r.get("alert_level") or r.get("alertLevel") or "green").lower()
        if level in counts:
            counts[level] += 1
    if counts["red"] or counts["orange"] >= 2:
        return "red"
    if counts["orange"] or counts["yellow"] >= 2:
        return "yellow"
    return "green"


async def _search_report(raw_results: list, query: str = "") -> dict:
    """检索结论：规则模板生成，不经过大模型（2026-10-14）。

    原先这里跟着检索同步调 RAG 引擎出报告，真实大模型下要 20-30 秒，
    必然撞上前端 15 秒超时、页面直接报"检索失败"。检索页要的是快，
    结论按命中风险分布用内置模板生成即可；需要大模型深度研判的场景
    走 /api/retrieval/report/{screening_id}（显式触发，可容忍长耗时）。
    """
    engine = MockRAGEngine()
    report = await engine.generate_report({
        "id": 0, "name": "本次检索", "questionnaire": "跨模态检索",
        "score": 0, "max_score": 100,
        "alert_level": _hits_alert_level(raw_results, query),
    })
    if isinstance(report, dict):
        report["mock"] = True
    return report


async def personal_search(ctx: RequestContext):
    """个人端检索：文本 / 图像 / 语音线索均可作为查询，返回结果 + 检索结论。

    查询模态由请求体的 `modality` 决定；图像/语音查询额外携带
    `media_base64`（+ `media_name`），由 perform_search 统一落盘与清理。
    """
    data = ctx.body or {}
    raw_results, info, modality, mf = await perform_search(data)
    # 本地检索引擎还可能包含真实筛查、预警和案例。个人端只展示语料命中。
    private_prefixes = ("scr-", "alt-", "case-")
    results = [to_frontend_hit(r) for r in raw_results
               if not str(r.get("record_id") or r.get("id") or "").lower().startswith(private_prefixes)]

    report = await _search_report(raw_results, data.get("query") or "")
    if isinstance(report, dict) and "risk_level" in report:
        report["riskLevel"] = report.pop("risk_level")

    return success_response(data={
        "results": results, "report": report, "query": data.get("query"),
        "modality": modality, "modality_filter": mf, "index": info,
    })


def _hits_context(hits: list, top_n: int = 5) -> str:
    """把检索命中拼成给大模型的 RAG 上下文（这正是"检索增强"的增强部分）。

    前端传来的命中是 camelCase（recordId / alertLevel），按记录去重后
    取相似度最高的前 top_n 条，每条附上风险等级与摘要。
    """
    seen: dict[str, tuple[float, dict]] = {}
    for h in hits:
        if not isinstance(h, dict):
            continue
        rid = str(h.get("recordId") or h.get("record_id") or h.get("id") or "")
        if not rid or rid in seen:
            continue
        try:
            sim = float(h.get("similarity") or h.get("score") or 0)
        except (TypeError, ValueError):
            sim = 0.0
        seen[rid] = (sim, h)
    top = sorted(seen.items(), key=lambda kv: kv[1][0], reverse=True)[:top_n]
    lines = []
    for rid, (sim, h) in top:
        level = str(h.get("alertLevel") or h.get("alert_level") or "green")
        level_name = {"green": "稳定", "yellow": "关注", "orange": "警告", "red": "高危"}.get(level, level)
        desc = str(h.get("summary") or h.get("text") or h.get("explain") or "").strip()[:100]
        lines.append(f"- 案例 {rid}（哈希相似度 {sim:.2f}，风险等级：{level_name}）{('：' + desc) if desc else ''}")
    return "\n".join(lines) if lines else "（本次检索没有返回命中详情）"


async def personal_rag_report(ctx: RequestContext):
    """检索页的 RAG 深度报告：大模型结合知识库与检索命中生成（约 20~30 秒）。

    与检索接口分离（2026-10-14 产品口径）：检索结果必须秒出（哈希检索的优势），
    由前端先渲染结果、在报告区显示"大模型思考中"，再单独请求本接口；
    大模型回来后替换展示。无 Key 或调用失败时引擎自动降级规则模板，
    mock 标记如实返回，前端兜底显示规则分析并标注来源。
    """
    data = ctx.body or {}
    query = str(data.get("query") or "")
    hits = data.get("hits") or []

    rag_engine = get_rag_engine()
    await rag_engine.initialize()

    screening_data = {
        "id": 0,
        "name": (query or "本次检索")[:40],
        "questionnaire": "跨模态检索",
        "score": 0,
        "max_score": 100,
        "alert_level": _hits_alert_level(hits, query),
        # RAG 的"增强"部分：哈希检索命中的相似案例摘要
        "retrieval_context": _hits_context(hits),
        "hit_count": len(hits),
    }

    report = await rag_engine.generate_report(screening_data)
    if isinstance(report, dict) and "risk_level" in report:
        report["riskLevel"] = report.pop("risk_level")
    # 来源取报告自身的标记（引擎如实写：真大模型 mock=False，降级 mock=True）。
    # 不能再用"配置文件里有没有 Key"来判断——Key 存在不代表这次调用成功（2026-10-15）。
    mock = bool((report or {}).get("mock", True))
    if isinstance(report, dict):
        report["mock"] = mock
    return success_response(data={"report": report, "mock": mock})
