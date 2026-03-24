from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel
from app.schemas import BaseSchema


class AlertRuleBase(BaseModel):
    name: str
    questionnaire_id: Optional[int] = None
    min_score: Optional[int] = None
    max_score: Optional[int] = None
    alert_level: str
    description: Optional[str] = None


class AlertRuleCreate(AlertRuleBase):
    priority: int = 0


class AlertRuleUpdate(BaseModel):
    name: Optional[str] = None
    min_score: Optional[int] = None
    max_score: Optional[int] = None
    alert_level: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[int] = None
    priority: Optional[int] = None


class AlertRuleResponse(AlertRuleBase, BaseSchema):
    id: int
    is_active: int
    priority: int
    created_at: datetime


class AlertBase(BaseModel):
    name: str
    level: str = "green"
    trigger: Optional[str] = None
    description: Optional[str] = None


class AlertCreate(AlertBase):
    screening_id: int


class AlertUpdate(BaseModel):
    level: Optional[str] = None
    status: Optional[str] = None
    assignee_id: Optional[int] = None
    follow_up_notes: Optional[str] = None


class AlertResponse(AlertBase, BaseSchema):
    id: int
    alert_id: str
    screening_id: int
    status: str
    assignee_id: Optional[int]
    assignee_name: Optional[str] = None
    follow_up_notes: Optional[str]
    resolved_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime


class AlertListResponse(BaseSchema):
    id: int
    alert_id: str
    screening_id: int
    name: str
    level: str
    trigger: Optional[str]
    status: str
    assignee_name: Optional[str]
    created_at: datetime


class AlertStats(BaseModel):
    total: int
    pending: int
    processing: int
    resolved: int
    closed: int
    by_level: dict
