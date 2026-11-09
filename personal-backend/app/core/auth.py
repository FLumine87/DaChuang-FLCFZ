"""请求鉴权与授权（FastAPI 依赖）。

三层职责，逐层收紧：

  1. `require_user`   —— **认证**：请求必须带 `Authorization: Bearer <JWT>`，
     且该 JWT 由主服务端（8000）签发、签名有效、未过期。否则 401。
  2. `require_admin`  —— **角色**：在已认证基础上要求 role == "admin"。否则 403。
  3. `assert_owns`    —— **授权（归属）**：令牌身份必须与目标 user_id 一致。
     否则 403 —— 这是阻止「拿自己的合法凭证读别人心理数据」的关键一步。

为什么归属校验不能只靠前端传的 user_id：
    加鉴权前，接口把 user_id 当参数收下就去取数据，`user_id=xiaoyu` 猜中即得。
    认证只解决「你是谁」，若不比对归属，任何登录用户仍能读任何人的图谱与问询原文。
    两层缺一不可。

开发便利开关（config.allow_anonymous_local，默认 False）：
    为 True 且请求来自本机回环地址时，无凭证也放行，且**不做归属校验**。
    存在的唯一理由是仓库里有一批历史验证脚本不带凭证直连 8001；
    上线 / 改 --host 0.0.0.0 时必须保持 False。
"""
from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .security import decode_access_token, token_identities

# auto_error=False：缺 Authorization 头时不由 HTTPBearer 直接抛错，
# 而是交给我们自己抛 —— 这样能返回统一的中文 401 提示，前端好展示。
_bearer = HTTPBearer(auto_error=False)

# 本地放行模式下的合成身份标记。带这个标记的 payload 不是真实登录用户，
# assert_owns 见到它直接放行（见下方注释：这是刻意为之的开发后门，不是漏洞）。
_ANON_LOCAL = "_anon_local"


def is_loopback(request: Request) -> bool:
    """请求是否来自本机回环地址（127.0.0.1 / ::1）。

    仅用于「开发便利开关」的判定，不作为身份依据。
    """
    client = request.client
    if client is None:
        return False
    return client.host in ("127.0.0.1", "::1", "localhost")


def require_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict:
    """认证：解析并校验 Bearer JWT，返回 payload（含 sub/username/role）。"""
    if credentials is None or not credentials.credentials:
        # 开发便利开关：仅本机 + 显式开启时才放行
        if settings_allow_anon() and is_loopback(request):
            return {"sub": None, "username": None, "role": "local", _ANON_LOCAL: True}
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未提供认证凭证，请先登录",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        # 凭证无效时不走本地放行 —— 拿着一枚坏 token 说明调用方本来就想带凭证，
        # 静默降级成匿名会掩盖真实的鉴权故障。
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录已过期或凭证无效，请重新登录",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return payload


def settings_allow_anon() -> bool:
    """延迟读取配置：避免 import 期就把 config 固化（便于测试时改环境变量）。"""
    from ..config import settings

    return bool(settings.allow_anonymous_local)


def require_admin(user: dict = Depends(require_user)) -> dict:
    """角色：要求管理员。用于跨用户的调试/管理接口。"""
    if user.get(_ANON_LOCAL):
        return user  # 本机放行模式下不拦管理员接口
    if str(user.get("role") or "").lower() != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return user


def assert_owns(user: dict, target_user_id: Optional[str], *, what: str = "该数据") -> None:
    """授权：令牌身份必须与目标 user_id 属于同一个人，否则 403。

    `sub` 与 `username` 任一命中即算本人（历史数据用 username，
    新数据可能用 sub，见 security.token_identities 的说明）。

    本机放行模式（_anon_local）下直接返回 —— 这正是该开关的语义：
    本机调试时允许以任意 user_id 访问。它只在 allow_anonymous_local=True
    且请求来自 127.0.0.1 时才会出现，生产环境不可达。
    """
    if user.get(_ANON_LOCAL):
        return
    target = (target_user_id or "").strip()
    if not target:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="缺少用户标识")
    if target in token_identities(user):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"无权访问{what}",
    )
