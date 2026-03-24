from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime
import uuid

from app.services.base import BaseService
from app.db.models.alert import Alert, AlertRule
from app.schemas.alert import AlertCreate, AlertUpdate, AlertRuleCreate, AlertRuleUpdate


class AlertService(BaseService[Alert]):
    def __init__(self, db: Session):
        super().__init__(db, Alert)

    def generate_alert_id(self) -> str:
        return f"ALT-{uuid.uuid4().hex[:6].upper()}"

    def get_all_rules(self) -> List[AlertRule]:
        return self.db.query(AlertRule).order_by(AlertRule.priority.desc()).all()

    def create_rule(self, data: AlertRuleCreate) -> AlertRule:
        rule = AlertRule(**data.model_dump())
        self.db.add(rule)
        self.db.commit()
        self.db.refresh(rule)
        return rule

    def update_rule(self, rule_id: int, data: AlertRuleUpdate) -> Optional[AlertRule]:
        rule = self.db.query(AlertRule).filter(AlertRule.id == rule_id).first()
        if not rule:
            return None
        
        update_data = data.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            if value is not None:
                setattr(rule, key, value)
        
        self.db.commit()
        self.db.refresh(rule)
        return rule

    def delete_rule(self, rule_id: int) -> bool:
        rule = self.db.query(AlertRule).filter(AlertRule.id == rule_id).first()
        if not rule:
            return False
        self.db.delete(rule)
        self.db.commit()
        return True

    def get_stats(self) -> dict:
        total = self.db.query(Alert).count()
        pending = self.db.query(Alert).filter(Alert.status == "pending").count()
        processing = self.db.query(Alert).filter(Alert.status == "processing").count()
        resolved = self.db.query(Alert).filter(Alert.status == "resolved").count()
        closed = self.db.query(Alert).filter(Alert.status == "closed").count()
        
        green = self.db.query(Alert).filter(Alert.level == "green").count()
        yellow = self.db.query(Alert).filter(Alert.level == "yellow").count()
        orange = self.db.query(Alert).filter(Alert.level == "orange").count()
        red = self.db.query(Alert).filter(Alert.level == "red").count()
        
        return {
            "total": total,
            "pending": pending,
            "processing": processing,
            "resolved": resolved,
            "closed": closed,
            "by_level": {
                "green": green,
                "yellow": yellow,
                "orange": orange,
                "red": red,
            }
        }

    def get_alerts(
        self,
        page: int = 1,
        page_size: int = 10,
        level: Optional[str] = None,
        status: Optional[str] = None,
    ) -> dict:
        query = self.db.query(Alert)
        
        if level:
            query = query.filter(Alert.level == level)
        if status:
            query = query.filter(Alert.status == status)
        
        total = query.count()
        items = query.order_by(Alert.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
        
        result_items = []
        for item in items:
            item_dict = {
                "id": item.id,
                "alert_id": item.alert_id,
                "screening_id": item.screening_id,
                "name": item.name,
                "level": item.level,
                "trigger": item.trigger,
                "status": item.status,
                "assignee_name": item.assignee_user.name if item.assignee_user else None,
                "created_at": item.created_at,
            }
            result_items.append(type("AlertListItem", (), item_dict))
        
        return {"items": result_items, "total": total}

    def get_alert_by_id(self, alert_id: int) -> Optional[Alert]:
        return self.db.query(Alert).filter(Alert.id == alert_id).first()

    def create_alert(self, data: AlertCreate) -> Alert:
        alert_data = data.model_dump()
        alert_data["alert_id"] = self.generate_alert_id()
        alert_data["status"] = "pending"
        
        alert = Alert(**alert_data)
        self.db.add(alert)
        self.db.commit()
        self.db.refresh(alert)
        return alert

    def update_alert(self, alert_id: int, data: AlertUpdate) -> Optional[Alert]:
        alert = self.get_alert_by_id(alert_id)
        if not alert:
            return None
        
        update_data = data.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            if value is not None:
                setattr(alert, key, value)
        
        self.db.commit()
        self.db.refresh(alert)
        return alert

    def resolve_alert(self, alert_id: int, notes: str = "") -> Optional[Alert]:
        alert = self.get_alert_by_id(alert_id)
        if not alert:
            return None
        
        alert.status = "resolved"
        alert.follow_up_notes = notes
        alert.resolved_at = datetime.now()
        
        self.db.commit()
        self.db.refresh(alert)
        return alert
