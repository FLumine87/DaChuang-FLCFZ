from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime
import uuid

from app.services.base import BaseService
from app.db.models.screening import Screening, Questionnaire
from app.db.models.alert import Alert
from app.schemas.screening import ScreeningCreate, ScreeningUpdate, QuestionnaireCreate


class ScreeningService(BaseService[Screening]):
    def __init__(self, db: Session):
        super().__init__(db, Screening)

    def generate_screening_id(self) -> str:
        return f"SCR-{uuid.uuid4().hex[:6].upper()}"

    def get_all_questionnaires(self) -> List[Questionnaire]:
        return self.db.query(Questionnaire).filter(Questionnaire.is_active == 1).all()

    def create_questionnaire(self, data: QuestionnaireCreate) -> Questionnaire:
        questionnaire = Questionnaire(**data.model_dump())
        self.db.add(questionnaire)
        self.db.commit()
        self.db.refresh(questionnaire)
        return questionnaire

    def get_screenings(
        self,
        page: int = 1,
        page_size: int = 10,
        status: Optional[str] = None,
        alert_level: Optional[str] = None,
        questionnaire_id: Optional[int] = None,
        keyword: Optional[str] = None,
    ) -> dict:
        from sqlalchemy.orm import joinedload
        
        query = self.db.query(Screening).options(
            joinedload(Screening.questionnaire_info),
            joinedload(Screening.counselor)
        )
        
        if status:
            query = query.filter(Screening.status == status)
        if alert_level:
            query = query.filter(Screening.alert_level == alert_level)
        if questionnaire_id:
            query = query.filter(Screening.questionnaire_id == questionnaire_id)
        if keyword:
            query = query.filter(Screening.name.contains(keyword))
        
        total = query.count()
        items = query.order_by(Screening.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
        
        result_items = []
        for item in items:
            item_dict = {
                "id": item.id,
                "screening_id": item.screening_id,
                "name": item.name,
                "age": item.age,
                "gender": item.gender,
                "questionnaire_name": item.questionnaire_info.name if item.questionnaire_info else None,
                "score": item.score,
                "max_score": item.max_score,
                "status": item.status,
                "alert_level": item.alert_level,
                "screening_date": item.screening_date,
                "created_at": item.created_at,
                "counselor_name": item.counselor.name if item.counselor else None,
            }
            result_items.append(item_dict)
        
        return {"items": result_items, "total": total}

    def get_screening_by_id(self, screening_id: int) -> Optional[Screening]:
        return self.db.query(Screening).filter(Screening.id == screening_id).first()

    def create_screening(self, data: ScreeningCreate) -> Screening:
        screening_data = data.model_dump()
        screening_data["screening_id"] = self.generate_screening_id()
        screening_data["status"] = "pending"
        screening_data["alert_level"] = "green"
        
        questionnaire = self.db.query(Questionnaire).filter(Questionnaire.id == data.questionnaire_id).first()
        if questionnaire:
            screening_data["max_score"] = questionnaire.max_score
        
        screening = Screening(**screening_data)
        self.db.add(screening)
        self.db.commit()
        self.db.refresh(screening)
        return screening

    def update_screening(self, screening_id: int, data: ScreeningUpdate) -> Optional[Screening]:
        screening = self.get_screening_by_id(screening_id)
        if not screening:
            return None
        
        update_data = data.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            if value is not None:
                setattr(screening, key, value)
        
        self.db.commit()
        self.db.refresh(screening)
        return screening

    def delete_screening(self, screening_id: int) -> bool:
        screening = self.get_screening_by_id(screening_id)
        if not screening:
            return False
        self.db.delete(screening)
        self.db.commit()
        return True

    def complete_screening(self, screening_id: int, score: int) -> Optional[Screening]:
        screening = self.get_screening_by_id(screening_id)
        if not screening:
            return None
        
        screening.score = score
        screening.status = "completed"
        screening.screening_date = datetime.now()
        
        alert_level = self._calculate_alert_level(screening.questionnaire_id, score)
        screening.alert_level = alert_level
        
        self._create_alert_if_needed(screening)
        
        self.db.commit()
        self.db.refresh(screening)
        return screening

    def _calculate_alert_level(self, questionnaire_id: int, score: int) -> str:
        from app.db.models.alert import AlertRule
        
        rules = self.db.query(AlertRule).filter(
            AlertRule.questionnaire_id == questionnaire_id,
            AlertRule.is_active == 1
        ).order_by(AlertRule.priority.desc()).all()
        
        for rule in rules:
            min_score = rule.min_score or 0
            max_score = rule.max_score or float('inf')
            if min_score <= score <= max_score:
                return rule.alert_level
        
        if score >= 80:
            return "red"
        elif score >= 60:
            return "orange"
        elif score >= 40:
            return "yellow"
        return "green"

    def _create_alert_if_needed(self, screening: Screening) -> None:
        if screening.alert_level in ["orange", "red"]:
            alert = Alert(
                alert_id=f"ALT-{uuid.uuid4().hex[:6].upper()}",
                screening_id=screening.id,
                name=screening.name,
                level=screening.alert_level,
                trigger=f"{screening.questionnaire_info.name if screening.questionnaire_info else '量表'} 得分 {screening.score}",
                description=f"筛查得分触发{screening.alert_level}级预警",
                status="pending",
            )
            self.db.add(alert)
