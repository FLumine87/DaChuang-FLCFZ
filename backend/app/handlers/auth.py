"""认证接口 handler（登录/注册/登出/验证码，async）。"""
import os
import random
import time
import uuid
from datetime import timedelta

from app.core.responses import success_response
from app.core.exceptions import HttpError
from app.core.security import verify_password, get_password_hash, create_access_token
from app.core.auth import RequestContext
from app.db import database as db
from app.config import settings


# ---------------------------------------------------------------- 登录验证码
#
# 四位字母的图形验证码，服务端生成、服务端校验，表单里只是"看得见"。
# 为什么不做成纯前端：纯前端生成的验证码谁都能绕过，等于没有。
#
# 演示账号（xiaoyu / adminer）是公开写在登录页上的，让人逐个抄验证码
# 反而影响演示。所以对这两个账号，接口会把 code 一起返回，前端自动填好 ——
# 校验依旧在服务端走一遍，只是"帮着填一下"。
CAPTCHA_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"  # 去掉 I / O，避免和 1 / 0 混淆
CAPTCHA_LENGTH = 4
CAPTCHA_TTL_SECONDS = 300
DEMO_USERNAMES = {"xiaoyu", "adminer"}

# 紧急开关：AUTH_CAPTCHA_ENABLED=0 时跳过校验（仅供本地压测/脚本，默认开启）
CAPTCHA_ENABLED = str(os.environ.get("AUTH_CAPTCHA_ENABLED", "1")).lower() not in ("0", "false", "no")

# 进程内存储：id -> {code, expires}。演示项目够用；多实例部署需换 Redis。
_CAPTCHAS: dict[str, dict] = {}


def _gc_captchas() -> None:
    """顺手清理过期条目，避免字典无限增长。"""
    now = time.time()
    for cid in [k for k, v in _CAPTCHAS.items() if v["expires"] < now]:
        _CAPTCHAS.pop(cid, None)


def _captcha_svg(code: str) -> str:
    """把验证码画成 SVG：每个字符随机旋转/偏移，叠几条干扰线与噪点。"""
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40" width="120" height="40">',
        '<rect width="120" height="40" rx="8" fill="#f1f5f9"/>',
    ]
    for _ in range(3):
        parts.append(
            '<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="#cbd5e1" stroke-width="1.2" opacity="0.8"/>'
            % (random.randint(0, 120), random.randint(0, 40), random.randint(0, 120), random.randint(0, 40))
        )
    for index, char in enumerate(code):
        x = 20 + index * 25 + random.randint(-2, 2)
        y = 27 + random.randint(-3, 3)
        rotate = random.randint(-16, 16)
        color = random.choice(["#465fff", "#1e293b", "#0f766e", "#7c3aed"])
        parts.append(
            '<text x="%d" y="%d" font-family="Menlo,Consolas,monospace" font-size="22" '
            'font-weight="700" fill="%s" transform="rotate(%d %d %d)">%s</text>'
            % (x, y, color, rotate, x, y, char)
        )
    for _ in range(8):
        parts.append(
            '<circle cx="%d" cy="%d" r="1" fill="#94a3b8" opacity="0.7"/>'
            % (random.randint(4, 116), random.randint(4, 36))
        )
    parts.append("</svg>")
    return "".join(parts)


def _consume_captcha(captcha_id: str, code: str) -> bool:
    """校验并作废（一次性）。无论对错都从表里删掉，防止同一张图反复试。"""
    _gc_captchas()
    record = _CAPTCHAS.pop(captcha_id or "", None)
    if not record or record["expires"] < time.time():
        return False
    return record["code"].upper() == (code or "").strip().upper()


async def captcha(ctx: RequestContext):
    """发一张新的验证码。

    GET /api/auth/captcha?username=xiaoyu
    演示账号会额外返回 demoCode，前端据此自动填充；其余账号不返回。
    """
    _gc_captchas()
    username = str(ctx.query.get("username") or "").strip().lower()
    code = "".join(random.choice(CAPTCHA_ALPHABET) for _ in range(CAPTCHA_LENGTH))
    captcha_id = uuid.uuid4().hex
    _CAPTCHAS[captcha_id] = {"code": code, "expires": time.time() + CAPTCHA_TTL_SECONDS}
    data = {
        "id": captcha_id,
        "svg": _captcha_svg(code),
        "length": CAPTCHA_LENGTH,
        "expiresIn": CAPTCHA_TTL_SECONDS,
    }
    if username in DEMO_USERNAMES:
        # 只对公开的演示账号回传答案，便于登录页自动填充，演示时不必手抄
        data["demoCode"] = code
    return success_response(data=data)


async def login(ctx: RequestContext):
    data = ctx.body
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()

    if CAPTCHA_ENABLED:
        captcha_id = str(data.get("captchaId") or "").strip()
        captcha_code = str(data.get("captchaCode") or "").strip()
        if not captcha_id:
            raise HttpError(400, "请先获取验证码")
        if not captcha_code:
            raise HttpError(400, "请输入验证码")
        if not _consume_captcha(captcha_id, captcha_code):
            raise HttpError(400, "验证码不正确，请重新输入")

    user = await db.query_one_a("SELECT * FROM users WHERE username = ?", (username,))
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


async def register(ctx: RequestContext):
    data = ctx.body
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()
    if not username or not password:
        raise HttpError(400, "用户名和密码不能为空")
    if await db.query_one_a("SELECT id FROM users WHERE username = ?", (username,)):
        raise HttpError(400, "用户名已存在")
    row_id = await db.execute_a(
        "INSERT INTO users (username, password_hash, name, role, department, phone, email, is_active) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
        (
            username, get_password_hash(password), data.get("name") or username,
            # 注册是公开路由（无需登录），role 必须由服务端固定为 'user'。
            # 旧写法 data.get("role", "user") 直接采信客户端传入值 →
            # 任何人都能 POST {"role":"admin"} 注册出管理员账号（提权漏洞）。
            # 注：此修复在 2026-10-04 的远端历史重写中丢失，2026-10-07 随移动端分支带回。
            "user", data.get("department"), data.get("phone"),
            data.get("email"),
        ),
    )
    row = await db.query_one_a("SELECT * FROM users WHERE id = ?", (row_id,))
    if row:
        row.pop("password_hash", None)
    return success_response(data=row)


async def logout(ctx: RequestContext):
    return success_response(message="登出成功")
