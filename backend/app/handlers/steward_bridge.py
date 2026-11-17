"""Private, signed bridge for the personal AI service; never a browser API."""
import hashlib
import hmac
import json
import os
import time

from app.core.exceptions import HttpError
from app.db import database as db
from app.core import runtime


def setting(name):
    return str(runtime.get_binding(name) or '') if runtime.is_worker() else os.environ.get(name,'')


SCHEMA = """
CREATE TABLE IF NOT EXISTS steward_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
 kind TEXT NOT NULL, source_id INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_steward_events_user ON steward_events(user_id,id);
CREATE TABLE IF NOT EXISTS steward_plan_feedback (
 plan_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, value TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '', updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
"""
for table, kind in (("screenings", "scale"), ("screening_supplements", "multimodal"), ("action_plans", "plan")):
    for operation in ("INSERT", "UPDATE", "DELETE"):
        ref = "OLD" if operation == "DELETE" else "NEW"
        SCHEMA += f"""
DROP TRIGGER IF EXISTS steward_{table}_{operation.lower()};
CREATE TRIGGER IF NOT EXISTS steward_{table}_{operation.lower()}_v2 AFTER {operation} ON {table}
WHEN {ref}.user_id IS NOT NULL
BEGIN INSERT INTO steward_events(user_id,kind,source_id) VALUES ({ref}.user_id,'{kind}',{ref}.id); END;
"""


def authorize(ctx):
    secret = setting('STEWARD_SYNC_SECRET')
    stamp = ctx.headers.get("x-steward-time", "")
    try:
        fresh = abs(time.time() - int(stamp)) < 60
    except ValueError:
        fresh = False
    message = f"{stamp}\n{ctx.method}\n{ctx.path}\n{json.dumps(ctx.query, sort_keys=True, separators=(',', ':'))}\n".encode() + ctx._body_bytes
    expected = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    if not secret or not fresh or not hmac.compare_digest(expected, ctx.headers.get("x-steward-signature", "")):
        raise HttpError(403, "内部服务身份校验失败")


async def context(ctx):
    authorize(ctx)
    uid = str(ctx.query.get("user_id", ""))
    user = await db.query_one_a("SELECT id, username FROM users WHERE id=? AND role='user'", (uid,))
    if not user:
        raise HttpError(404, "个人账号不存在")
    version = await db.query_one_a("SELECT COALESCE(MAX(id),0) AS version FROM steward_events WHERE user_id=?", (uid,))
    result = {"user_id": str(user["id"]), "username": user["username"], "version": version["version"]}
    if str(ctx.query.get("after", "")) == str(result["version"]):
        return result
    result["scales"] = await db.query_a(
        "SELECT s.*,q.code AS scale,q.name AS scale_name FROM screenings s LEFT JOIN questionnaires q ON q.id=s.questionnaire_id WHERE s.user_id=? AND s.status='completed' ORDER BY s.id", (uid,))
    result["multimodal"] = await db.query_a("SELECT id,kind,text,description,filename,analysis,created_at FROM screening_supplements WHERE user_id=? ORDER BY id", (uid,))
    result["plans"] = await db.query_a("SELECT p.*, f.value AS feedback,f.note AS feedback_note,f.updated_at AS feedback_at FROM action_plans p LEFT JOIN steward_plan_feedback f ON f.plan_id=p.id AND f.user_id=p.user_id WHERE p.user_id=? ORDER BY p.id", (uid,))
    return result


async def plan(ctx):
    authorize(ctx)
    data = ctx.body
    uid, key = str(data.get("user_id", "")), str(data.get("suggestion_id", ""))
    if not key or len(key) > 100 or not await db.query_one_a("SELECT id FROM users WHERE id=? AND role='user'", (uid,)):
        raise HttpError(400, "计划参数无效")
    rule = "steward:" + key
    await db.execute_a("INSERT INTO action_plans(user_id,title,detail,source,rule_key,status) SELECT ?,?,?, 'user',?,'pending' WHERE NOT EXISTS (SELECT 1 FROM action_plans WHERE user_id=? AND rule_key=?)",
                       (uid, str(data.get("title", ""))[:200], str(data.get("detail", ""))[:2000], rule, uid, rule))
    return await db.query_one_a("SELECT id,status FROM action_plans WHERE user_id=? AND rule_key=?", (uid, rule))


async def feedback(ctx):
    uid = str(ctx.user["sub"])
    pid, value = ctx.body.get("plan_id"), ctx.body.get("value")
    if value not in ("helpful", "neutral", "unhelpful"):
        raise HttpError(400, "请选择实际感受")
    if not await db.query_one_a("SELECT id FROM action_plans WHERE id=? AND user_id=?", (pid, uid)):
        raise HttpError(404, "计划不存在")
    await db.batch_a([
        ("INSERT INTO steward_plan_feedback(plan_id,user_id,value,note) VALUES (?,?,?,?) ON CONFLICT(plan_id) DO UPDATE SET value=excluded.value,note=excluded.note,updated_at=CURRENT_TIMESTAMP", (pid, uid, value, str(ctx.body.get("note", ""))[:500])),
        ("INSERT INTO steward_events(user_id,kind,source_id) VALUES (?,'feedback',?)", (uid, pid)),
    ])
    return {"saved": True}
