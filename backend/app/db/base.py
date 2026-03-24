from sqlalchemy.orm import DeclarativeBase
from datetime import datetime


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: datetime
    updated_at: datetime
