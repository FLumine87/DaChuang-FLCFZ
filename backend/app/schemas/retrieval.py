from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel
from app.schemas import BaseSchema


class RetrievalQuery(BaseModel):
    query: str
    modality: str = "text"
    top_k: int = 5


class RetrievalResult(BaseModel):
    id: str
    similarity: float
    modality: str
    summary: str
    tags: List[str] = []
    alert_level: str
    date: str


class RetrievalResponse(BaseSchema):
    query: str
    results: List[RetrievalResult]
    total: int


class RAGReportSection(BaseModel):
    title: str
    content: str


class RAGReport(BaseModel):
    subject: str
    date: str
    summary: str
    risk_level: str
    sections: List[RAGReportSection] = []
    recommendations: List[str] = []


class AnalysisRequest(BaseModel):
    screening_id: int
    include_retrieval: bool = True
    top_k: int = 5


class AnalysisResponse(BaseSchema):
    screening_id: int
    retrieval_results: Optional[RetrievalResponse] = None
    rag_report: Optional[RAGReport] = None


class MediaUploadResponse(BaseSchema):
    file_id: str
    file_type: str
    file_name: str
    file_path: str
    file_size: int
    created_at: datetime


class DashboardStats(BaseModel):
    total_screenings: int
    monthly_screenings: int
    pending_alerts: int
    completion_rate: float
    alert_distribution: dict
    trend_data: List[dict]
