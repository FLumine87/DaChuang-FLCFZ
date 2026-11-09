"""日常问询持久化服务（Agent 主动关怀链路的"最后一公里"）。

触发方式：**当天第一次登录进系统时触发**（`ensure_daily_checkin`），
不再依赖 APScheduler 定时。一天只问询一次 —— 当天已有记录（无论
pending 还是 replied）就直接复用，不重复生成、不重复调 LLM。

本模块把问询落到 `daily_checkins` 表，并负责：

- `save_checkins()`：批量落库（同一用户同一天只保留一条，重复执行不会刷屏）；
- `ensure_daily_checkin()`：登录触发入口，返回"当天这一条"（可能是新建的，
  也可能是已经存在的）；
- `list_pending()`：前端拉取待回复问询；
- `mark_replied()`：用户回复后标记状态并保存回复原文。

注意：本模块只负责"问询记录"的生命周期，用户回复内容的图谱抽取仍由
既有的 `/kg/extract` 链路负责（前端回复后照常调用），这里不重复实现。
"""

import time
from typing import Optional

from ..db.database import SessionLocal
from ..db.models import DailyCheckin
from ..schemas.checkin import DailyCheckinOut


def _today() -> str:
    return time.strftime("%Y-%m-%d")


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def save_checkins(messages: dict[str, str], source: str = "manual") -> int:
    """把 {user_id: message} 批量落库，返回新增条数。

    幂等设计：同一天同一用户若已有 `pending` 记录，则跳过不重复插入
    （管理员全量触发与登录触发可能撞车，或服务重启后补跑）。
    """
    if not messages:
        return 0
    today = _today()
    created = 0
    now = _now()
    with SessionLocal.begin() as session:
        for uid, msg in messages.items():
            if not uid or not (msg or "").strip():
                continue
            exists = (
                session.query(DailyCheckin)
                .filter(
                    DailyCheckin.user_id == uid,
                    DailyCheckin.checkin_date == today,
                    DailyCheckin.status == "pending",
                )
                .first()
            )
            if exists is not None:
                continue
            session.add(
                DailyCheckin(
                    user_id=uid,
                    message=msg.strip(),
                    status="pending",
                    source=source,
                    checkin_date=today,
                    created_at=now,
                )
            )
            created += 1
    return created


def list_pending(user_id: str, limit: int = 5) -> list[DailyCheckinOut]:
    """拉取某用户待回复的问询（最新在前）。"""
    with SessionLocal() as session:
        rows = (
            session.query(DailyCheckin)
            .filter(DailyCheckin.user_id == user_id, DailyCheckin.status == "pending")
            .order_by(DailyCheckin.id.desc())
            .limit(limit)
            .all()
        )
        return [DailyCheckinOut.model_validate(r, from_attributes=True) for r in rows]


def mark_replied(checkin_id: int, reply: str) -> Optional[DailyCheckinOut]:
    """标记问询已回复并保存回复原文；记录不存在或已回复返回 None。"""
    with SessionLocal.begin() as session:
        row = session.get(DailyCheckin, checkin_id)
        if row is None or row.status != "pending":
            return None
        row.status = "replied"
        row.reply = (reply or "").strip()
        row.replied_at = _now()
        session.flush()
        session.refresh(row)
        return DailyCheckinOut.model_validate(row, from_attributes=True)


def mark_declined(checkin_id: int) -> Optional[DailyCheckinOut]:
    """标记问询为「不想回复」（pending → declined）；状态已变则返回 None。

    与 `mark_replied` 的区别：不记录任何回复正文 —— 用户点的是"不想回复"，
    不该顺手往 reply 字段塞一个"不想回复"之类的伪回复，那会污染历史记录，
    让"用户真的说了什么"和"用户拒绝了"混在一起看不出来。

    declined 之后的语义：
      · 不再出现在 `list_pending()`（前端待回复横幅消失）；
      · 今天的 ensure 会复用这条记录且 status != pending → 前端**不再弹窗**，
        用户当天不会再被打扰（这是"不想回复"应有的效果）。
    """
    with SessionLocal.begin() as session:
        row = session.get(DailyCheckin, checkin_id)
        if row is None or row.status != "pending":
            return None
        row.status = "declined"
        row.replied_at = _now()  # 记录"做了决定"的时刻，便于回溯
        session.flush()
        session.refresh(row)
        return DailyCheckinOut.model_validate(row, from_attributes=True)


def list_all(user_id: Optional[str] = None, limit: int = 20) -> list[DailyCheckinOut]:
    """查看问询历史（含已回复），用于调试与前端展示历史关怀记录。"""
    with SessionLocal() as session:
        q = session.query(DailyCheckin)
        if user_id:
            q = q.filter(DailyCheckin.user_id == user_id)
        rows = q.order_by(DailyCheckin.id.desc()).limit(limit).all()
        return [DailyCheckinOut.model_validate(r, from_attributes=True) for r in rows]


def get_today(user_id: str) -> Optional[DailyCheckinOut]:
    """取该用户**今天**的问询记录（不限状态）。不存在返回 None。"""
    with SessionLocal() as session:
        row = (
            session.query(DailyCheckin)
            .filter(
                DailyCheckin.user_id == user_id,
                DailyCheckin.checkin_date == _today(),
            )
            .order_by(DailyCheckin.id.desc())
            .first()
        )
        if row is None:
            return None
        return DailyCheckinOut.model_validate(row, from_attributes=True)


def expire_stale(user_id: str) -> int:
    """把该用户**往日**遗留的 pending 问询标记为 expired，返回处理条数。

    一天只问询一次 → 昨天没答的问题不该一直挂在"待回复"里积成堆。
    新的一天问询生成时顺手清掉旧的，pending 列表始终只剩"今天的这一条"。
    """
    today = _today()
    with SessionLocal.begin() as session:
        rows = (
            session.query(DailyCheckin)
            .filter(
                DailyCheckin.user_id == user_id,
                DailyCheckin.status == "pending",
                DailyCheckin.checkin_date != today,
            )
            .all()
        )
        for row in rows:
            row.status = "expired"
        return len(rows)


def ensure_daily_checkin(user_id: str, force: bool = False) -> dict:
    """登录触发入口：保证该用户**今天有一条**问询，返回它。

    一天只问询一次的实现方式：
    - 今天已有记录（pending / replied / expired）→ 直接复用，**不再调 LLM**
      （重复登录不会重复生成，也不会重复消耗大模型额度）；
    - 今天还没有 → 生成一条新的落库，并顺带把往日的 pending 置为过期。

    `force=True` 时忽略已有记录强制重生成（调试用，如接口 ?force=1）。

    返回：{
        "user_id", "created"(本次是否新建), "checkin"(记录或 None), "message"
    }
    注意 Neo4j 不可用时返回 created=False 且 checkin=None，由调用方决定
    是否退回到静态兜底文案（不落库，避免污染真实问询记录）。
    """
    from . import daily_checkin_agent  # 局部导入：避免模块级循环依赖

    existing = get_today(user_id)
    if existing is not None and not force:
        return {
            "user_id": user_id,
            "created": False,
            "checkin": existing,
            "message": existing.message,
        }

    expired = expire_stale(user_id)

    interests = daily_checkin_agent.get_user_interests(user_id)
    message = (daily_checkin_agent.generate_checkin_message(user_id, interests) or "").strip()
    if not message:
        # 生成不出内容（如 Neo4j 未连接且模板为空）→ 不落库，交给调用方兜底
        return {"user_id": user_id, "created": False, "checkin": None, "message": ""}

    today = _today()
    now = _now()
    with SessionLocal.begin() as session:
        if force:
            old = (
                session.query(DailyCheckin)
                .filter(
                    DailyCheckin.user_id == user_id,
                    DailyCheckin.checkin_date == today,
                )
                .all()
            )
            for row in old:
                session.delete(row)
        row = DailyCheckin(
            user_id=user_id,
            message=message,
            status="pending",
            source="login",
            checkin_date=today,
            created_at=now,
        )
        session.add(row)
        session.flush()
        session.refresh(row)
        out = DailyCheckinOut.model_validate(row, from_attributes=True)

    return {
        "user_id": user_id,
        "created": True,
        "checkin": out,
        "message": message,
        "expired": expired,
    }

