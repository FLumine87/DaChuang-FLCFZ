"""预警业务服务（原生 SQL，替代 SQLAlchemy ORM）。"""
from datetime import datetime
from typing import Optional
import uuid

from app.db import database as db


def generate_alert_id() -> str:
    return f"ALT-{uuid.uuid4().hex[:6].upper()}"


def get_all_rules() -> list:
    return db.query("SELECT * FROM alert_rules ORDER BY priority DESC")


def create_rule(data: dict) -> dict:
    row_id = db.execute(
        "INSERT INTO alert_rules (name, questionnaire_id, min_score, max_score, alert_level, "
        "description, is_active, priority) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
        (data.get("name"), data.get("questionnaire_id"), data.get("min_score"),
         data.get("max_score"), data.get("alert_level"), data.get("description"),
         data.get("priority", 0)),
    )
    return db.query_one("SELECT * FROM alert_rules WHERE id = ?", (row_id,))


def update_rule(rule_id: int, data: dict) -> Optional[dict]:
    row = db.query_one("SELECT * FROM alert_rules WHERE id = ?", (rule_id,))
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
        db.execute(
            "UPDATE alert_rules SET " + ", ".join(sets) + ", updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            params,
        )
    return db.query_one("SELECT * FROM alert_rules WHERE id = ?", (rule_id,))


def delete_rule(rule_id: int) -> bool:
    row = db.query_one("SELECT * FROM alert_rules WHERE id = ?", (rule_id,))
    if not row:
        return False
    db.execute("DELETE FROM alert_rules WHERE id = ?", (rule_id,))
    return True


def get_stats() -> dict:
    def count(where="", params=()):
        return db.query_one(
            "SELECT COUNT(*) AS c FROM alerts" + (" WHERE " + where if where else ""), params
        )["c"]

    return {
        "total": count(),
        "pending": count("status = 'pending'"),
        "processing": count("status = 'processing'"),
        "resolved": count("status = 'resolved'"),
        "closed": count("status = 'closed'"),
        "by_level": {
            "green": count("level = 'green'"),
            "yellow": count("level = 'yellow'"),
            "orange": count("level = 'orange'"),
            "red": count("level = 'red'"),
        },
    }


def get_alerts(page: int = 1, page_size: int = 10, level: Optional[str] = None,
               status: Optional[str] = None) -> dict:
    where, params = [], []
    if level:
        where.append("a.level = ?")
        params.append(level)
    if status:
        where.append("a.status = ?")
        params.append(status)

    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    total = db.query_one(
        "SELECT COUNT(*) AS c FROM alerts a" + where_sql, params
    )["c"]

    offset = (page - 1) * page_size
    rows = db.query(
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


def get_alert_by_id(alert_id: int) -> Optional[dict]:
    return db.query_one(
        "SELECT a.*, u.name AS assignee_name FROM alerts a "
        "LEFT JOIN users u ON a.assignee_id = u.id WHERE a.id = ?",
        (alert_id,),
    )


def create_alert(data: dict) -> dict:
    alert_id = generate_alert_id()
    row_id = db.execute(
        "INSERT INTO alerts (alert_id, screening_id, name, level, trigger, description, "
        "status, assignee_id, follow_up_notes, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, CURRENT_TIMESTAMP)",
        (
            alert_id, data.get("screening_id"), data.get("name"), data.get("level", "green"),
            data.get("trigger"), data.get("description"), data.get("assignee_id"),
            data.get("follow_up_notes"),
        ),
    )
    return db.query_one("SELECT * FROM alerts WHERE id = ?", (row_id,))


def update_alert(alert_id: int, data: dict) -> Optional[dict]:
    row = get_alert_by_id(alert_id)
    if not row:
        return None
    allowed = ("screening_id", "name", "level", "trigger", "description",
               "status", "assignee_id", "follow_up_notes")
    sets, params = [], []
    for k in allowed:
        if k in data and data[k] is not None:
            sets.append(f"{k} = ?")
            params.append(data[k])
    if sets:
        params.append(alert_id)
        db.execute(
            "UPDATE alerts SET " + ", ".join(sets) + ", updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            params,
        )
    return get_alert_by_id(alert_id)


def resolve_alert(alert_id: int, notes: str = "") -> Optional[dict]:
    row = get_alert_by_id(alert_id)
    if not row:
        return None
    db.execute(
        "UPDATE alerts SET status = 'resolved', follow_up_notes = ?, resolved_at = ?, "
        "updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (notes, datetime.now(), alert_id),
    )
    return get_alert_by_id(alert_id)
