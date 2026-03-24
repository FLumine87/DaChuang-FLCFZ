from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base
import enum


class AlertStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    RESOLVED = "resolved"
    CLOSED = "closed"


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    alert_id = Column(String(20), unique=True, index=True, nullable=False)
    screening_id = Column(Integer, ForeignKey("screenings.id"), nullable=False)
    name = Column(String(50), nullable=False)
    
    level = Column(String(20), default="green")
    trigger = Column(String(200), nullable=True)
    description = Column(Text, nullable=True)
    
    status = Column(String(20), default="pending")
    assignee_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    follow_up_notes = Column(Text, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    screening_record = relationship("Screening", back_populates="alerts")
    assignee_user = relationship("User", back_populates="alerts")


class AlertRule(Base):
    __tablename__ = "alert_rules"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    questionnaire_id = Column(Integer, ForeignKey("questionnaires.id"), nullable=True)
    
    min_score = Column(Integer, nullable=True)
    max_score = Column(Integer, nullable=True)
    alert_level = Column(String(20), nullable=False)
    description = Column(Text, nullable=True)
    
    is_active = Column(Integer, default=1)
    priority = Column(Integer, default=0)
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
