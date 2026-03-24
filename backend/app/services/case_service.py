from sqlalchemy.orm import Session
from typing import Optional, List
import uuid

from app.services.base import BaseService
from app.db.models.case import Case, CaseTagMaster, CaseTimeline, case_tags
from app.schemas.case import CaseCreate, CaseUpdate, CaseTagCreate, TimelineEventCreate


class CaseService(BaseService[Case]):
    def __init__(self, db: Session):
        super().__init__(db, Case)

    def generate_case_id(self) -> str:
        return f"CASE-{uuid.uuid4().hex[:6].upper()}"

    def get_all_tags(self) -> List[CaseTagMaster]:
        return self.db.query(CaseTagMaster).all()

    def create_tag(self, data: CaseTagCreate) -> CaseTagMaster:
        tag = CaseTagMaster(**data.model_dump())
        self.db.add(tag)
        self.db.commit()
        self.db.refresh(tag)
        return tag

    def get_cases(
        self,
        page: int = 1,
        page_size: int = 10,
        alert_level: Optional[str] = None,
        status: Optional[str] = None,
        keyword: Optional[str] = None,
    ) -> dict:
        query = self.db.query(Case)
        
        if alert_level:
            query = query.filter(Case.alert_level == alert_level)
        if status:
            query = query.filter(Case.status == status)
        if keyword:
            query = query.filter(Case.name.contains(keyword))
        
        total = query.count()
        items = query.order_by(Case.updated_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
        
        result_items = []
        for item in items:
            tags = [tag.name for tag in item.tags]
            item_dict = {
                "id": item.id,
                "case_id": item.case_id,
                "name": item.name,
                "age": item.age,
                "gender": item.gender,
                "department": item.department,
                "alert_level": item.alert_level,
                "status": item.status,
                "screening_count": item.screening_count,
                "last_screening": item.last_screening_date.strftime("%Y-%m-%d") if item.last_screening_date else None,
                "tags": tags,
            }
            result_items.append(type("CaseListItem", (), item_dict))
        
        return {"items": result_items, "total": total}

    def get_case_by_id(self, case_id: int) -> Optional[Case]:
        return self.db.query(Case).filter(Case.id == case_id).first()

    def create_case(self, data: CaseCreate) -> Case:
        case_data = data.model_dump(exclude={"tags"})
        case_data["case_id"] = self.generate_case_id()
        case_data["status"] = "active"
        case_data["alert_level"] = "green"
        
        case = Case(**case_data)
        
        if data.tags:
            tags = self.db.query(CaseTagMaster).filter(CaseTagMaster.name.in_(data.tags)).all()
            case.tags = tags
        
        self.db.add(case)
        self.db.commit()
        self.db.refresh(case)
        return case

    def update_case(self, case_id: int, data: CaseUpdate) -> Optional[Case]:
        case = self.get_case_by_id(case_id)
        if not case:
            return None
        
        update_data = data.model_dump(exclude_unset=True, exclude={"tags"})
        for key, value in update_data.items():
            if value is not None:
                setattr(case, key, value)
        
        if data.tags is not None:
            tags = self.db.query(CaseTagMaster).filter(CaseTagMaster.name.in_(data.tags)).all()
            case.tags = tags
        
        self.db.commit()
        self.db.refresh(case)
        return case

    def delete_case(self, case_id: int) -> bool:
        case = self.get_case_by_id(case_id)
        if not case:
            return False
        self.db.delete(case)
        self.db.commit()
        return True

    def get_timeline(self, case_id: int) -> List[CaseTimeline]:
        return self.db.query(CaseTimeline).filter(
            CaseTimeline.case_id == case_id
        ).order_by(CaseTimeline.event_date.desc()).all()

    def add_timeline_event(self, case_id: int, data: TimelineEventCreate) -> CaseTimeline:
        event = CaseTimeline(
            case_id=case_id,
            **data.model_dump()
        )
        self.db.add(event)
        self.db.commit()
        self.db.refresh(event)
        return event
