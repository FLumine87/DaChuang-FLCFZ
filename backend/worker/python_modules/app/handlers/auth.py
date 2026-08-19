"""认证接口 handler（登录/注册/登出）。"""
from datetime import timedelta

from app.core.responses import success_response
from app.core.exceptions import HttpError
from app.core.security import verify_password, get_password_hash, create_access_token
from app.core.auth import RequestContext
from app.db import database as db
from app.config import settings


def login(ctx: RequestContext):
    data = ctx.body
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    user = db.query_one("SELECT * FROM users WHERE username = ?", (username,))
    if not user or not verify_password(password, user.get("password_hash") or ""):
        raise HttpError(401, "用户名或密码错误")
    if not user.get("is_active", 1):
        raise HttpError(403, "用户已被禁用")
    token = create_access_token(
        data={"sub": str(user["id"]), "username": user["username"], "role": user["role"]},
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return success_response(data={
        "token": token,
        "role": user["role"],
        "name": user["name"],
    })


def register(ctx: RequestContext):
    data = ctx.body
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if not username or not password:
        raise HttpError(400, "用户名和密码不能为空")
    if db.query_one("SELECT id FROM users WHERE username = ?", (username,)):
        raise HttpError(400, "用户名已存在")
    row_id = db.execute(
        "INSERT INTO users (username, password_hash, name, role, department, phone, email) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            username, get_password_hash(password), data.get("name") or username,
            data.get("role", "user"), data.get("department"), data.get("phone"),
            data.get("email"),
        ),
    )
    row = db.query_one("SELECT * FROM users WHERE id = ?", (row_id,))
    if row:
        row.pop("password_hash", None)
    return success_response(data=row)


def logout(ctx: RequestContext):
    return success_response(message="登出成功")
