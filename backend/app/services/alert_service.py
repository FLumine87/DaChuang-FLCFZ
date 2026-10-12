"""预警业务服务（原生 SQL，替代 SQLAlchemy ORM）。"""
from datetime import datetime
from typing import Optional
import uuid

from app.db import database as db
from app.core.exceptions import HttpError


async def generate_alert_id() -> str:
    return f"ALT-{uuid.uuid4().hex[:6].upper()}"


async def get_all_rules() -> list:
    return await db.query_a("SELECT * FROM alert_rules ORDER BY priority DESC")


async def create_rule(data: dict) -> dict:
    row_id = await db.execute_a(
        "INSERT INTO alert_rules (name, questionnaire_id, min_score, max_score, alert_level, "
        "description, is_active, priority) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
        (data.get("name"), data.get("questionnaire_id"), data.get("min_score"),
         data.get("max_score"), data.get("alert_level"), data.get("description"),
         data.get("priority", 0)),
    )
    return await db.query_one_a("SELECT * FROM alert_rules WHERE id = ?", (row_id,))


async def update_rule(rule_id: int, data: dict) -> Optional[dict]:
    row = await db.query_one_a("SELECT * FROM alert_rules WHERE id = ?", (rule_id,))
    if not row:
        return None
    allowed = ("name", "questionnaire_id", "min_score", "max_score",
               "alert_level", "description", "is_active", "priority")
    sets, params = [], []
    for k in allowed:
        if k in data and data[k] is not None:
            sets.append(f"{k} = ?")
            params.append(data[k])
    if sets:
        params.append(rule_id)
        await db.execute_a(
            "UPDATE alert_rules SET " + ", ".join(sets) + ", updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            params,
        )
    return await db.query_one_a("SELECT * FROM alert_rules WHERE id = ?", (rule_id,))


async def delete_rule(rule_id: int) -> bool:
    row = await db.query_one_a("SELECT * FROM alert_rules WHERE id = ?", (rule_id,))
    if not row:
        return False
    await db.execute_a("DELETE FROM alert_rules WHERE id = ?", (rule_id,))
    return True


async def get_stats() -> dict:
    async def count(where="", params=()):
        row = await db.query_one_a(
            "SELECT COUNT(*) AS c FROM alerts" + (" WHERE " + where if where else ""), params
        )
        return row["c"] if row else 0

    return {
        "total": await count(),
        "pending": await count("status = 'pending'"),
        "processing": await count("status = 'processing'"),
        "resolved": await count("status = 'resolved'"),
        "closed": await count("status = 'closed'"),
        "by_level": {
            "green": await count("level = 'green'"),
            "yellow": await count("level = 'yellow'"),
            "orange": await count("level = 'orange'"),
            "red": await count("level = 'red'"),
        },
    }


async def get_alerts(page: int = 1, page_size: int = 10, level: Optional[str] = None,
               status: Optional[str] = None) -> dict:
    where, params = [], []
    if level:
        where.append("a.level = ?")
        params.append(level)
    if status:
        where.append("a.status = ?")
        params.append(status)

    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    total = await db.query_one_a(
        "SELECT COUNT(*) AS c FROM alerts a" + where_sql, params
    )["c"]

    offset = (page - 1) * page_size
    rows = await db.query_a(
        "SELECT a.*, u.name AS assignee_name FROM alerts a "
        "LEFT JOIN users u ON a.assignee_id = u.id"
        + where_sql + " ORDER BY a.created_at DESC LIMIT ? OFFSET ?",
        params + [page_size, offset],
    )
    items = []
    for r in rows:
        items.append({
            "id": r.get("id"),
            "alert_id": r.get("alert_id"),
            "screening_id": r.get("screening_id"),
            "name": r.get("name"),
            "level": r.get("level"),
            "trigger": r.get("trigger"),
            "status": r.get("status"),
            "assignee_name": r.get("assignee_name"),
            "created_at": r.get("created_at"),
        })
    return {"items": items, "total": total}


async def get_alert_by_id(alert_id: int) -> Optional[dict]:
    return await db.query_one_a(
        "SELECT a.*, u.name AS assignee_name FROM alerts a "
        "LEFT JOIN users u ON a.assignee_id = u.id WHERE a.id = ?",
        (alert_id,),
    )


async def create_alert(data: dict) -> dict:
    alert_id = await generate_alert_id()
    row_id = await db.execute_a(
        "INSERT INTO alerts (alert_id, screening_id, name, level, trigger, description, "
        "status, assignee_id, follow_up_notes, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, CURRENT_TIMESTAMP)",
        (
            alert_id, data.get("screening_id"), data.get("name"), data.get("level", "green"),
            data.get("trigger"), data.get("description"), data.get("assignee_id"),
            data.get("follow_up_notes"),
        ),
    )
    return await db.query_one_a("SELECT * FROM alerts WHERE id = ?", (row_id,))


async def update_alert(alert_id: int, data: dict, actor_id: int = None) -> Optional[dict]:
    row = await get_alert_by_id(alert_id)
    if not row:
        return None
    allowed = {"status", "assignee_id", "follow_up_notes"}
    if set(data) - allowed:
        raise HttpError(400, "只允许更新处理状态、处理人和跟进备注")
    status = data.get("status", row["status"])
    transitions = {
        "pending": {"processing"}, "processing": {"resolved"},
        "resolved": {"closed"}, "closed": set(),
    }
    if status not in transitions:
        raise HttpError(400, "无效的预警状态")
    if status != row["status"] and status not in transitions.get(row["status"], set()):
        raise HttpError(409, "预警状态只能按待处理、处理中、已解决、已关闭顺序流转")
    note = str(data.get("follow_up_notes") or "").strip()
    if status == "resolved" and row["status"] != "resolved" and not note:
        raise HttpError(400, "解决预警时需要填写处理记录")
    assignee_id = row["assignee_id"]
    if "assignee_id" in data:
        assignee_id = data["assignee_id"]
        if assignee_id is not None:
            try:
                assignee_id = int(assignee_id)
            except (TypeError, ValueError):
                raise HttpError(400, "处理人无效")
            assignee = await db.query_one_a(
                "SELECT id FROM users WHERE id = ? AND is_active = 1 "
                "AND role IN ('admin', 'counselor')", (assignee_id,))
            if not assignee:
                raise HttpError(400, "处理人不存在或不可用")
    changed = status != row["status"] or assignee_id != row["assignee_id"] or bool(note)
    if not changed:
        return row
    follow_up = row.get("follow_up_notes") or ""
    if note:
        follow_up = (follow_up + "\n" + note).strip()
    await db.execute_a(
        "UPDATE alerts SET status = ?, assignee_id = ?, follow_up_notes = ?, "
        "resolved_at = CASE WHEN ? = 'resolved' THEN CURRENT_TIMESTAMP ELSE resolved_at END, "
        "updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (status, assignee_id, follow_up, status, alert_id),
    )
    if actor_id is not None:
        await db.execute_a(
            "INSERT INTO alert_events (alert_id, actor_id, from_status, to_status, note) "
            "VALUES (?, ?, ?, ?, ?)",
            (alert_id, actor_id, row["status"], status, note or None),
        )
    return await get_alert_by_id(alert_id)


async def resolve_alert(alert_id: int, notes: str = "", actor_id: int = None) -> Optional[dict]:
    return await update_alert(alert_id, {"status": "resolved", "follow_up_notes": notes}, actor_id)
