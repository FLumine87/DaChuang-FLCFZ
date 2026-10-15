"""轻量安全层（纯标准库）：密码哈希 + HS256 JWT。

- 密码哈希：自实现 pbkdf2_sha256（格式与 passlib 的
  `$pbkdf2-sha256$<rounds>$<salt>$<checksum>` 完全兼容）。
  原因：passlib 在模块导入期调用 os.urandom，而 Cloudflare Python Worker 禁止
  在请求上下文之外获取熵，故 Worker 环境不能使用 passlib。
- JWT：HS256 自实现（HMAC-SHA256），替代 python-jose（其 cryptography 依赖
  会显著增加 Worker 体积）。
"""
from datetime import timedelta
from typing import Optional
import base64
import hashlib
import hmac
import json
import secrets
import time

from app.config import settings

# ---------------- 密码哈希（pbkdf2_sha256，passlib 兼容） ----------------
_PBKDF2_ROUNDS = 29000
_PBKDF2_ALGORITHM = "sha256"


def _b64e(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64d(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not hashed_password:
        return False
    # 旧 bcrypt 哈希（仅本地存量数据）：延迟导入 passlib，Worker 下不可用时返回 False
    if hashed_password.startswith(("$2a$", "$2b$", "$2y$")):
        try:
            from passlib.context import CryptContext
            return CryptContext(schemes=["bcrypt"], deprecated="auto").verify(plain_password, hashed_password)
        except Exception:
            return False
    try:
        parts = hashed_password.split("$")
        if len(parts) != 5 or parts[1] != "pbkdf2-sha256":
            return False
        rounds = int(parts[2])
        salt = _b64d(parts[3])
        expected = _b64d(parts[4])
        dk = hashlib.pbkdf2_hmac(
            _PBKDF2_ALGORITHM, plain_password.encode("utf-8"), salt, rounds
        )
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False


def get_password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac(
        _PBKDF2_ALGORITHM, password.encode("utf-8"), salt, _PBKDF2_ROUNDS
    )
    return f"$pbkdf2-sha256${_PBKDF2_ROUNDS}${_b64e(salt)}${_b64e(dk)}"


# ---------------- JWT（HS256 自实现，替代 python-jose） ----------------

def _jwt_b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _jwt_b64d(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """生成 HS256 JWT。payload 含 sub/username/role 及 iat/exp。"""
    payload = dict(data)
    now = int(time.time())
    if expires_delta:
        exp = now + int(expires_delta.total_seconds())
    else:
        exp = now + settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    payload.update({"iat": now, "exp": exp})

    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = _jwt_b64(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _jwt_b64(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )
    signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
    signature = hmac.new(
        settings.SECRET_KEY.encode("utf-8"), signing_input, hashlib.sha256
    ).digest()
    return f"{header_b64}.{payload_b64}.{_jwt_b64(signature)}"


def decode_access_token(token: str) -> Optional[dict]:
    """校验并解析 HS256 JWT；无效/过期返回 None。"""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        header_b64, payload_b64, sig_b64 = parts
        signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
        expected = hmac.new(
            settings.SECRET_KEY.encode("utf-8"), signing_input, hashlib.sha256
        ).digest()
        if not hmac.compare_digest(expected, _jwt_b64d(sig_b64)):
            return None
        payload = json.loads(_jwt_b64d(payload_b64))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload
    except Exception:
        return None
