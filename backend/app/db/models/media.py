from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base


class MediaFile(Base):
    __tablename__ = "media_files"

    id = Column(Integer, primary_key=True, index=True)
    file_id = Column(String(20), unique=True, index=True, nullable=False)
    screening_id = Column(Integer, ForeignKey("screenings.id"), nullable=True)
    
    file_type = Column(String(20), nullable=False)
    file_name = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_size = Column(Integer, default=0)
    mime_type = Column(String(100), nullable=True)
    
    description = Column(Text, nullable=True)
    analysis_result = Column(Text, nullable=True)
    
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    created_at = Column(DateTime, server_default=func.now())

    screening = relationship("Screening", back_populates="media_files")
