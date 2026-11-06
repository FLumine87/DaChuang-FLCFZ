"""Shared, read-only case ownership and evidence for admin and agent views."""
import hashlib
import json

from app.db import database as db


async def load(case):
    user_id = case.get("user_id")
    owners = await db.query_one_a("SELECT COUNT(*) AS c FROM cases WHERE user_id = ?", (user_id,)) if user_id else None
    unique = bool(owners and owners["c"] == 1)
    selection = ("WHERE (s.case_id=? AND (s.user_id IS NULL OR ? IS NULL OR s.user_id=?)) "
                 "OR (s.case_id IS NULL AND s.user_id=? AND ?=1)")
    params = [case["id"], user_id, user_id, user_id, int(unique)]
    # Explicit links win. Account fallback is allowed only for an unambiguous case.
    screenings = await db.query_a(
        "SELECT s.*, q.name AS questionnaire FROM screenings s "
        "LEFT JOIN questionnaires q ON q.id=s.questionnaire_id "
        + selection + " ORDER BY s.created_at DESC,s.id DESC", params)
    alerts = await db.query_a(
        f"SELECT a.* FROM alerts a WHERE (a.screening_id IN (SELECT s.id FROM screenings s {selection}) "
        "AND (a.user_id IS NULL OR ? IS NULL OR a.user_id=?)) "
        "OR (a.screening_id IS NULL AND a.user_id=? AND ?=1) ORDER BY a.created_at DESC,a.id DESC",
        params + [user_id, user_id, user_id, int(unique)])
    supplements = await db.query_a(
        f"SELECT * FROM screening_supplements WHERE (screening_id IN (SELECT s.screening_id FROM screenings s {selection}) AND (user_id IS NULL OR ? IS NULL OR user_id=?)) "
        "OR (screening_id IS NULL AND user_id=? AND ?=1) ORDER BY created_at DESC,id DESC",
        params + [user_id, user_id, user_id, int(unique)])
    return {"screenings": screenings, "alerts": alerts, "supplements": supplements,
            "ambiguous": bool(user_id and not unique)}


async def snapshot(subject):
    if subject.startswith("screening:"):
        rows = await db.query_a("SELECT s.*,q.name AS questionnaire FROM screenings s "
                                "LEFT JOIN questionnaires q ON s.questionnaire_id=q.id WHERE s.id=?", (subject[10:],))
        supplements = await db.query_a("SELECT * FROM screening_supplements WHERE screening_id=?",
                                       (rows[0]["screening_id"],)) if rows else []
        context = {"screenings": rows, "supplements": supplements}
        return fingerprint(context)
    if subject.startswith("case:"):
        case = await db.query_one_a("SELECT * FROM cases WHERE id=?", (subject[5:],))
    else:
        case = await db.query_one_a("SELECT * FROM cases WHERE case_id=?", (subject,))
    if not case:
        return {}
    context = await load(case)
    return fingerprint(context)


def fingerprint(context):
    # Store hashes only; do not copy sensitive materials into each report snapshot.
    return {f"{kind}:{row['id']}": hashlib.sha256(
        json.dumps(row, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()
        for kind in ("screenings", "supplements") for row in context[kind]}


async def assessment_state(subject):
    table = await db.query_one_a("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_workspace_case_runs'")
    if not table:
        return {"status": "none", "newRecords": 0, "changedRecords": 0}
    row = await db.query_one_a(
        "SELECT payload,created_at FROM agent_workspace_case_runs WHERE scope='live' AND subject=? "
        "ORDER BY created_at DESC,id DESC LIMIT 1", (subject,))
    if not row:
        return {"status": "none", "newRecords": 0, "changedRecords": 0}
    report = json.loads(row["payload"])
    previous = report.get("evidence_snapshot")
    if previous is None:
        return {"status": "unknown", "createdAt": row["created_at"], "newRecords": 0, "changedRecords": 0}
    current = await snapshot(subject)
    new = len(current.keys() - previous.keys())
    changed = sum(previous[key] != current[key] for key in current.keys() & previous.keys())
    removed = len(previous.keys() - current.keys())
    return {"status": "outdated" if new or changed or removed else "current",
            "createdAt": row["created_at"], "newRecords": new,
            "changedRecords": changed, "removedRecords": removed}
