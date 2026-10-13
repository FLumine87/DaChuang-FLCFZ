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
