"""轻量安全层（纯标准库）：HS256 JWT 校验。

与主服务端（backend/app/core/security.py）**同源同密钥**：
personal-backend 不自己签发凭证，只校验主服务端登录时签发的那枚 JWT。
两边都用 HS256 + 同一个 SECRET_KEY，因此这里只需 decode、不需要 create。

为什么不用 python-jose / PyJWT：主服务端为了 Cloudflare Worker 体积
已经改成纯标准库自实现，这里保持一致，且新增零依赖。

安全要点（都写了显式分支，别删）：
  1. 显式拒绝 alg != HS256 —— 防「算法混淆」攻击（攻击者把 header 改成
     alg=none 或 alg=RS256，诱导服务端用错误的方式验签）；
  2. 用 hmac.compare_digest 比对签名 —— 防时序侧信道；
  3. 校验 exp —— 过期凭证一律不认。
"""
from __future__ import annotations

from typing import Optional
import base64
import hashlib
import hmac
import json
import time

from ..config import settings

_ALGORITHM = "HS256"


def _b64d(s: str) -> bytes:
    """base64url 解码（自动补齐 padding）。"""
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def decode_access_token(token: str) -> Optional[dict]:
    """校验并解析 HS256 JWT；无效 / 过期 / 算法不符一律返回 None。

    返回的 payload 形如：
        {"sub": "2", "username": "xiaoyu", "role": "user", "iat": ..., "exp": ...}
    """
    try:
        parts = (token or "").split(".")
        if len(parts) != 3:
            return None
        header_b64, payload_b64, sig_b64 = parts

        # 1) 算法白名单：只认 HS256，拒绝 alg=none / RS256 等混淆手法
        header = json.loads(_b64d(header_b64))
        if header.get("alg") != _ALGORITHM:
            return None

        # 2) 签名校验（compare_digest 防时序侧信道）
        signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
        expected = hmac.new(
            settings.secret_key.encode("utf-8"), signing_input, hashlib.sha256
        ).digest()
        if not hmac.compare_digest(expected, _b64d(sig_b64)):
            return None

        # 3) 过期校验
        payload = json.loads(_b64d(payload_b64))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def token_identities(payload: dict) -> set[str]:
    """从 payload 里抽出「这个令牌代表谁」的全部可用标识。

    为什么是两个而不是一个：主服务端 JWT 里同时有 `sub`（users.id，如 "2"）
    和 `username`（如 "xiaoyu"），而个人端的历史数据（Neo4j 图谱、问询记录）
    一律以 **username** 作为 user_id 落库。若只认 sub，归属校验会把本人挡在门外。
    因此这里把两个都收进来，命中任一即视为同一个人。
    """
    ids: set[str] = set()
    for key in ("sub", "username"):
        val = payload.get(key)
        if val is not None and str(val).strip():
            ids.add(str(val).strip())
    return ids
