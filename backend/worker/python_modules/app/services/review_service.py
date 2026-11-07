"""数据审核服务：新数据入池的闸门。

设计要点
--------
写入即可检索，审核通过才进训练池。两者分开：

1. 新数据落索引时 scope = reviewing，本人可检索、他人不可见，不参与训练。
2. 管理员审核通过 → scope = public，进入公共池，同时写入训练队列。
3. 审核拒绝 → scope = rejected，保留记录供审计，检索与训练都排除。

审核记录写入业务表（screenings / screening_supplements）的 review_* 字段，
索引侧只维护 scope，两边通过 record_id 关联。
"""
from typing import Dict, List, Optional

from app.config import settings
from app.db import database as db
from app.engines import get_hashing_engine

VALID_SCOPES = ("reviewing", "public", "private", "rejected")


def _supports_review(engine) -> bool:
    """Mock 引擎（Worker 降级）没有索引存储，审核接口需明确拒绝而不是 500。"""
    return all(hasattr(engine, attr) for attr in ("_store", "units", "records"))


def _units_by_record(engine) -> Dict[str, List[Dict]]:
    """一次遍历把单元按 record_id 分组，避免逐条扫描全库。"""
    by_rec: Dict[str, List[Dict]] = {}
    for _uid, meta in engine.units.items():
        by_rec.setdefault(meta.get("record_id") or "", []).append(meta)
    return by_rec


async def pending_list(limit: int = 50, offset: int = 0,
                       keyword: str = "") -> Dict:
    """待审列表：索引里 scope=reviewing 的记录。"""
    engine = get_hashing_engine()
    await engine._ensure_initialized()
    if not _supports_review(engine):
        return {"total": 0, "items": [], "limit": limit, "offset": offset,
                "supported": False, "reason": "当前运行环境不支持数据审核（检索引擎为降级实现）"}
    by_rec = _units_by_record(engine)

    rows = []
    for rid, rec in engine.records.items():
        if (rec.get("scope") or "public") != "reviewing":
            continue
        units = by_rec.get(rid) or []
        if not units:
            continue
        text = (units[0].get("content") or "")[:120]
        if keyword and keyword not in text and keyword not in rid:
            continue
        rows.append({
            "record_id": rid,
            "user_id": rec.get("user_id"),
            "date": rec.get("date") or "",
            "window": rec.get("window"),
            "alert_level": rec.get("alert_level") or "green",
            "tags": rec.get("tags") or [],
            "summary": text,
            "modalities": sorted({u.get("modality") or "text" for u in units}),
            "review_status": "pending",
        })
    rows.sort(key=lambda r: (r.get("date") or "", r.get("record_id") or ""), reverse=True)
    total = len(rows)
    page = rows[offset: offset + max(1, limit)]
    return {"total": total, "items": page, "limit": limit, "offset": offset}


async def _sync_business_table(record_id: str, status: str,
                               reviewer_id: Optional[int], note: str) -> None:
    """把审核结果写回业务表（索引 record_id 与业务主键的对应在此集中处理）。"""
    table, sep, raw_id = record_id.partition("-")
    if not sep or not raw_id.isdigit():
        return
    target = {"scr": "screenings", "sup": "screening_supplements"}.get(table)
    if not target:
        return
    try:
        await db.execute_a(
            f"UPDATE {target} SET review_status = ?, reviewed_by = ?, "
            f"reviewed_at = CURRENT_TIMESTAMP, review_note = ? WHERE id = ?",
            (status, reviewer_id, note or "", int(raw_id)),
        )
    except Exception:
        pass


async def review(record_ids: List[str], action: str, reviewer_id: Optional[int] = None,
                 note: str = "") -> Dict:
    """批量审核。action 取 approve / reject。

    通过：改 scope 为 public，写训练队列，等待下一次重训消费。
    拒绝：改 scope 为 rejected，不入队，保留记录供审计。
    """
    if action not in ("approve", "reject"):
        raise ValueError("action 必须是 approve 或 reject")
    engine = get_hashing_engine()
    await engine._ensure_initialized()
    if not _supports_review(engine):
        raise ValueError("当前运行环境不支持数据审核（检索引擎为降级实现）")
    by_rec = _units_by_record(engine)

    scope = "public" if action == "approve" else "rejected"
    status = "approved" if action == "approve" else "rejected"
    done, skipped = [], []

    for rid in record_ids:
        units = by_rec.get(rid) or []
        if not units:
            skipped.append({"record_id": rid, "reason": "索引中不存在该记录"})
            continue
        rec = engine.records.get(rid) or {}
        for meta in units:
            meta["scope"] = scope
        if rec:
            rec["scope"] = scope
        try:
            engine._store.update_scope(scope, record_ids=[rid])
            if action == "approve":
                engine._store.enqueue(rid, rec.get("window"))
        except Exception as exc:
            skipped.append({"record_id": rid, "reason": f"持久化失败：{exc}"})
            continue
        await _sync_business_table(rid, status, reviewer_id, note)
        done.append(rid)

    # 可见性缓存失效
    engine._scope_epoch += 1
    engine._visible_cache = {}
    pending = engine._store.pending_count()
    scheduled = False
    threshold = int(getattr(settings, "HASHING_AUTO_RETRAIN_MIN", 10) or 0)
    if action == "approve" and threshold > 0 and pending >= threshold:
        # 攒够一批就在后台重训，不阻塞审核请求
        scheduled = engine.schedule_retrain()
    return {
        "action": action, "updated": len(done), "records": done,
        "skipped": skipped, "pending": pending,
        "retrain_scheduled": scheduled,
    }


async def set_scope(record_id: str, scope: str, user_id: Optional[int] = None) -> Dict:
    """用户侧可见性设置：private（只做个人比对）/ public（申请公开）。

    申请公开只是把 scope 置回 reviewing，仍需管理员审核才进公共池。
    """
    if scope not in VALID_SCOPES:
        raise ValueError("非法 scope")
    engine = get_hashing_engine()
    await engine._ensure_initialized()
    if not _supports_review(engine):
        return {"ok": False, "reason": "当前运行环境不支持该操作"}
    by_rec = _units_by_record(engine)
    units = by_rec.get(record_id) or []
    if not units:
        return {"ok": False, "reason": "记录不存在"}
    if user_id is not None and (units[0].get("user_id") not in (None, user_id)):
        return {"ok": False, "reason": "无权修改该记录"}
    target = "reviewing" if scope == "public" else scope
    for meta in units:
        meta["scope"] = target
    rec = engine.records.get(record_id)
    if rec:
        rec["scope"] = target
    engine._store.update_scope(target, record_ids=[record_id])
    engine._scope_epoch += 1
    engine._visible_cache = {}
    return {"ok": True, "record_id": record_id, "scope": target}


async def review_stats() -> Dict:
    engine = get_hashing_engine()
    await engine._ensure_initialized()
    if not _supports_review(engine):
        return {"scope": {}, "pending": 0, "public": 0, "private": 0,
                "rejected": 0, "queue": 0, "train_version": "", "supported": False}
    dist = engine.scope_distribution()
    return {
        "scope": dist,
        "pending": dist.get("reviewing", 0),
        "public": dist.get("public", 0),
        "private": dist.get("private", 0),
        "rejected": dist.get("rejected", 0),
        "queue": engine._store.pending_count(),
        "train_version": engine._store.last_train_version(),
    }
