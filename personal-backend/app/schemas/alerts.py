from typing import Literal, Optional

from pydantic import BaseModel, Field

AlertStatus = Literal["pending", "confirmed", "processing", "closed"]
AlertLevel = Literal["orange", "red"]


class AlertOut(BaseModel):
    id: int
    user_id: str
    level: str
    title: str
    reason: str
    evidence: str
    summary: str
    status: str
    created_at: str
    updated_at: str


class AlertCreate(BaseModel):
    """手动创建预警（联调用）。"""
    user_id: str = Field(min_length=1)
    level: AlertLevel
    title: str = Field(min_length=1)
    reason: str = ""


class AlertStatusUpdate(BaseModel):
    status: AlertStatus
