from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr
from app.schemas import BaseSchema


class UserBase(BaseModel):
    username: str
    name: str
    role: str = "user"
    department: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    name: Optional[str] = None
    department: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None


class UserResponse(UserBase, BaseSchema):
    id: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class UserLogin(BaseModel):
    username: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    sub: int
    exp: datetime
