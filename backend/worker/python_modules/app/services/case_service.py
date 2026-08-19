"""案例业务服务（原生 SQL，替代 SQLAlchemy ORM）。"""
from typing import Optional
import uuid

from app.db import database as db


def generate_case_id() -> str:
    return f"CASE-{uuid.uuid4().hex[:6].upper()}"


def get_all_tags() -> list:
    return db.query("SELECT * FROM case_tag_master ORDER BY id")


def create_tag(data: dict) -> dict:
    row_id = db.execute(
        "INSERT INTO case_tag_master (name, color, description) VALUES (?, ?, ?)",
        (data.get("name"), data.get("color", "#3b82f6"), data.get("description")),
    )
    return db.query_one("SELECT * FROM case_tag_master WHERE id = ?", (row_id,))


def get_cases(page: int = 1, page_size: int = 10, alert_level: Optional[str] = None,
              status: Optional[str] = None, keyword: Optional[str] = None) -> dict:
    where, params = [], []
    if alert_level:
        where.append("c.alert_level = ?")
        params.append(alert_level)
    if status:
        where.append("c.status = ?")
        params.append(status)
    if keyword:
        where.append("c.name LIKE ?")
        params.append(f"%{keyword}%")

    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    total = db.query_one(
        "SELECT COUNT(*) AS c FROM cases c" + where_sql, params
    )["c"]

    offset = (page - 1) * page_size
    rows = db.query(
        "SELECT * FROM cases c" + where_sql + " ORDER BY c.updated_at DESC LIMIT ? OFFSET ?",
        params + [page_size, offset],
    )
    items = [_case_to_dict(r) for r in rows]
    return {"items": items, "total": total}


def _fmt_date(v):
    return v.strftime("%Y-%m-%d") if hasattr(v, "strftime") and v else (v or None)


def _case_to_dict(r: dict) -> dict:
    tags = [t["name"] for t in db.query(
        "SELECT t.name FROM case_tags_association a JOIN case_tag_master t ON a.tag_id = t.id "
        "WHERE a.case_id = ?", (r["id"],))]
    return {
        "id": r.get("id"),
        "case_id": r.get("case_id"),
        "name": r.get("name"),
        "age": r.get("age"),
        "gender": r.get("gender"),
        "department": r.get("department"),
        "alert_level": r.get("alert_level"),
        "status": r.get("status"),
        "screening_count": r.get("screening_count"),
        "last_screening": _fmt_date(r.get("last_screening_date")),
        "tags": tags,
        "notes": r.get("notes"),
    }


def get_case_by_id(case_id: int) -> Optional[dict]:
    row = db.query_one("SELECT * FROM cases WHERE id = ?", (case_id,))
    if not row:
        return None
    return _case_to_dict(row)


def create_case(data: dict) -> dict:
    case_id = generate_case_id()
    row_id = db.execute(
        "INSERT INTO cases (case_id, name, age, gender, department, phone, id_number, "
        "alert_level, status, counselor_id, notes, screening_count, last_screening_date, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, 'green', 'active', ?, ?, ?, ?, CURRENT_TIMESTAMP)",
        (
            case_id, data.get("name"), data.get("age"), data.get("gender"),
            data.get("department"), data.get("phone"), data.get("id_number"),
            data.get("counselor_id"), data.get("notes"), data.get("screening_count", 0),
            data.get("last_screening_date"),
        ),
    )
    row = db.query_one("SELECT * FROM cases WHERE id = ?", (row_id,))
    _set_case_tags(row_id, data.get("tags"))
    # 方案 1：新建案例后增量写入哈希索引
    try:
        from app.engines import get_hashing_engine
        tags = [t["name"] for t in db.query(
            "SELECT t.name FROM case_tags_association a JOIN case_tag_master t ON a.tag_id = t.id "
            "WHERE a.case_id = ?", (row_id,))]
        get_hashing_engine().index_case_sync({
            "id": f"case-{row['id']}",
            "summary": f"{row['name']}。{row['notes'] or ''}",
            "tags": tags,
            "alert_level": row["alert_level"],
            "modality": "text",
            "date": row["created_at"].date().isoformat() if row["created_at"] else "",
        })
    except Exception:
        pass
    return get_case_by_id(row_id)


def update_case(case_id: int, data: dict) -> Optional[dict]:
    row = db.query_one("SELECT * FROM cases WHERE id = ?", (case_id,))
    if not row:
        return None
    allowed = ("name", "age", "gender", "department", "phone", "id_number", "alert_level",
               "status", "counselor_id", "notes", "screening_count", "last_screening_date")
    sets, params = [], []
    for k in allowed:
        if k in data and data[k] is not None:
            sets.append(f"{k} = ?")
            params.append(data[k])
    if sets:
        params.append(case_id)
        db.execute(
            "UPDATE cases SET " + ", ".join(sets) + ", updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            params,
        )
    if data.get("tags") is not None:
        _set_case_tags(case_id, data["tags"])
    return get_case_by_id(case_id)


def delete_case(case_id: int) -> bool:
    row = db.query_one("SELECT * FROM cases WHERE id = ?", (case_id,))
    if not row:
        return False
    db.execute("DELETE FROM case_tags_association WHERE case_id = ?", (case_id,))
    db.execute("DELETE FROM case_timeline WHERE case_id = ?", (case_id,))
    db.execute("DELETE FROM cases WHERE id = ?", (case_id,))
    return True


def _set_case_tags(case_id: int, tags) -> None:
    """按标签名列表设置案例标签（先清空再按名称匹配插入）。"""
    if tags is None:
        return
    db.execute("DELETE FROM case_tags_association WHERE case_id = ?", (case_id,))
    for name in tags:
        tag = db.query_one("SELECT * FROM case_tag_master WHERE name = ?", (name,))
        if tag:
            db.execute(
                "INSERT INTO case_tags_association (case_id, tag_id) VALUES (?, ?)",
                (case_id, tag["id"]),
            )


def get_timeline(case_id: int) -> list:
    return db.query(
        "SELECT * FROM case_timeline WHERE case_id = ? ORDER BY event_date DESC, id DESC",
        (case_id,),
    )


def add_timeline_event(case_id: int, data: dict) -> dict:
    row_id = db.execute(
        "INSERT INTO case_timeline (case_id, event_type, title, description, event_date, created_at) "
        "VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
        (case_id, data.get("event_type"), data.get("title"), data.get("description"),
         data.get("event_date")),
    )
    return db.query_one("SELECT * FROM case_timeline WHERE id = ?", (row_id,))
