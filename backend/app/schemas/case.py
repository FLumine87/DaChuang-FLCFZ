from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel
from app.schemas import BaseSchema


class CaseTagBase(BaseModel):
    name: str
    color: str = "#3b82f6"
    description: Optional[str] = None


class CaseTagCreate(CaseTagBase):
    pass


class CaseTagResponse(CaseTagBase, BaseSchema):
    id: int
    created_at: datetime


class CaseBase(BaseModel):
    name: str
    age: Optional[int] = None
    gender: Optional[str] = None
    department: Optional[str] = None
    phone: Optional[str] = None
    id_number: Optional[str] = None


class CaseCreate(CaseBase):
    tags: Optional[List[str]] = None
    notes: Optional[str] = None


class CaseUpdate(BaseModel):
    name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    department: Optional[str] = None
    phone: Optional[str] = None
    id_number: Optional[str] = None
    alert_level: Optional[str] = None
    status: Optional[str] = None
    tags: Optional[List[str]] = None
    notes: Optional[str] = None


class CaseResponse(CaseBase, BaseSchema):
    id: int
    case_id: str
    alert_level: str
    status: str
    counselor_id: Optional[int]
    counselor_name: Optional[str]
    notes: Optional[str]
    screening_count: int
    last_screening_date: Optional[datetime]
    tags: List[str] = []
    created_at: datetime
    updated_at: datetime


class CaseListResponse(BaseSchema):
    id: int
    case_id: str
    name: str
    age: Optional[int]
    gender: Optional[str]
    department: Optional[str]
    alert_level: str
    status: str
    screening_count: int
    last_screening_date: Optional[datetime]
    tags: List[str] = []


class TimelineEventBase(BaseModel):
    event_type: str
    title: str
    description: Optional[str] = None
    event_date: Optional[datetime] = None


class TimelineEventCreate(TimelineEventBase):
    pass


class TimelineEventResponse(TimelineEventBase, BaseSchema):
    id: int
    case_id: int
    created_at: datetime


class CaseDetail(CaseResponse):
    timeline: List[TimelineEventResponse] = []
    screenings: List[dict] = []
    alerts: List[dict] = []
