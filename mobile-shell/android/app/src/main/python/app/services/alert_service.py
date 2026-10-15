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


# 前端词汇 ↔ 后端状态机的双向映射。
# _warning_dict（handlers/personal.py）只做了后端→前端的翻译，
# 反向一直缺着 —— 前端把 'tracking' 直接发给后端，会被状态机判成
# "无效的预警状态"400。这里补上反向，并把个人端能表达的两档限定住：
# 个人只能"跟踪中 / 已缓解"，不能设 pending、更不能设 closed（那是管理端的收尾动作）。
PERSONAL_STATUS_IN = {"new": "pending", "tracking": "processing", "resolved": "resolved"}


async def get_alert_by_code_for_user(alert_code: str, user_id: int) -> Optional[dict]:
    """按展示码取预警，并确认它确实属于该用户。

    个人端列表返回的 id 是展示码（alerts.alert_id，如 ALT-41CA2F），
    不是数据库自增主键；管理端那套 int 主键的接口个人端根本用不了。
    归属校验放在 SQL 里（JOIN screenings 限定 user_id），越权访问直接查不到，
    对外表现为 404 而不是 403 —— 不泄露"这条预警存在但不属于你"。
    """
    return await db.query_one_a(
        "SELECT a.* FROM alerts a JOIN screenings s ON a.screening_id = s.id "
        "WHERE a.alert_id = ? AND s.user_id = ?",
        (alert_code, user_id),
    )


async def update_alert_by_user(alert_code: str, user_id: int, data: dict) -> Optional[dict]:
    """个人端自助更新自己预警的状态（标记为跟踪中 / 已缓解）。

    复用管理端的 update_alert，所以状态机、审计事件（alert_events）都照旧生效，
    actor_id 记的是这个用户本人。
    """
    row = await get_alert_by_code_for_user(alert_code, user_id)
    if not row:
        return None

    allowed = {"status"}
    if set(data) - allowed:
        raise HttpError(400, "个人端只允许更新预警状态")
    incoming = str(data.get("status") or "").strip()
    if incoming not in PERSONAL_STATUS_IN:
        raise HttpError(400, "状态只能是 new / tracking / resolved")
    target = PERSONAL_STATUS_IN[incoming]
    if target == row["status"]:
        return row

    payload = {"status": target}
    # 状态机要求 pending→processing→resolved 逐级流转，且解决时必须填处理记录。
    # 个人端只点一个按钮、没有填写入口，所以这里代填一条**明确署名为自助**的记录：
    # 既满足不变量，又不会让管理端误以为有人写过实质跟进内容。
    if target == "resolved":
        payload["follow_up_notes"] = "用户自助标记：已缓解"
    return await update_alert(row["id"], payload, actor_id=user_id)
