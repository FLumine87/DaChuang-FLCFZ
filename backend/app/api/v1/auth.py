from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import timedelta

from app.db.session import get_db
from app.db.models.user import User
from app.core.security import verify_password, create_access_token
from app.core.responses import success_response
from app.schemas.user import UserCreate, UserResponse
from app.config import settings

router = APIRouter()


from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
async def login(
    data: LoginRequest,
    db: Session = Depends(get_db)
):
    username = data.username
    password = data.password
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="用户已被禁用")

    access_token = create_access_token(
        data={"sub": user.id, "username": user.username, "role": user.role},
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )

    return success_response(data={
        "token": access_token,
        "role": user.role,
        "name": user.name
    })


@router.post("/register")
async def register(
    data: UserCreate,
    db: Session = Depends(get_db)
):
    existing = db.query(User).filter(User.username == data.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="用户名已存在")

    from app.core.security import get_password_hash
    user = User(
        username=data.username,
        password_hash=get_password_hash(data.password),
        name=data.name,
        role=data.role,
        department=data.department,
        phone=data.phone,
        email=data.email,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return success_response(data=UserResponse.model_validate(user))


@router.post("/logout")
async def logout():
    return success_response(message="登出成功")