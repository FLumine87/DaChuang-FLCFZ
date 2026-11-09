"""Explicit staff-approved review requests and private in-app notifications."""
import json
import uuid
from datetime import date

from app.core.exceptions import HttpError
from app.db import database as db

SCHEMA = (
    """CREATE TABLE IF NOT EXISTS review_requests (
        id TEXT PRIMARY KEY, source_task_id TEXT UNIQUE NOT NULL, case_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL, title TEXT NOT NULL, instructions TEXT NOT NULL,
        questionnaire TEXT NOT NULL, due_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'sent',
        created_by INTEGER NOT NULL, screening_id TEXT, review_notes TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        acknowledged_at TEXT, submitted_at TEXT, reviewed_at TEXT, reviewed_by INTEGER)""",
    """CREATE TABLE IF NOT EXISTS review_notifications (
        id TEXT PRIMARY KEY, recipient_id INTEGER NOT NULL, request_id TEXT NOT NULL,
        event_key TEXT NOT NULL, message TEXT NOT NULL, read_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(recipient_id,event_key))""",
    "CREATE INDEX IF NOT EXISTS ix_review_requests_user ON review_requests(user_id,created_at)",
    "CREATE INDEX IF NOT EXISTS ix_review_notifications_user ON review_notifications(recipient_id,read_at)",
)


async def ensure_schema():
    for sql in SCHEMA:
        await db.execute_a(sql)


def actor_id(ctx):
    try:
        value = int(ctx.user["sub"])
        if value <= 0:
            raise ValueError()
        return value
    except (KeyError, ValueError, TypeError):
        raise HttpError(401, "登录凭证缺少有效账号，请重新登录")


def public(row):
    return {k: row.get(k) for k in (
        "id", "title", "instructions", "questionnaire", "due_at", "status", "screening_id",
        "version", "created_at", "acknowledged_at", "submitted_at", "reviewed_at")}


def notification(recipient, rid, event, message):
    return ("INSERT OR IGNORE INTO review_notifications(id,recipient_id,request_id,event_key,message) VALUES(?,?,?,?,?)",
            (uuid.uuid4().hex, recipient, rid, rid + ":" + event, message))


async def send(ctx):
    from app.services import agent_workspace
    await ensure_schema()
    await agent_workspace.ensure_schema()
    data = ctx.body
    task = await db.query_one_a("SELECT * FROM agent_workspace_tasks WHERE id=?", (data.get("task_id"),))
    if not task or task["scope"] != "live" or not task["subject"].startswith("case:"):
        raise HttpError(400, "只能向已关联真实账号的业务案例发送任务")
    case = await db.query_one_a("SELECT * FROM cases WHERE id=?", (task["subject"][5:],))
    if not case or not case.get("user_id"):
        raise HttpError(409, "案例尚未关联账号")
    user = await db.query_one_a("SELECT id FROM users WHERE id=? AND is_active=1 AND role='user'", (case["user_id"],))
    if not user:
        raise HttpError(409, "接收账号不存在或不可用")
    if task["state"] not in ("confirmed", "modified"):
        raise HttpError(409, "请先在管理端审核并分配任务")
    title, instructions = data.get("title"), data.get("instructions")
    if not isinstance(title, str) or not 1 <= len(title.strip()) <= 180 or not isinstance(instructions, str) or not 1 <= len(instructions.strip()) <= 2000:
        raise HttpError(400, "请填写对个人可见的标题和说明，标题限180字，说明限2000字")
    questionnaire = data.get("questionnaire")
    if questionnaire not in ("PHQ-9", "GAD-7", "ISI", "PSS-10"):
        raise HttpError(400, "复查量表无效")
    if not await db.query_one_a("SELECT id FROM questionnaires WHERE code=? AND is_active=1", (questionnaire,)):
        raise HttpError(400, "该量表尚未启用")
    try:
        due = date.fromisoformat(data.get("due_at", ""))
    except (ValueError, TypeError):
        raise HttpError(400, "计划日期无效")
    staff = actor_id(ctx)
    # Stable per source task: retries and double-clicks do not create a new delivery.
    rid = uuid.uuid5(uuid.NAMESPACE_URL, "review:" + task["id"]).hex
    existing = await db.query_one_a("SELECT * FROM review_requests WHERE id=?", (rid,))
    if existing and (existing["user_id"] != user["id"] or existing["title"] != title.strip()
                     or existing["instructions"] != instructions.strip() or existing["questionnaire"] != questionnaire
                     or existing["due_at"] != due.isoformat()):
        raise HttpError(409, "该任务已发出，请查看原任务；不能通过重复发送修改内容")
    sql = ("INSERT OR IGNORE INTO review_requests(id,source_task_id,case_id,user_id,title,instructions,questionnaire,due_at,created_by) "
           "SELECT ?,?,?,?,?,?,?,?,? FROM agent_workspace_tasks WHERE id=? AND version=? AND state IN ('confirmed','modified')")
    notice_sql, notice_params = notification(user["id"], rid, "sent", "你收到一项复查任务，请查看说明和计划日期。")
    await db.batch_a([
        (sql, (rid, task["id"], case["id"], user["id"], title.strip(), instructions.strip(), questionnaire, due.isoformat(), staff, task["id"], task["version"])),
        (notice_sql.replace("VALUES(?,?,?,?,?)", "SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM review_requests WHERE id=?)"), (*notice_params, rid)),
    ])
    row = await db.query_one_a("SELECT * FROM review_requests WHERE id=?", (rid,))
    if not row:
        raise HttpError(409, "任务已被其他人更新，请刷新")
    return public(row)


async def list_requests(ctx, staff=False):
    await ensure_schema()
    if staff:
        case_id = ctx.query_params.get("case")
        rows = await db.query_a("SELECT r.*,c.case_id AS case_code,u.name AS recipient_name,s.score,s.max_score,s.alert_level FROM review_requests r "
                                "JOIN cases c ON c.id=r.case_id JOIN users u ON u.id=r.user_id LEFT JOIN screenings s ON s.screening_id=r.screening_id "
                                "WHERE c.case_id=? ORDER BY r.created_at DESC,r.id", (case_id,))
        return [{**public(row), "recipient": row["recipient_name"], "review_notes": row["review_notes"],
                 "source_task_id": row["source_task_id"], "score": row["score"], "max_score": row["max_score"], "alert_level": row["alert_level"]} for row in rows]
    rows = await db.query_a("SELECT * FROM review_requests WHERE user_id=? ORDER BY created_at DESC,id", (actor_id(ctx),))
    return [public(row) for row in rows]


async def owned(ctx, rid):
    await ensure_schema()
    row = await db.query_one_a("SELECT * FROM review_requests WHERE id=? AND user_id=?", (rid, actor_id(ctx)))
    if not row:
        raise HttpError(404, "任务不存在")
    return row


async def acknowledge(ctx, rid):
    row = await owned(ctx, rid)
    await db.execute_a("UPDATE review_requests SET status='acknowledged',acknowledged_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=? AND status='sent'", (rid,))
    await db.execute_a("UPDATE review_notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE request_id=? AND recipient_id=?", (rid, row["user_id"]))
    return public(await owned(ctx, rid))


def score_answers(code, answers, *, version=None, encoding=None):
    from app.services.screening_assessment import score_questionnaire
    result = score_questionnaire(code, answers, version=version, encoding=encoding)
    return result['score'], result['maxScore'], result['level']


async def submit(ctx, rid):
    row = await owned(ctx, rid)
    if row["status"] in ("cancelled",):
        raise HttpError(409, "任务已取消")
    score, max_score, level = score_answers(row["questionnaire"], ctx.body.get("answers"), version=ctx.body.get("questionnaireVersion"), encoding=ctx.body.get("answerEncoding"))
    if row["status"] in ("submitted", "reviewed"):
        return public(row)
    sid = "SCR-RV-" + rid
    answers = json.dumps({**ctx.body["answers"], "_meta": {"questionnaireVersion": ctx.body.get("questionnaireVersion"), "answerEncoding": ctx.body.get("answerEncoding")}}, ensure_ascii=False, sort_keys=True)
    # Persist result, request feedback, alert and staff notifications in one transaction.
    await db.batch_a([
        ("INSERT OR IGNORE INTO screenings(screening_id,user_id,case_id,name,questionnaire_id,score,max_score,answers,status,alert_level,screening_date) "
         "SELECT ?,r.user_id,r.case_id,u.name,q.id,?,?,?,'completed',?,CURRENT_TIMESTAMP FROM review_requests r "
         "JOIN users u ON u.id=r.user_id JOIN questionnaires q ON q.code=r.questionnaire "
         "WHERE r.id=? AND r.status IN ('sent','acknowledged')",
         (sid, score, max_score, answers, level, rid)),
        ("UPDATE review_requests SET status='submitted',screening_id=?,submitted_at=CURRENT_TIMESTAMP,version=version+1 "
         "WHERE id=? AND status IN ('sent','acknowledged') AND EXISTS(SELECT 1 FROM screenings WHERE screening_id=?)", (sid, rid, sid)),
        ("INSERT OR IGNORE INTO alerts(alert_id,screening_id,user_id,name,level,trigger,status) "
         "SELECT ?,s.id,s.user_id,s.name,s.alert_level,'复查量表得分触发预警','pending' FROM screenings s "
         "JOIN review_requests r ON r.screening_id=s.screening_id WHERE r.id=? AND s.alert_level IN ('orange','red')",
         ("ALT-RV-" + rid, rid)),
        ("INSERT OR IGNORE INTO review_notifications(id,recipient_id,request_id,event_key,message) "
         "SELECT ? || ':' || u.id,u.id,r.id,r.id || ':submitted','一项复查已提交，等待工作人员复核。' "
         "FROM users u,review_requests r WHERE u.role='admin' AND u.is_active=1 AND r.id=? AND r.status='submitted'",
         (uuid.uuid4().hex, rid)),
    ])
    updated = await owned(ctx, rid)
    if updated["status"] not in ("submitted", "reviewed"):
        raise HttpError(409, "任务已被更新，请刷新")
    return public(updated)


async def staff_action(ctx, rid):
    await ensure_schema()
    row = await db.query_one_a("SELECT * FROM review_requests WHERE id=?", (rid,))
    if not row:
        raise HttpError(404, "任务不存在")
    data = ctx.body
    action = data.get("action")
    if action not in ("review", "cancel") or type(data.get("version")) is not int:
        raise HttpError(400, "操作或版本无效")
    target = "reviewed" if action == "review" else "cancelled"
    allowed = ("submitted",) if action == "review" else ("sent", "acknowledged")
    if row["status"] == target:
        return public(row)
    if row["status"] not in allowed or row["version"] != data["version"]:
        raise HttpError(409, "任务已变化，请刷新后处理")
    note = data.get("note")
    if not isinstance(note, str) or not 1 <= len(note.strip()) <= 2000:
        raise HttpError(400, "请填写内部处理记录，限2000字")
    staff = actor_id(ctx)
    placeholders = ",".join("?" for _ in allowed)
    sql, params = notification(row["user_id"], rid, target, "工作人员已查看你的复查结果。" if action == "review" else "一项复查任务已取消，请以最新任务为准。")
    await db.batch_a([
        (f"UPDATE review_requests SET status=?,review_notes=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=? AND version=? AND status IN ({placeholders})",
         (target, note.strip(), staff, rid, data["version"], *allowed)),
        (sql.replace("VALUES(?,?,?,?,?)", "SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM review_requests WHERE id=? AND status=?)"), (*params, rid, target)),
    ])
    fresh = await db.query_one_a("SELECT * FROM review_requests WHERE id=?", (rid,))
    if fresh["status"] != target or fresh["review_notes"] != note.strip() or fresh["reviewed_by"] != staff:
        raise HttpError(409, "任务已被其他人更新")
    return public(fresh)


async def notifications(ctx):
    await ensure_schema()
    uid = actor_id(ctx)
    count = await db.query_one_a("SELECT COUNT(*) AS c FROM review_notifications WHERE recipient_id=? AND read_at IS NULL", (uid,))
    items = await db.query_a("SELECT n.id,n.request_id,n.message,n.read_at,n.created_at,c.case_id AS case_code "
                             "FROM review_notifications n JOIN review_requests r ON r.id=n.request_id JOIN cases c ON c.id=r.case_id "
                             "WHERE n.recipient_id=? ORDER BY (n.read_at IS NOT NULL),n.created_at DESC,n.id DESC LIMIT 100", (uid,))
    from urllib.parse import quote
    for item in items:
        item["path"] = "/admin/cases?case=" + quote(item["case_code"]) if ctx.user.get("role") == "admin" else "/personal/reviews"
        item.pop("case_code", None)
    return {"unread": count["c"], "items": items}


async def read_notification(ctx, nid):
    await ensure_schema()
    row = await db.query_one_a("SELECT id FROM review_notifications WHERE id=? AND recipient_id=?", (nid, actor_id(ctx)))
    if not row:
        raise HttpError(404, "通知不存在")
    await db.execute_a("UPDATE review_notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE id=?", (nid,))
    return {"ok": True}
