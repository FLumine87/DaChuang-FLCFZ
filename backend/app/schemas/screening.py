from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel
from app.schemas import BaseSchema


class QuestionnaireBase(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    max_score: int


class QuestionnaireCreate(QuestionnaireBase):
    questions: Optional[str] = None
    scoring_rules: Optional[str] = None


class QuestionnaireResponse(QuestionnaireBase, BaseSchema):
    id: int
    is_active: int
    created_at: datetime


class ScreeningBase(BaseModel):
    name: str
    age: Optional[int] = None
    gender: Optional[str] = None
    department: Optional[str] = None
    phone: Optional[str] = None


class ScreeningCreate(ScreeningBase):
    questionnaire_id: int
    answers: Optional[str] = None
    notes: Optional[str] = None


class ScreeningUpdate(BaseModel):
    name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    department: Optional[str] = None
    phone: Optional[str] = None
    answers: Optional[str] = None
    score: Optional[int] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class ScreeningResponse(ScreeningBase, BaseSchema):
    id: int
    screening_id: str
    questionnaire_id: int
    questionnaire_name: Optional[str] = None
    score: int
    max_score: int
    status: str
    alert_level: str
    counselor_id: Optional[int] = None
    counselor_name: Optional[str] = None
    notes: Optional[str] = None
    screening_date: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class ScreeningListResponse(BaseSchema):
    id: int
    screening_id: str
    name: str
    age: Optional[int]
    gender: Optional[str]
    questionnaire_name: Optional[str]
    score: int
    max_score: int
    status: str
    alert_level: str
    screening_date: Optional[datetime]
    created_at: datetime


class ScreeningDetail(ScreeningResponse):
    answers: Optional[str] = None
    media_files: List[Any] = []
