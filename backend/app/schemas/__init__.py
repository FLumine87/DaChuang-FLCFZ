from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class BaseSchema(BaseModel):
    class Config:
        from_attributes = True


class PaginationParams(BaseModel):
    page: int = 1
    page_size: int = 10


class TimeRange(BaseModel):
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
