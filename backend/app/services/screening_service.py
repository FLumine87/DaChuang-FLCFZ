"""筛查业务服务（原生 SQL，替代 SQLAlchemy ORM）。"""
from datetime import datetime, timedelta
from typing import Optional
import uuid

from app.db import database as db


def generate_screening_id() -> str:
    return f"SCR-{uuid.uuid4().hex[:6].upper()}"


def get_all_questionnaires() -> list:
    return db.query(
        "SELECT * FROM questionnaires WHERE is_active = 1 ORDER BY id"
    )


def create_questionnaire(data: dict) -> dict:
    row_id = db.execute(
        "INSERT INTO questionnaires (code, name, description, max_score, questions, scoring_rules, is_active) "
        "VALUES (?, ?, ?, ?, ?, ?, 1)",
        (data.get("code"), data.get("name"), data.get("description"),
         data.get("max_score", 0), data.get("questions"), data.get("scoring_rules")),
    )
    return db.query_one("SELECT * FROM questionnaires WHERE id = ?", (row_id,))


def get_screenings(page: int = 1, page_size: int = 10, status: Optional[str] = None,
                   alert_level: Optional[str] = None, questionnaire_id: Optional[int] = None,
                   keyword: Optional[str] = None) -> dict:
    where, params = [], []
    if status:
        where.append("s.status = ?")
        params.append(status)
    if alert_level:
        where.append("s.alert_level = ?")
        params.append(alert_level)
    if questionnaire_id:
        where.append("s.questionnaire_id = ?")
        params.append(questionnaire_id)
    if keyword:
        where.append("s.name LIKE ?")
        params.append(f"%{keyword}%")

    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    base = (
        "SELECT s.*, q.name AS questionnaire_name, u.name AS counselor_name "
        "FROM screenings s "
        "LEFT JOIN questionnaires q ON s.questionnaire_id = q.id "
        "LEFT JOIN users u ON s.counselor_id = u.id"
    )
    total = db.query_one(
        "SELECT COUNT(*) AS c FROM screenings s" + where_sql, params
    )["c"]

    offset = (page - 1) * page_size
    rows = db.query(
        base + where_sql + " ORDER BY s.created_at DESC LIMIT ? OFFSET ?",
        params + [page_size, offset],
    )
    items = []
    for r in rows:
        items.append(_screening_to_dict(r))
    return {"items": items, "total": total}


def _screening_to_dict(r: dict) -> dict:
    def fmt(v):
        return v.strftime("%Y-%m-%d") if hasattr(v, "strftime") and v else (v or None)
    return {
        "id": r.get("id"),
        "screening_id": r.get("screening_id"),
        "name": r.get("name"),
        "age": r.get("age"),
        "gender": r.get("gender"),
        "questionnaire_name": r.get("questionnaire_name"),
        "score": r.get("score"),
        "max_score": r.get("max_score"),
        "status": r.get("status"),
        "alert_level": r.get("alert_level"),
        "screening_date": fmt(r.get("screening_date")),
        "created_at": r.get("created_at"),
        "counselor_name": r.get("counselor_name"),
    }


def get_screening_by_id(screening_id: int) -> Optional[dict]:
    return db.query_one(
        "SELECT s.*, q.name AS questionnaire_name FROM screenings s "
        "LEFT JOIN questionnaires q ON s.questionnaire_id = q.id WHERE s.id = ?",
        (screening_id,),
    )


def create_screening(data: dict) -> dict:
    screening_id = generate_screening_id()
    q = db.query_one("SELECT * FROM questionnaires WHERE id = ?", (data.get("questionnaire_id"),))
    max_score = q["max_score"] if q else data.get("max_score", 100)
    row_id = db.execute(
        "INSERT INTO screenings (screening_id, name, age, gender, department, phone, "
        "questionnaire_id, score, max_score, answers, status, alert_level, counselor_id, notes, screening_date) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            screening_id, data.get("name", "匿名用户"), data.get("age"), data.get("gender"),
            data.get("department"), data.get("phone"), data.get("questionnaire_id"),
            data.get("score", 0), max_score, data.get("answers"),
            data.get("status", "pending"), data.get("alert_level", "green"),
            data.get("counselor_id"), data.get("notes"),
            data.get("screening_date") or datetime.now(),
        ),
    )
    row = db.query_one("SELECT * FROM screenings WHERE id = ?", (row_id,))
    # 方案 1：新建筛查后增量写入哈希索引（Worker 下引擎为 Mock，幂等无副作用）
    _index_into_hashing({
        "id": f"scr-{row['id']}",
        "summary": f"{row['name']}。{row['answers'] or ''} {row['notes'] or ''}",
        "alert_level": row["alert_level"],
        "modality": "text",
        "date": row["created_at"].date().isoformat() if row["created_at"] else "",
    })
    return row


def update_screening(screening_id: int, data: dict) -> Optional[dict]:
    row = get_screening_by_id(screening_id)
    if not row:
        return None
    allowed = ("name", "age", "gender", "department", "phone", "score", "max_score",
               "answers", "status", "alert_level", "counselor_id", "notes", "screening_date")
    sets, params = [], []
    for k in allowed:
        if k in data and data[k] is not None:
            sets.append(f"{k} = ?")
            params.append(data[k])
    if sets:
        params.append(screening_id)
        db.execute(
            "UPDATE screenings SET " + ", ".join(sets) + ", updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            params,
        )
    return get_screening_by_id(screening_id)


def delete_screening(screening_id: int) -> bool:
    row = get_screening_by_id(screening_id)
    if not row:
        return False
    db.execute("DELETE FROM screenings WHERE id = ?", (screening_id,))
    return True


def complete_screening(screening_id: int, score: int) -> Optional[dict]:
    row = get_screening_by_id(screening_id)
    if not row:
        return None
    alert_level = _calculate_alert_level(row["questionnaire_id"], score)
    db.execute(
        "UPDATE screenings SET score = ?, status = 'completed', alert_level = ?, "
        "screening_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (score, alert_level, datetime.now(), screening_id),
    )
    row = get_screening_by_id(screening_id)
    _create_alert_if_needed(row)
    # 方案 1：完成筛查（预警级别可能变化）后更新索引
    _index_into_hashing({
        "id": f"scr-{row['id']}",
        "summary": f"{row['name']}。{row['answers'] or ''} {row['notes'] or ''}",
        "alert_level": row["alert_level"],
        "modality": "text",
        "date": row["created_at"].date().isoformat() if row["created_at"] else "",
    })
    return row


def _calculate_alert_level(questionnaire_id: int, score: int) -> str:
    rules = db.query(
        "SELECT * FROM alert_rules WHERE questionnaire_id = ? AND is_active = 1 "
        "ORDER BY priority DESC",
        (questionnaire_id,),
    )
    for rule in rules:
        min_score = rule.get("min_score") or 0
        max_score = rule.get("max_score")
        if min_score <= score <= (max_score if max_score is not None else float("inf")):
            return rule["alert_level"]
    if score >= 80:
        return "red"
    elif score >= 60:
        return "orange"
    elif score >= 40:
        return "yellow"
    return "green"


def _create_alert_if_needed(screening: dict) -> None:
    if screening.get("alert_level") not in ("orange", "red"):
        return
    alert_id = f"ALT-{uuid.uuid4().hex[:6].upper()}"
    trigger = (
        f"{screening.get('questionnaire_name') or '量表'} 得分 {screening.get('score')}"
    )
    alert_row_id = db.execute(
        "INSERT INTO alerts (alert_id, screening_id, name, level, trigger, description, status, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)",
        (
            alert_id, screening["id"], screening["name"], screening["alert_level"],
            trigger, f"筛查得分触发{screening['alert_level']}级预警",
        ),
    )
    # 方案 1：把新触发的预警也增量写入哈希索引
    alert = db.query_one("SELECT * FROM alerts WHERE id = ?", (alert_row_id,))
    if alert:
        _index_into_hashing({
            "id": f"alt-{alert['id']}",
            "summary": f"{alert['name']}。{alert['trigger'] or ''} {alert['description'] or ''}",
            "alert_level": alert["level"],
            "modality": "text",
            "date": alert["created_at"].date().isoformat() if alert["created_at"] else "",
        })


def _index_into_hashing(case_data: dict) -> None:
    """把一条记录增量写入哈希检索引擎（失败不影响主流程；Worker 下引擎为 Mock）。"""
    try:
        from app.engines import get_hashing_engine
        get_hashing_engine().index_case_sync(case_data)
    except Exception:
        pass
