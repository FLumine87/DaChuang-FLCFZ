from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Table
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base


case_tags = Table(
    'case_tags_association',
    Base.metadata,
    Column('case_id', Integer, ForeignKey('cases.id'), primary_key=True),
    Column('tag_id', Integer, ForeignKey('case_tag_master.id'), primary_key=True)
)


class Case(Base):
    __tablename__ = "cases"

    id = Column(Integer, primary_key=True, index=True)
    case_id = Column(String(20), unique=True, index=True, nullable=False)
    name = Column(String(50), nullable=False)
    age = Column(Integer, nullable=True)
    gender = Column(String(10), nullable=True)
    department = Column(String(100), nullable=True)
    phone = Column(String(20), nullable=True)
    id_number = Column(String(20), nullable=True)
    
    alert_level = Column(String(20), default="green")
    status = Column(String(20), default="active")
    
    counselor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    notes = Column(Text, nullable=True)
    
    screening_count = Column(Integer, default=0)
    last_screening_date = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    counselor_user = relationship("User", back_populates="cases")
    tags = relationship("CaseTagMaster", secondary=case_tags, back_populates="cases")
    timeline_events = relationship("CaseTimeline", back_populates="case", cascade="all, delete-orphan")


class CaseTagMaster(Base):
    __tablename__ = "case_tag_master"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False)
    color = Column(String(10), default="#3b82f6")
    description = Column(Text, nullable=True)
    
    created_at = Column(DateTime, server_default=func.now())

    cases = relationship("Case", secondary=case_tags, back_populates="tags")


class CaseTimeline(Base):
    __tablename__ = "case_timeline"

    id = Column(Integer, primary_key=True, index=True)
    case_id = Column(Integer, ForeignKey("cases.id"), nullable=False)
    
    event_type = Column(String(50), nullable=False)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    
    event_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    case = relationship("Case", back_populates="timeline_events")
