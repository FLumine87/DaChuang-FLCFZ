from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import Optional

from app.db.session import get_db
from app.core.responses import success_response
from app.schemas.retrieval import (
    RetrievalQuery,
    AnalysisRequest,
)
from app.engines.hashing.mock_engine import MockHashingEngine
from app.engines.rag.mock_engine import MockRAGEngine

router = APIRouter()


@router.post("/search")
async def search_similar_cases(
    data: RetrievalQuery,
    db: Session = Depends(get_db)
):
    engine = MockHashingEngine()
    results = await engine.search(
        query=data.query,
        modality=data.modality,
        top_k=data.top_k
    )
    
    return success_response(data={
        "query": data.query,
        "results": results,
        "total": len(results)
    })


@router.post("/analyze")
async def analyze_screening(
    data: AnalysisRequest,
    db: Session = Depends(get_db)
):
    from app.services.screening_service import ScreeningService
    
    screening_service = ScreeningService(db)
    screening = screening_service.get_screening_by_id(data.screening_id)
    
    if not screening:
        return success_response(data=None, message="筛查记录不存在")
    
    retrieval_results = None
    if data.include_retrieval:
        hashing_engine = MockHashingEngine()
        results = await hashing_engine.search(
            query=f"{screening.name} {screening.questionnaire_info.name if screening.questionnaire_info else ''}",
            modality="text",
            top_k=data.top_k
        )
        retrieval_results = {
            "query": screening.name,
            "results": results,
            "total": len(results)
        }
    
    rag_engine = MockRAGEngine()
    report = await rag_engine.generate_report({
        "id": screening.id,
        "name": screening.name,
        "questionnaire": screening.questionnaire_info.name if screening.questionnaire_info else "未知量表",
        "score": screening.score,
        "max_score": screening.max_score,
        "alert_level": screening.alert_level,
    })
    
    return success_response(data={
        "screening_id": data.screening_id,
        "retrieval_results": retrieval_results,
        "rag_report": report
    })


@router.get("/report/{screening_id}")
async def get_analysis_report(
    screening_id: int,
    db: Session = Depends(get_db)
):
    from app.services.screening_service import ScreeningService
    
    screening_service = ScreeningService(db)
    screening = screening_service.get_screening_by_id(screening_id)
    
    if not screening:
        return success_response(data=None, message="筛查记录不存在")
    
    rag_engine = MockRAGEngine()
    report = await rag_engine.generate_report({
        "id": screening.id,
        "name": screening.name,
        "questionnaire": screening.questionnaire_info.name if screening.questionnaire_info else "未知量表",
        "score": screening.score,
        "max_score": screening.max_score,
        "alert_level": screening.alert_level,
    })
    
    return success_response(data=report)
