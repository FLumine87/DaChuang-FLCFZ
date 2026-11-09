"""个人端接口 handler（保留前端响应字段结构，async）。"""
from datetime import datetime, timedelta
import json
import os
import uuid

from app.core.dates import format_dt
from app.core.responses import success_response
from app.core.exceptions import HttpError
from app.core.auth import RequestContext
from app.core.security import get_password_hash, verify_password
from app.db import database as db
from app.services import screening_service, case_service, alert_service
# 筛查结论由统一后端规则生成，RAG仅解释同一份证据。
from app.engines import get_rag_engine
from app.handlers.retrieval import perform_search, to_frontend_hit, viewer_of
from app.services import screening_assessment as assessment_service
from app.services import retrieval_screening as retrieval_service


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


async def _build_user_profile(ctx, user_id: int, screenings: list) -> dict:
    """组装个人资料（首页「我的档案」与「我的个案」页共用）。

    为什么抽成一个函数
    ----------------
    get_personal_dashboard 与 get_personal_profile 原先各写了一份 user_profile，
    两份都把 campus / major / stage / emergencyContact 写死成空串，
    于是首页与个案页的资料区都是空的。两处重复必然再次不同步，故统一到这里。

    取值规则（不改表结构，兼容既有库）：
      · name / gender / age   —— 优先 users 表，其次最近一次筛查记录
      · campus / major        —— users.department
      · stage（年级）          —— 从 department 里解析，约定写成
                                 "外国语学院 大三" → campus="外国语学院"、stage="大三"
      · emergencyContact      —— users.phone（留空时前端显示「未填写」）
    """
    import re

    user = await db.query_one_a(
        "SELECT name, department, phone, email FROM users WHERE id = ?", (user_id,))
    first_scr = screenings[0] if screenings else {}

    dep = (first_scr.get("department") or (user["department"] if user else "") or "").strip()
    m = re.match(r"^(.*?)[\s·／/]*((?:大[一二三四五]|研[一二三]|博[一二三四]))$", dep)
    campus, stage = (m.group(1).strip(), m.group(2)) if m else (dep, "")

    profile = {
        "name": (user["name"] if user else "") or "用户",
        "age": first_scr.get("age") or 0,
        "gender": first_scr.get("gender") or "",
        "campus": campus,
        "major": campus,
        "stage": stage,
        "emergencyContact": (user["phone"] if user else "") or first_scr.get("phone") or "",
    }
    # 显示名以 users 表为准（筛查记录仅作兜底），否则新账号永远显示「用户」
    profile_name = await _current_user_name(ctx)
    if screenings:
        profile["name"] = profile_name or first_scr.get("name") or "用户"
        profile["gender"] = first_scr.get("gender") or ""
    elif profile_name:
        profile["name"] = profile_name
    return profile


def _screening_item(s: dict, qn: str) -> dict:
    stored = assessment_service._json(s.get("answers"))
    answer_values = stored.get("values", stored)
    metadata = assessment_service._json(stored.get("_meta"))
    return {        "id": s.get("screening_id"),
        "answers": answer_values,
        "questionnaireVersion": metadata.get("questionnaireVersion") or s.get("questionnaireVersion"),
        "answerEncoding": metadata.get("answerEncoding") or s.get("answerEncoding"),
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
        "SELECT * FROM screenings WHERE screening_id = ? AND user_id = ?",
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
    # 分析先于入索引：否则检索会命中自己（相似度 1.0），每次都判高风险
    await _index_supplement(sup_id, kind, data, user_id)
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
    retrieval_source = retrieval_service.open_snapshot(data["retrievalToken"], user_id) if data.get("retrievalToken") else None
    if retrieval_source and (retrieval_source["modality"] != kind or (kind == "text" and retrieval_source["query"].strip() != str(data.get("text") or "").strip())):
        raise HttpError(400, "保存内容与本次检索依据不一致，请重新检索")
    row_id = await db.execute_a(
        "INSERT INTO screening_supplements (user_id, screening_id, kind, text, filename, url, description) "
        "VALUES (?, NULL, ?, ?, ?, ?, ?)",
        (user_id, kind, data.get("text"), data.get("filename"),
         data.get("url"), data.get("description")),
    )
    if retrieval_source:
        observations = await db.query_a("SELECT kind,text,created_at FROM screening_supplements WHERE user_id=? ORDER BY id DESC LIMIT 500", (user_id,))
        assessment = retrieval_service.build_retrieval_screening(retrieval_source["query"], retrieval_source["hits"],
            modality=kind, supplement_id=row_id, observations=observations)
        assessment["retrievalToken"] = data["retrievalToken"]
        report = await _collection_report(ctx, assessment, retrieval_source["hits"], {}, kind, retrieval_source["query"])
        report["retrievalSnapshot"] = retrieval_source
        await assessment_service.save_assessment({"id": row_id, "user_id": user_id}, assessment, report=report)
    else:
        report = await _analyze_collection(ctx, row_id, kind, data, user_id, None)
    await _index_supplement(row_id, kind, data, user_id)
    return success_response(data={"id": row_id, "report": report}, message="已保存到你的档案")


# ─── 采集的哈希检索分析 ────────────────────────────────────────────────────────

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
            "recordId": h.get("record_id") or h.get("recordId"),
            "modality": h.get("modality"),
            "modalityLabel": h.get("modality_label"),
            "summary": h.get("summary"),
            "similarity": round(float(h.get("similarity") or 0), 4),
            "alertLevel": h.get("alert_level") or h.get("alertLevel") or "unknown",
            "tags": h.get("tags") or [],
            "date": h.get("date"),
            "explain": h.get("explain"),
            "emotionLabel": h.get("emotion_label") or h.get("emotionLabel"),
            "screeningLabel": h.get("screening_label") or h.get("screeningLabel"),
            "labelSource": h.get("label_source") or h.get("labelSource"),
            "labelValidity": h.get("label_validity") or h.get("labelValidity"),
            "pairingType": h.get("pairing_type") or h.get("pairingType"),
            "screeningUsable": h.get("screening_usable", h.get("screeningUsable")),
            "referenceOnly": h.get("reference_only", h.get("referenceOnly")),
            "labelDescription": h.get("label_description") or h.get("labelDescription"),
            "media": h.get("media"),
            "mediaKind": h.get("media_kind") or h.get("mediaKind"),
            "mediaMeta": h.get("media_meta") or h.get("mediaMeta"),
            "crossModal": h.get("cross_modal", h.get("crossModal")),
        }.items() if v is not None
    }


async def _index_supplement(sup_id, kind: str, data: dict, user_id: int) -> None:
    """把一次采集写入哈希索引，等待管理端审核。

    采集内容此前只落业务表，索引里没有对应单元，审核页自然看不到。
    新数据以 reviewing 入池：本人可检索，他人不可见，不进训练。
    """
    try:
        from app.engines import get_hashing_engine
        text = (data.get("text") or "").strip()
        media_path = (_resolve_upload_path(data.get("url") or "")
                      if kind in ("audio", "image") else None)
        summary = text
        if not summary:
            label = _KIND_LABEL.get(kind, kind)
            summary = f"{label}采集 {data.get('filename') or ''} {data.get('description') or ''}".strip()
        if not summary:
            return
        get_hashing_engine().index_case_sync({
            "id": f"sup-{sup_id}",
            "record_id": f"sup-{sup_id}",
            "user_id": user_id,
            "modality": kind,
            "summary": summary,
            "media_path": media_path,
            "date": datetime.now().date().isoformat(),
            "scope": "reviewing",
            "source": "runtime",
        })
    except Exception:
        # 索引失败不影响采集本身，下次重训或人工补录可恢复
        pass


async def _analyze_collection(ctx: RequestContext, sup_id, kind: str, data: dict,
                              user_id: int, screening_row) -> dict | None:
    """保存后再评估本人证据；参考标签绝不直接转为本人的风险。"""
    from app.engines import get_hashing_engine
    query = (data.get("text") or "").strip()
    results, info = [], {}
    try:
        engine = get_hashing_engine()
        results, info = await engine.search_with_info(
            query=query, modality=kind, top_k=5, modality_filter=None,
            media_path=_resolve_upload_path(data.get("url") or "") if kind in ("audio", "image") else None,
            viewer=viewer_of(ctx),
        )
    except Exception:
        import traceback
        traceback.print_exc()
        info = {"source": "unavailable", "message": "参考检索暂不可用，仍可依据本人信息继续筛查"}
    if data.get("analysisMode") == "retrieval":
        supplement = await db.query_one_a("SELECT * FROM screening_supplements WHERE id=? AND user_id=?", (sup_id, user_id))
        observations = await db.query_a("SELECT kind,text,created_at FROM screening_supplements WHERE user_id=? ORDER BY id DESC LIMIT 500", (user_id,))
        hits = [to_frontend_hit(hit) for hit in results]
        source = retrieval_service.snapshot(query, hits, kind)
        assessment = retrieval_service.build_retrieval_screening(query, hits, modality=kind, supplement_id=sup_id, observations=observations)
        assessment["retrievalToken"] = retrieval_service.seal_snapshot(user_id, source)
        report = await _collection_report(ctx, assessment, results, info, kind, query)
        report["hits"] = hits
        report["retrievalSnapshot"] = source
        await assessment_service.save_assessment(supplement, assessment, report=report)
        return report
    screening, supplement, observations = await assessment_service.owned_context(
        user_id, (screening_row or {}).get("screening_id"), sup_id)
    previous = assessment_service._json(supplement.get("analysis"))
    assessment = assessment_service.build_assessment(query, screening=screening, observations=observations,
        hits=results, supplement_id=sup_id, previous=previous.get("assessment"))
    report = await _collection_report(ctx, assessment, results, info, kind, query, previous)
    await assessment_service.save_assessment(supplement, assessment, report=report)
    return report


async def _collection_report(ctx, assessment, results, info, kind, query, previous=None):
    previous = previous or {}
    previous_hits = {hit["id"]: hit for hit in previous.get("hits", []) if hit.get("id")}
    report_hits = [{**previous_hits.get(hit.get("id"), {}), **_report_hit(hit)} for hit in results]
    alert_id = previous.get("alertId")
    if assessment["level"] in ("orange", "red"):
        # One open assessment alert per supplement, even after repeated refresh/follow-up.
        trigger = f"筛查证据复核 · 补充#{assessment['supplementId']}"
        existing = await db.query_one_a("SELECT alert_id FROM alerts WHERE user_id=? AND trigger=? AND status IN ('pending','processing') ORDER BY id DESC LIMIT 1", (int(ctx.user["sub"]), trigger))
        if existing:
            alert_id = existing["alert_id"]
        else:
            alert_id = f"ALT-{uuid.uuid4().hex[:6].upper()}"
            screening_pk = await db.query_one_a("SELECT id FROM screenings WHERE screening_id=? AND user_id=?", (assessment.get("screeningId"), int(ctx.user["sub"]))) if assessment.get("screeningId") else None
            await db.execute_a("INSERT INTO alerts (alert_id, screening_id, user_id, name, level, trigger, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)",
                (alert_id, screening_pk["id"] if screening_pk else None, int(ctx.user["sub"]), await _current_user_name(ctx) or "用户", assessment["level"], trigger, assessment["conclusion"]))
    return {"modality": kind, "query": query[:500], "level": assessment["level"] or "unknown",
            "levelLabel": assessment["levelLabel"], "isAlert": assessment["level"] in ("orange", "red"),
            "reason": assessment["retrievalContribution"], "conclusion": assessment["conclusion"],
            "hits": report_hits, "alertId": alert_id,
            "index": info, "assessment": assessment, "supplementId": assessment.get("supplementId"),
            "createdAt": datetime.now().strftime("%Y-%m-%d %H:%M")}


async def personal_retrieval_assessment(ctx: RequestContext):
    """Preview or update the owned, persisted retrieval → follow-up → assessment chain."""
    data = ctx.body or {}
    user_id = int(ctx.user["sub"])
    supplement_id = data.get("supplementId")
    if supplement_id is not None:
        if type(supplement_id) is not int or supplement_id <= 0:
            raise HttpError(400, "补充记录编号无效")
    followups = data.get("followupAnswers") or {}
    if not isinstance(followups, dict) or set(followups) - assessment_service.FOLLOWUP_FIELDS:
        raise HttpError(400, "追问答案字段无效")
    if any(not isinstance(value, str) or len(value) > 160 for value in followups.values()):
        raise HttpError(400, "追问答案无效")
    if any(field in assessment_service.FOLLOWUP_OPTIONS and value not in assessment_service.FOLLOWUP_OPTIONS[field]
           for field, value in followups.items()):
        raise HttpError(400, "追问选项无效，请从当前问题的选项中选择")
    screening, supplement, observations = await assessment_service.owned_context(user_id, data.get("screeningId"), supplement_id)
    if followups and not supplement:
        raise HttpError(400, "请先保存本次输入，再补充追问答案")
    query = str(supplement.get("text") or "") if supplement else str(data.get("query") or "")[:6000]
    previous = assessment_service._json(supplement.get("analysis")) if supplement else {}
    results = previous.get("hits") or []
    info = previous.get("index") or {}
    if not results:
        search_data = {"query": assessment_service.build_symptom_query({"notes": query}), "modality": "text", "top_k": 5}
        try:
            results, info, _, _ = await perform_search(search_data, viewer=viewer_of(ctx))
        except Exception:
            info = {"source": "unavailable"}
    assessment = assessment_service.build_assessment(query, screening=screening, observations=observations,
        hits=results, followup_answers=followups, supplement_id=supplement_id, previous=previous.get("assessment"))
    if supplement:
        report = await _collection_report(ctx, assessment, results, info, supplement["kind"], query, previous)
        await assessment_service.save_assessment(supplement, assessment, report=report)
    return success_response(data={"assessment": assessment})


async def _retrieval_context(ctx):
    """Use this exact search's signed snapshot, never client-supplied labels."""
    data = ctx.body or {}
    uid = int(ctx.user["sub"])
    supplement = None
    if data.get("supplementId") is not None:
        if type(data["supplementId"]) is not int or data["supplementId"] <= 0:
            raise HttpError(400, "补充记录编号无效")
        supplement = await db.query_one_a("SELECT * FROM screening_supplements WHERE id=? AND user_id=?", (data["supplementId"], uid))
        if not supplement:
            raise HttpError(404, "补充记录不存在或不属于本人")
    previous = assessment_service._json((supplement or {}).get("analysis"))
    if data.get("retrievalToken"):
        source = retrieval_service.open_snapshot(data["retrievalToken"], uid)
    elif supplement:
        source = previous.get("retrievalSnapshot") or retrieval_service.snapshot(
            supplement.get("text") or "", previous.get("hits") or [], supplement["kind"])
    else:
        raise HttpError(400, "请先执行多模态检索")
    observations = await db.query_a("SELECT kind,text,created_at FROM screening_supplements WHERE user_id=? ORDER BY id DESC LIMIT 500", (uid,))
    assessment = retrieval_service.build_retrieval_screening(source["query"], source["hits"],
        modality=source["modality"], supplement_id=(supplement or {}).get("id"), observations=observations)
    assessment["retrievalToken"] = retrieval_service.seal_snapshot(uid, source)
    return assessment, source, supplement, previous


async def personal_retrieval_screening(ctx: RequestContext):
    assessment, source, supplement, previous = await _retrieval_context(ctx)
    if supplement:
        report = await _collection_report(ctx, assessment, source["hits"], {}, source["modality"], source["query"], previous)
        report["retrievalSnapshot"] = source
        await assessment_service.save_assessment(supplement, assessment, report=report)
    return success_response(data={"assessment": assessment})


def _supplement_dict(r: dict, note: dict = None) -> dict:
    """补充记录的对外形状（前端 Supplement 类型：kind + 可选 text/filename/url/description）。

    note 是这张记录上的便签（可能没有）—— 一起带出去，心理日记页就不用为每条
    再单独请求一次便签。
    """
    analysis = None
    raw = r.get("analysis")
    if raw:
        try:
            analysis = json.loads(raw)
        except Exception:
            analysis = None
    out = {
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
    out["note"] = (note or {}).get("content") or ""
    out["noteUpdatedAt"] = format_dt((note or {}).get("updated_at"), "%Y-%m-%d %H:%M", fallback="")
    return out


async def _notes_by_supplement(user_id: int, supplement_ids: list) -> dict:
    """批量取便签，避免每条记录各查一次（N+1）。"""
    ids = [int(i) for i in supplement_ids if i is not None]
    if not ids:
        return {}
    marks = ",".join("?" for _ in ids)
    rows = await db.query_a(
        f"SELECT supplement_id, content, updated_at FROM supplement_notes "
        f"WHERE user_id = ? AND supplement_id IN ({marks})",
        (user_id, *ids))
    return {r["supplement_id"]: r for r in rows}


async def get_personal_supplements(ctx: RequestContext):
    """当前用户的全部采集补充（含挂记录与挂用户名下两种），按时间倒序。

    检索页「我的记录」用它把新账号的用户级采集也纳入历史列表；
    首页以其中最新一条作为「最近一次输入」的兜底；心理日记整页也基于它。
    """
    user_id = int(ctx.user["sub"])
    rows = await db.query_a(
        "SELECT * FROM screening_supplements WHERE user_id = ? ORDER BY id DESC LIMIT 100",
        (user_id,),
    )
    notes = await _notes_by_supplement(user_id, [r.get("id") for r in rows])
    return success_response(data=[_supplement_dict(r, notes.get(r.get("id"))) for r in rows])


async def save_supplement_note(ctx: RequestContext, supplement_id: str):
    """给某条记录写 / 改便签。内容为空等于删掉这张便签。"""
    user_id = int(ctx.user["sub"])
    try:
        sid = int(supplement_id)
    except Exception:
        raise HttpError(400, "记录 ID 不正确")

    owned = await db.query_one_a(
        "SELECT id FROM screening_supplements WHERE id = ? AND user_id = ?",
        (sid, user_id))
    if not owned:
        raise HttpError(404, "记录不存在")

    content = (ctx.body or {}).get("content")
    content = "" if content is None else str(content).strip()
    if len(content) > 2000:
        raise HttpError(400, "便签过长（最多 2000 字）")

    existing = await db.query_one_a(
        "SELECT id FROM supplement_notes WHERE supplement_id = ? AND user_id = ?",
        (sid, user_id))

    if not content:
        # 清空 = 删除便签
        if existing:
            await db.execute_a("DELETE FROM supplement_notes WHERE id = ?", (existing["id"],))
        return success_response(data={"supplementId": sid, "note": ""})

    if existing:
        await db.execute_a(
            "UPDATE supplement_notes SET content = ?, updated_at = CURRENT_TIMESTAMP "
            "WHERE id = ?", (content, existing["id"]))
    else:
        await db.execute_a(
            "INSERT INTO supplement_notes (supplement_id, user_id, content) VALUES (?,?,?)",
            (sid, user_id, content))

    row = await db.query_one_a(
        "SELECT content, updated_at FROM supplement_notes WHERE supplement_id = ? AND user_id = ?",
        (sid, user_id))
    return success_response(data={
        "supplementId": sid,
        "note": (row or {}).get("content") or "",
        "noteUpdatedAt": format_dt((row or {}).get("updated_at"), "%Y-%m-%d %H:%M", fallback=""),
    })


async def delete_personal_supplement(ctx: RequestContext, supplement_id: str):
    """删除心理日记里的一条记录。

    连带处理：
      · 便签 —— 一起删掉（否则成为孤儿）；
      · 上传的媒体文件 —— 若 url 指向 uploads 目录且解析后仍在目录内，就删文件。
        路径校验是必须的：url 来自数据库，但一旦被污染成 ../../，直接删会出大事。
      · 由这条记录触发出来的预警 —— **保留**。预警是独立的临床留痕，
        删记录不该顺手抹掉"曾经报过警"这件事。
    """
    user_id = int(ctx.user["sub"])
    try:
        sid = int(supplement_id)
    except Exception:
        raise HttpError(400, "记录 ID 不正确")

    row = await db.query_one_a(
        "SELECT * FROM screening_supplements WHERE id = ? AND user_id = ?",
        (sid, user_id))
    if not row:
        raise HttpError(404, "记录不存在")

    # 便签
    await db.execute_a(
        "DELETE FROM supplement_notes WHERE supplement_id = ? AND user_id = ?", (sid, user_id))

    # 媒体文件（仅当确实在 uploads 目录内）
    url = (row.get("url") or "").strip()
    if url.startswith("/uploads/"):
        try:
            root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "uploads"))
            target = os.path.abspath(os.path.join(root, url[len("/uploads/"):]))
            if target.startswith(root + os.sep) and os.path.isfile(target):
                os.remove(target)
        except Exception:
            pass  # 删文件失败不影响删记录

    await db.execute_a(
        "DELETE FROM screening_supplements WHERE id = ? AND user_id = ?", (sid, user_id))
    return success_response(data={"deleted": sid})


async def submit_personal_screening(ctx: RequestContext):
    data = ctx.body
    user_id = int(ctx.user["sub"])
    user = await db.query_one_a("SELECT name FROM users WHERE id = ?", (user_id,))
    q = await db.query_one_a("SELECT * FROM questionnaires WHERE code = ?", (data.get("questionnaire", ""),))
    if not q:
        raise HttpError(400, "问卷不存在")
    answers = data.get("answers")
    result = assessment_service.score_questionnaire(q["code"], answers,
        version=data.get("questionnaireVersion"), encoding=data.get("answerEncoding"))
    score, alert_level = result["score"], result["level"]
    stored_answers = {"values": answers, "_meta": {
        "questionnaireVersion": result["version"], "answerEncoding": result["answerEncoding"]}}
    row = await screening_service.create_screening({
        "user_id": user_id,
        "name": user["name"] if user else "用户",
        "age": data.get("age"),
        "gender": data.get("gender"),
        "department": data.get("department"),
        "questionnaire_id": q["id"],
        "score": score,
        "max_score": result["maxScore"],
        "answers": json.dumps(stored_answers, ensure_ascii=False, sort_keys=True),
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
        "score": score,
        "maxScore": result["maxScore"],
        "symptomSeverity": result["symptomSeverity"],
        "safetyStatus": result["safetyStatus"],
        "requiresHumanReview": result["requiresHumanReview"],
        "questionnaireVersion": result["version"],
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
        # 量表名本身可能已含「筛查」（如"PHQ-9 抑郁筛查"），避免拼成"…筛查筛查"
        qn_label = qn if str(qn).endswith("筛查") else f"{qn}筛查"
        personal_timeline.append({
            "date": format_dt(s.get("screening_date") or s.get("created_at")),
            "type": "screening",
            "title": f"完成{qn_label}",
            "detail": f"得分{s.get('score')}分，风险等级:{s.get('alert_level')}",
        })

    user_profile = await _build_user_profile(ctx, user_id, screenings)

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

    user_profile = await _build_user_profile(ctx, user_id, screenings)

    # 两类事件分开收集，最后按类型分别限额再合并。
    #
    # 为什么不能"合并后统一取前 N 条"：检索记录往往比量表密集得多（一天能写好
    # 几条），统一取前 8 会让较新的检索记录把量表整批挤出去 —— 时间线变成
    # "只有检索、没有问卷"，与"两类都要显示"的初衷相反。
    _SCR_LIMIT = 5
    _SUP_LIMIT = 6

    scr_events = []
    for s in screenings[:_SCR_LIMIT]:
        qn = await _qn_name(s["questionnaire_id"])
        # 量表名本身可能已含「筛查」（如"PHQ-9 抑郁筛查"），避免拼成"…筛查筛查"
        qn_label = qn if str(qn).endswith("筛查") else f"{qn}筛查"
        scr_events.append({
            "date": format_dt(s.get("screening_date") or s.get("created_at"), "%Y-%m-%d %H:%M"),
            "type": "screening",
            "title": f"完成{qn_label}",
            "detail": f"得分{s.get('score')}分，风险等级:{s.get('alert_level')}",
        })

    # 检索 / 采集记录也进时间线。
    # 原先只有"完成某量表"这一类事件，档案里看不出"我什么时候做过记录、检索过什么"；
    # 而检索记录恰恰是本平台区别于纯量表的地方，漏掉它时间线就少了一半。
    _KIND_LABEL = {"text": "文字", "audio": "语音", "image": "图像"}
    _KIND_VERB = {"text": "写下文字", "audio": "录入语音", "image": "上传图片"}
    sups = await db.query_a(
        "SELECT id, kind, text, filename, description, analysis, created_at "
        "FROM screening_supplements WHERE user_id = ? "
        "ORDER BY created_at DESC, id DESC LIMIT 20",
        (user_id,))
    sup_events = []
    for r in sups[:_SUP_LIMIT]:
        analysis = None
        try:
            analysis = json.loads(r.get("analysis") or "null")
        except Exception:
            analysis = None
        level_label = (analysis or {}).get("levelLabel") or "未评估"
        kind = r.get("kind") or "text"
        # 摘要：文字取原文，媒体取文件名（太长就截断，时间线里放不下）
        snippet = (r.get("text") or "").strip() or (r.get("filename") or "").strip()
        if len(snippet) > 26:
            snippet = snippet[:26] + "…"
        detail = f"检索分析：{level_label}"
        if snippet:
            detail = f"{detail} · {snippet}"
        sup_events.append({
            # 精确到分钟：同一天可能有多条记录，只到日期就排不出先后
            "date": format_dt(r.get("created_at"), "%Y-%m-%d %H:%M"),
            "type": "collection",
            "title": f"{_KIND_VERB.get(kind, '记录一次')}并做了检索分析",
            "detail": detail,
            "modality": kind,
            "modalityLabel": _KIND_LABEL.get(kind, kind),
        })

    personal_timeline = scr_events + sup_events
    personal_timeline.sort(key=lambda x: x.get("date") or "", reverse=True)

    return success_response(data={
        "screeningRecords": screening_records,
        "warningEvents": warning_events,
        "userProfile": user_profile,
        "personalTimeline": personal_timeline,
    })


def _hits_alert_level(raw_results: list, query: str = "") -> str:
    """Compatibility shim: candidate risk labels never determine a user's level."""
    return assessment_service.build_assessment(query)["level"] or "unknown"


async def _search_report(raw_results: list, query: str = "") -> dict:
    return assessment_service.assessment_report(assessment_service.build_assessment(query, hits=raw_results))


async def personal_search(ctx: RequestContext):
    """个人端检索：文本 / 图像 / 语音线索均可作为查询，返回结果 + 检索结论。

    查询模态由请求体的 `modality` 决定；图像/语音查询额外携带
    `media_base64`（+ `media_name`），由 perform_search 统一落盘与清理。
    """
    data = ctx.body or {}
    raw_results, info, modality, mf = await perform_search(data, viewer=viewer_of(ctx))
    # 本地检索引擎还可能包含真实筛查、预警和案例。个人端只展示语料命中。
    private_prefixes = ("scr-", "alt-", "case-")
    results = [to_frontend_hit(r) for r in raw_results
               if not str(r.get("record_id") or r.get("id") or "").lower().startswith(private_prefixes)]

    source = retrieval_service.snapshot(data.get("query"), results, modality)
    assessment = retrieval_service.build_retrieval_screening(source["query"], source["hits"], modality=modality)
    assessment["retrievalToken"] = retrieval_service.seal_snapshot(int(ctx.user["sub"]), source)
    report = assessment_service.assessment_report(assessment)

    return success_response(data={
        "results": results, "report": report, "query": data.get("query"),
        "modality": modality, "modality_filter": mf, "index": info, "assessment": assessment,
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
    if data.get("analysisMode") == "retrieval":
        assessment, source, _, _ = await _retrieval_context(ctx)
        include_original = data.get("includeOriginalInput", True)
        if type(include_original) is not bool:
            raise HttpError(400, "原始输入分析开关必须为布尔值")
        # Use the owned snapshot's actual query, never a different browser-supplied query.
        original_text = str(source.get("query") or "").strip()[:6000] if include_original else ""
        engine = get_rag_engine()
        await engine.initialize()
        report = await engine.generate_report({"name": "多模态检索初筛", "screening_assessment": assessment,
            "original_input": {"enabled": include_original, "text": original_text, "modality": source["modality"]},
            "alert_level": assessment["level"] or "unknown"})
        if isinstance(report, dict) and "risk_level" in report:
            report["riskLevel"] = report.pop("risk_level")
        if isinstance(report, dict):
            used = bool(original_text) and not bool(report.get("mock", True))
            if not include_original:
                notice = "已关闭原始输入分析，仅依据检索筛查结果生成。"
            elif source["modality"] in ("image", "audio"):
                notice = ("已结合附带文字；" if used else "") + "当前大模型不直接解读原始图片或语音，本次媒体线索依据检索结果分析。"
            elif used:
                notice = "已结合本次原始文字与检索筛查结果分析。"
            else:
                notice = "本次未使用原始文字生成大模型分析，保留检索证据结论。"
            report["originalInput"] = {"enabled": include_original, "used": used, "modality": source["modality"], "notice": notice}
        return success_response(data={"report": report, "mock": bool((report or {}).get("mock", True))})
    user_id = int(ctx.user["sub"])
    screening, supplement, observations = await assessment_service.owned_context(user_id, data.get("screeningId"), data.get("supplementId"))
    query = str(supplement.get("text") or "") if supplement else str(data.get("query") or "")
    saved_report = assessment_service._json((supplement or {}).get("analysis"))
    # References are server results; never trust risk labels or evidence passed by the browser.
    hits = saved_report.get("hits") or []
    if not hits:
        try:
            hits, _, _, _ = await perform_search({"query": query, "modality": "text", "top_k": 5}, viewer=viewer_of(ctx))
        except Exception:
            hits = []
    assessment = assessment_service.build_assessment(query, screening=screening, observations=observations,
        hits=hits, supplement_id=(supplement or {}).get("id"), previous=saved_report.get("assessment"))

    rag_engine = get_rag_engine()
    await rag_engine.initialize()

    screening_data = {"name": "本次筛查", "screening_assessment": assessment,
        "questionnaire": (assessment.get("scaleResult") or {}).get("code") or "尚未完成量表",
        "score": (assessment.get("scaleResult") or {}).get("score"),
        "max_score": (assessment.get("scaleResult") or {}).get("maxScore"),
        "alert_level": assessment["level"] or "unknown"}

    report = await rag_engine.generate_report(screening_data)
    if isinstance(report, dict) and "risk_level" in report:
        report["riskLevel"] = report.pop("risk_level")
    # 来源取报告自身的标记（引擎如实写：真大模型 mock=False，降级 mock=True）。
    # 不能再用"配置文件里有没有 Key"来判断——Key 存在不代表这次调用成功（2026-10-15）。
    mock = bool((report or {}).get("mock", True))
    if isinstance(report, dict):
        report["mock"] = mock
    return success_response(data={"report": report, "mock": mock, "assessment": assessment})


# ================================ 今日行动计划 ================================
#
# 这张卡要同时承担四件事：
#   1. 系统按"条件"自动生成的提醒（如两周没做问卷就催一次）
#   2. 用户自己写进去的计划
#   3. 待进行 / 已归档 两个分区
#   4. 手动标注完成 → 从待进行消失、进归档
#
# 所以不能像以前那样每次请求现算现返回（那样"完成"无处可存），
# 而是落库到 action_plans，按 user_id 维度持久化。

# 同一规则完成后，这么多天内不再重复生成（否则"完成完又冒出来"）
_AUTO_PLAN_COOLDOWN_DAYS = 7


def _plan_row(r: dict) -> dict:
    """一行 action_plans → 前端结构。时间都截到分钟，与界面显示口径一致。"""
    return {
        "id": r["id"],
        "title": r["title"],
        "detail": r.get("detail") or "",
        "source": r.get("source") or "user",
        "status": r.get("status") or "pending",
        # 计划制定的那一刻（右上角展示）
        "createdAt": format_dt(r.get("created_at"), "%Y-%m-%d %H:%M"),
        # 计划截止时间（待进行列表按它升序）
        "dueAt": format_dt(r.get("due_at"), "%Y-%m-%d %H:%M", fallback=""),
        "completedAt": format_dt(r.get("completed_at"), "%Y-%m-%d %H:%M", fallback=""),
    }


def _days_since(ts) -> int | None:
    """把库里那串时间解析成"距今天数"，解析不出来返回 None。"""
    if not ts:
        return None
    raw = str(ts).replace("T", " ").strip()
    now = datetime.now()
    for fmt, ln in (("%Y-%m-%d %H:%M:%S", 19), ("%Y-%m-%d %H:%M", 16), ("%Y-%m-%d", 10)):
        try:
            return (now - datetime.strptime(raw[:ln], fmt)).days
        except Exception:
            continue
    return None


def _auto_plan_rules(screenings: list, supplements: list, alerts: list) -> list:
    """按用户真实数据算出"该提醒什么"，返回 (rule_key, 标题, 说明, 截止偏移天)。

    每条规则都对应一个**可验证的事实**，不是套话：
      · 超过 14 天没做量表 → 催一次筛查（用户点名要的那条）
      · 超过 7 天没有记录   → 催一次近况记录
      · 有未处置的预警     → 跟进
      · 最近一次是高危     → 预约辅导
      · 距上次筛查 7~14 天 → 回看报告
    """
    out = []
    last_scr = _days_since((screenings[0].get("screening_date")
                            or screenings[0].get("created_at"))) if screenings else None
    last_sup = _days_since(supplements[0].get("created_at")) if supplements else None

    # ① 两周没做量表（用户点名的规则）
    if last_scr is None:
        out.append(("auto-no-screening", "完成一次心理筛查",
                    "还没有任何筛查记录，先做一次才能看清状态。", 3))
    elif last_scr >= 14:
        out.append(("auto-no-screening", "做一次心理筛查",
                    f"已经 {last_scr} 天没做量表了，建议每 2 周复测一次。", 3))

    # ② 一周没有记录近况
    if last_sup is None:
        out.append(("auto-no-record", "记录一次今天的近况",
                    "还没有文字 / 语音记录，写下几句就能留下线索。", 2))
    elif last_sup >= 7:
        out.append(("auto-no-record", "记录一次今天的近况",
                    f"距上次记录已有 {last_sup} 天。", 2))

    # ③ 有待处置的预警
    pending = [a for a in alerts
               if (a.get("status") or "pending") in ("pending", "processing")]
    if pending:
        out.append(("auto-pending-alert", "跟进待处理的预警",
                    f"有 {len(pending)} 条预警还没有处置结果。", 1))

    # ④ 最近一次是高危
    if screenings and screenings[0].get("alert_level") == "red":
        out.append(("auto-high-risk", "预约一次心理辅导",
                    "最近一次筛查达到高危，建议尽快与咨询师聊一次。", 2))

    # ⑤ 到了该回看报告的时候
    if last_scr is not None and 7 <= last_scr < 14:
        out.append(("auto-review-report", "回看上一次的筛查报告",
                    f"距上次筛查 {last_scr} 天，复看一遍结论与建议。", 5))

    return out


async def _ensure_auto_plans(user_id: int) -> None:
    """把当前命中的自动计划写进库（幂等）。

    去重：同 rule_key 若**还有待办**，或**完成未满冷却期**，就跳过。
    """
    screenings = await db.query_a(
        "SELECT * FROM screenings WHERE user_id = ? "
        "ORDER BY screening_date DESC, id DESC LIMIT 5", (user_id,))
    supplements = await db.query_a(
        "SELECT * FROM screening_supplements WHERE user_id = ? ORDER BY id DESC LIMIT 5",
        (user_id,))
    alerts = await db.query_a(
        "SELECT a.* FROM alerts a LEFT JOIN screenings s ON a.screening_id = s.id "
        "WHERE (s.user_id = ? OR a.user_id = ?) ORDER BY a.created_at DESC LIMIT 20",
        (user_id, user_id))

    now = datetime.now()
    for rule_key, title, detail, due_days in _auto_plan_rules(screenings, supplements, alerts):
        existing = await db.query_a(
            "SELECT status, completed_at FROM action_plans "
            "WHERE user_id = ? AND rule_key = ? ORDER BY id DESC LIMIT 1",
            (user_id, rule_key))
        if existing:
            row = existing[0]
            if (row.get("status") or "pending") == "pending":
                continue                      # 已有待办
            done_days = _days_since(row.get("completed_at"))
            if done_days is None or done_days < _AUTO_PLAN_COOLDOWN_DAYS:
                continue                      # 冷却期内不重复
        due = (now + timedelta(days=due_days)).strftime("%Y-%m-%d %H:%M:%S")
        await db.execute_a(
            "INSERT INTO action_plans (user_id, title, detail, source, rule_key, status, "
            "due_at, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (user_id, title, detail, "auto", rule_key, "pending", due,
             now.strftime("%Y-%m-%d %H:%M:%S")))


async def get_personal_plans(ctx: RequestContext):
    """今日行动计划：待进行 + 已归档。

    待进行按截止时间升序（越急越靠前），没有截止时间的排最后；
    归档按完成时间倒序。
    """
    user_id = int(ctx.user["sub"])
    await _ensure_auto_plans(user_id)

    pending = await db.query_a(
        "SELECT * FROM action_plans WHERE user_id = ? AND status = 'pending' "
        "ORDER BY (due_at IS NULL), due_at ASC, id ASC", (user_id,))
    archived = await db.query_a(
        "SELECT * FROM action_plans WHERE user_id = ? AND status = 'done' "
        "ORDER BY completed_at DESC, id DESC LIMIT 200", (user_id,))

    return success_response(data={
        "pending": [_plan_row(r) for r in pending],
        "archived": [_plan_row(r) for r in archived],
        # 卡片右上角显示"计划制定于"，取本次读取的时刻
        "generatedAt": format_dt(datetime.now(), "%Y-%m-%d %H:%M"),
    })


async def create_personal_plan(ctx: RequestContext):
    """用户自己写一条计划。dueAt 可空（空表示不设截止）。"""
    user_id = int(ctx.user["sub"])
    data = ctx.body or {}
    title = (data.get("title") or "").strip()
    if not title:
        raise HttpError(400, "计划内容不能为空")
    if len(title) > 200:
        raise HttpError(400, "计划内容过长（最多 200 字）")

    due = (data.get("dueAt") or "").strip()
    if due:
        raw = due.replace("T", " ")
        # 日期控件只给到 YYYY-MM-DD，补成当天 23:59，符合"截止"的语义
        if len(raw) == 10:
            raw = f"{raw} 23:59:00"
        elif len(raw) == 16:
            raw = f"{raw}:00"
        try:
            datetime.strptime(raw[:19], "%Y-%m-%d %H:%M:%S")
        except Exception:
            raise HttpError(400, "截止时间格式不正确")
        due = raw[:19]
    else:
        due = None

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    await db.execute_a(
        "INSERT INTO action_plans (user_id, title, detail, source, rule_key, status, "
        "due_at, created_at) VALUES (?,?,?,?,?,?,?,?)",
        (user_id, title, (data.get("detail") or "").strip(), "user", None,
         "pending", due, now))
    row = await db.query_one_a(
        "SELECT * FROM action_plans WHERE user_id = ? ORDER BY id DESC LIMIT 1", (user_id,))
    return success_response(data={"plan": _plan_row(row) if row else None})


async def complete_personal_plan(ctx: RequestContext, plan_id: str):
    """手动标注完成 → 从待进行移入归档。"""
    user_id = int(ctx.user["sub"])
    try:
        pid = int(plan_id)
    except Exception:
        raise HttpError(400, "计划 ID 不正确")

    row = await db.query_one_a(
        "SELECT * FROM action_plans WHERE id = ? AND user_id = ?", (pid, user_id))
    if not row:
        raise HttpError(404, "计划不存在")
    if (row.get("status") or "pending") == "done":
        return success_response(data={"plan": _plan_row(row)})

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    await db.execute_a(
        "UPDATE action_plans SET status = 'done', completed_at = ? WHERE id = ?",
        (now, pid))
    row = await db.query_one_a("SELECT * FROM action_plans WHERE id = ?", (pid,))
    return success_response(data={"plan": _plan_row(row) if row else None})


async def restore_personal_plan(ctx: RequestContext, plan_id: str):
    """把归档里的计划「回归」到待进行 —— 误标完成时的后悔药。

    为什么要这个
    ------------
    归档列表里的每一条都是点过一次「完成」的。手滑点错、或者做完又想再跟踪
    一轮，都只能靠"重新写一条"来凑，很别扭。回归直接把状态改回 pending、
    清掉完成时间，原样回到待进行列表（截止时间与制定时间都保留）。
    """
    user_id = int(ctx.user["sub"])
    try:
        pid = int(plan_id)
    except Exception:
        raise HttpError(400, "计划 ID 不正确")

    row = await db.query_one_a(
        "SELECT * FROM action_plans WHERE id = ? AND user_id = ?", (pid, user_id))
    if not row:
        raise HttpError(404, "计划不存在")
    if (row.get("status") or "pending") != "done":
        raise HttpError(400, "这条计划还没有归档，无需回归")

    await db.execute_a(
        "UPDATE action_plans SET status = 'pending', completed_at = NULL WHERE id = ?",
        (pid,))
    row = await db.query_one_a("SELECT * FROM action_plans WHERE id = ?", (pid,))
    return success_response(data={"plan": _plan_row(row) if row else None})


async def delete_personal_plan(ctx: RequestContext, plan_id: str):
    """永久删除一条计划。

    权限口径：
      · 自己写的（source=user）—— 待进行或已归档都能删，**真删**；
      · 系统生成的（source=auto）—— **仅限已归档**才能删。
        待进行中的系统提醒不允许删：那条是"你还没处理的事"，
        删掉只会让它按规则重新长出来，不如标完成（或先归档再删）。

    自动计划为什么是"软删除"（status='deleted' 而不是 DELETE）
    -------------------------------------------------------
    硬删会连 rule_key 的历史一起清掉，冷却期随之失效 —— 下一次 GET 立刻按
    同一条规则重新生成一条一模一样的待办，用户会觉得"删了又回来"。
    改成软删除后：列表里的 pending/done 查询天然看不到它（等于删掉了），
    但规则历史还在，冷却期继续生效，几天内不会反复弹出来。
    """
    user_id = int(ctx.user["sub"])
    try:
        pid = int(plan_id)
    except Exception:
        raise HttpError(400, "计划 ID 不正确")

    row = await db.query_one_a(
        "SELECT * FROM action_plans WHERE id = ? AND user_id = ?", (pid, user_id))
    if not row:
        raise HttpError(404, "计划不存在")

    is_auto = (row.get("source") or "user") != "user"
    is_done = (row.get("status") or "pending") == "done"
    if is_auto and not is_done:
        raise HttpError(400, "系统生成的待办不能直接删除，请先标记完成，再在归档里删除")

    if is_auto:
        # 软删除：列表看不到，但保留规则历史（冷却期继续生效）
        await db.execute_a(
            "UPDATE action_plans SET status = 'deleted' WHERE id = ?", (pid,))
    else:
        await db.execute_a("DELETE FROM action_plans WHERE id = ?", (pid,))
    return success_response(data={"deleted": pid})


# ================================ 账号设置 ================================
#
# 顶栏头像菜单里的「账号设置」：改个人信息 + 改密码。
# 路由用的是 "user" 级别（= 任何已登录角色），所以管理端也能用同一套接口。

import re as _re

_PHONE_RE = _re.compile(r"^[0-9+\-\s()]{5,20}$")
_EMAIL_RE = _re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _account_dict(u: dict) -> dict:
    """账号信息（**不含**密码哈希，任何接口都不该把它发出去）。"""
    return {
        "username": u.get("username") or "",
        "name": u.get("name") or "",
        "role": u.get("role") or "user",
        "department": u.get("department") or "",
        "phone": u.get("phone") or "",
        "email": u.get("email") or "",
    }


async def get_my_account(ctx: RequestContext):
    user_id = int(ctx.user["sub"])
    u = await db.query_one_a(
        "SELECT id, username, name, role, department, phone, email FROM users WHERE id = ?",
        (user_id,))
    if not u:
        raise HttpError(404, "账号不存在")
    return success_response(data={"account": _account_dict(u)})


async def update_my_account(ctx: RequestContext):
    """改个人信息。只允许改这四项 —— 用户名与角色涉及登录与权限，不开放自改。"""
    user_id = int(ctx.user["sub"])
    data = ctx.body or {}

    name = (data.get("name") or "").strip()
    department = (data.get("department") or "").strip()
    phone = (data.get("phone") or "").strip()
    email = (data.get("email") or "").strip()

    if not name:
        raise HttpError(400, "姓名不能为空")
    if len(name) > 50:
        raise HttpError(400, "姓名过长（最多 50 字）")
    if len(department) > 100:
        raise HttpError(400, "院系 / 部门过长（最多 100 字）")
    # 联系方式允许留空（很多人不愿填），填了就必须像样
    if phone and not _PHONE_RE.match(phone):
        raise HttpError(400, "手机号格式不正确")
    if email and not _EMAIL_RE.match(email):
        raise HttpError(400, "邮箱格式不正确")

    await db.execute_a(
        "UPDATE users SET name = ?, department = ?, phone = ?, email = ?, "
        "updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (name, department or None, phone or None, email or None, user_id))

    u = await db.query_one_a(
        "SELECT id, username, name, role, department, phone, email FROM users WHERE id = ?",
        (user_id,))
    return success_response(data={"account": _account_dict(u) if u else None})


async def change_my_password(ctx: RequestContext):
    """改密码。必须验证旧密码 —— 否则任何拿到 token 的人都能改掉别人密码。"""
    user_id = int(ctx.user["sub"])
    data = ctx.body or {}
    old = data.get("oldPassword") or ""
    new = data.get("newPassword") or ""

    if not old:
        raise HttpError(400, "请输入当前密码")
    if len(new) < 6:
        raise HttpError(400, "新密码至少 6 位")
    if len(new) > 64:
        raise HttpError(400, "新密码过长（最多 64 位）")
    if new == old:
        raise HttpError(400, "新密码不能与当前密码相同")

    u = await db.query_one_a(
        "SELECT password_hash FROM users WHERE id = ?", (user_id,))
    if not u:
        raise HttpError(404, "账号不存在")
    if not verify_password(old, u["password_hash"] or ""):
        raise HttpError(400, "当前密码不正确")

    await db.execute_a(
        "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (get_password_hash(new), user_id))
    return success_response(data={"changed": True})
