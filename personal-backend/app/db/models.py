import time

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


class Alert(Base):
    """心理风险预警记录（对接机构端"预警管理"模块的数据基础）。"""

    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    level: Mapped[str] = mapped_column(String(16))  # orange / red
    title: Mapped[str] = mapped_column(String(128))
    reason: Mapped[str] = mapped_column(Text)        # 风险因素摘要
    evidence: Mapped[str] = mapped_column(Text, default="{}")  # 完整推理证据 JSON
    summary: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    # 状态流转：pending(待确认) -> confirmed(已确认) -> processing(跟进中) -> closed(已关闭)
    created_at: Mapped[str] = mapped_column(String(32), default=_now)
    updated_at: Mapped[str] = mapped_column(String(32), default=_now, onupdate=_now)


class DailyCheckin(Base):
    """每日问询记录（Agent 主动关怀链路的持久化）。

    此前只打一行日志（logger.info），用户端拿不到任何东西——
    生成的个性化问询等于凭空消失。落库后前端可按 status 拉取
    「待回复」的问询，用户回复时把内容写回这里并走既有抽取链路进图谱。

    触发方式（2026-11-07）：当天第一次登录进系统时生成，一天一条。
    """

    __tablename__ = "daily_checkins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    message: Mapped[str] = mapped_column(Text)              # 生成的问询文案
    # pending(待回复) -> replied(已回复) / expired(已过期)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    reply: Mapped[str] = mapped_column(Text, default="")    # 用户回复原文
    source: Mapped[str] = mapped_column(String(16), default="login")  # login / manual
    # 触发日期（YYYY-MM-DD）：同一天只保留一条，避免重复问询刷屏
    checkin_date: Mapped[str] = mapped_column(String(16), index=True)
    created_at: Mapped[str] = mapped_column(String(32), default=_now)
    replied_at: Mapped[str] = mapped_column(String(32), default="")
