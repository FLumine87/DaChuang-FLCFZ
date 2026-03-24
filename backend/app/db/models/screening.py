from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base


class Questionnaire(Base):
    __tablename__ = "questionnaires"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(20), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    max_score = Column(Integer, nullable=False)
    questions = Column(Text, nullable=True)
    scoring_rules = Column(Text, nullable=True)
    is_active = Column(Integer, default=1)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    screenings = relationship("Screening", back_populates="questionnaire_info")


class Screening(Base):
    __tablename__ = "screenings"

    id = Column(Integer, primary_key=True, index=True)
    screening_id = Column(String(20), unique=True, index=True, nullable=False)
    name = Column(String(50), nullable=False)
    age = Column(Integer, nullable=True)
    gender = Column(String(10), nullable=True)
    department = Column(String(100), nullable=True)
    phone = Column(String(20), nullable=True)
    
    questionnaire_id = Column(Integer, ForeignKey("questionnaires.id"), nullable=False)
    score = Column(Integer, default=0)
    max_score = Column(Integer, default=100)
    answers = Column(Text, nullable=True)
    
    status = Column(String(20), default="pending")
    alert_level = Column(String(20), default="green")
    
    counselor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    notes = Column(Text, nullable=True)
    
    screening_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    questionnaire_info = relationship("Questionnaire", back_populates="screenings")
    counselor = relationship("User", back_populates="screenings")
    alerts = relationship("Alert", back_populates="screening_record")
    media_files = relationship("MediaFile", back_populates="screening")
