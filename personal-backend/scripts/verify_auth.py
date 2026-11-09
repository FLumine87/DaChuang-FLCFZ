"""个人后端（8001）鉴权回归验证。

覆盖「三步走」的每一条契约，并给出可证伪的反证：

  第 1 步 认证：无凭证 / 坏签名 / 过期 / alg=none  → 401；有效凭证 → 放行
  第 2 步 复用 8000 登录体系：用与主服务端**同一密钥**本地签发的 JWT 必须被接受，
           换一个密钥签发的必须被拒（证明真的在验签，不是只看格式）
  第 3 步 归属：拿自己的合法凭证读 / 改他人 user_id → 403；读自己 → 200
  另：跨用户接口（/checkin/daily/all、预警处置）要求 admin；health 保持公开

反证（证明断言不是在空转）：
  · 同一批请求，把凭证换成「他人身份」后，原本 200 的接口必须变成 403；
  · 把签名改一个字符，原本 200 的接口必须变成 401。
  —— 若这两个反证也返回 200，说明鉴权根本没生效，脚本会明确报错。

用法：
    python scripts/verify_auth.py
    python scripts/verify_auth.py --base http://127.0.0.1:8001
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request

# 与 personal-backend/app/config.py 的默认值 / .env 的 SECRET_KEY 保持一致。
SECRET = os.environ.get("SECRET_KEY", "your-secret-key-change-in-production")
WRONG_SECRET = "definitely-not-the-shared-secret"

OWNER = "xiaoyu"          # 本人
OTHER = "someone_else"    # 他人

_passed = 0
_failed: list[str] = []


def _b64e(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def sign(payload: dict, secret: str = SECRET, alg: str = "HS256", tamper: bool = False) -> str:
    """本地签发一枚 HS256 JWT（与主服务端 backend/app/core/security.py 同算法）。"""
    header = {"alg": alg, "typ": "JWT"}
    h = _b64e(json.dumps(header, separators=(",", ":")).encode())
    p = _b64e(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode())
    signing_input = f"{h}.{p}".encode()
    sig = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
    s = _b64e(sig)
    if tamper:
        s = ("A" if s[0] != "A" else "B") + s[1:]
    return f"{h}.{p}.{s}"


def token_for(username: str, sub: str = "2", role: str = "user", **extra) -> str:
    now = int(time.time())
    payload = {"sub": sub, "username": username, "role": role, "iat": now, "exp": now + 1800}
    payload.update(extra)
    return sign(payload)


def call(base: str, method: str, path: str, token: str | None = None, body: dict | None = None,
         timeout: int = 20):
    """返回 (status, text)。

    timeout 默认 20s；推理接口（/inference/run）要走真实大模型，实测 30~40s，
    用例里单独传更大的值 —— 否则会把「慢」误报成「鉴权失败」。
    """
    url = f"{base}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # 连不上等
        return 0, str(e)


def check(name: str, got, want) -> None:
    global _passed
    ok = got == want
    if ok:
        _passed += 1
        print(f"  [OK]   {name}  -> {got}")
    else:
        _failed.append(name)
        print(f"  [FAIL] {name}  -> 期望 {want}，实际 {got}")


# ------------------------------- 用例定义 -------------------------------
# (说明, method, path, body, 无凭证期望, 本人凭证期望, 他人凭证期望)
GET_CASES = [
    ("读本人图谱", "GET", f"/api/v1/kg/graph/{OWNER}", None, 401, 200, 403),
    ("读他人图谱", "GET", f"/api/v1/kg/graph/{OTHER}", None, 401, 403, 200),
    ("问询历史", "GET", f"/api/v1/checkin/history?user_id={OWNER}", None, 401, 200, 403),
    ("待回复问询", "GET", f"/api/v1/checkin/pending?user_id={OWNER}", None, 401, 200, 403),
    ("今日问询预览", "GET", f"/api/v1/checkin/daily?user_id={OWNER}", None, 401, 200, 403),
    ("兴趣推送", "GET", f"/api/v1/recommendations/by_interest?user_id={OWNER}", None, 401, 200, 403),
    ("预警列表(本人)", "GET", f"/api/v1/alerts?user_id={OWNER}", None, 401, 200, 403),
]

POST_CASES = [
    ("抽取三元组", "POST", "/api/v1/kg/extract", {"user_id": OWNER, "text": "我最近喜欢听民谣"}, 401, 200, 403),
    ("手动写三元组", "POST", "/api/v1/kg/triples", {"user_id": OWNER, "triples": []}, 401, 200, 403),
    ("量表回写", "POST", "/api/v1/kg/scale", {"user_id": OWNER, "scale": "PHQ-9", "score": 5}, 401, 200, 403),
    ("删图谱节点", "POST", "/api/v1/kg/node/delete", {"user_id": OWNER, "node_id": "Interest:民谣"}, 401, 200, 403),
    ("陪伴对话", "POST", "/api/v1/chat/companion", {"user_id": OWNER, "message": "在吗", "history": []}, 401, 200, 403),
    ("陪伴对话(流式)", "POST", "/api/v1/chat/companion/stream", {"user_id": OWNER, "message": "在吗", "history": []}, 401, 200, 403),
]

# 单独列出：真实大模型推理要 30~40s，超时必须放宽，否则会把「慢」误判成「鉴权失败」。
# 无凭证 / 他人两种情形的期望值不受耗时影响（鉴权在跑推理之前就拦下了）。
INFERENCE_CASE = ("推理报告", "POST", "/api/v1/inference/run", {"user_id": OWNER}, 401, 200, 403)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8001")
    args = ap.parse_args()
    base = args.base.rstrip("/")

    print(f"鉴权回归验证 → {base}\n")

    own = token_for(OWNER)
    other = token_for(OTHER, sub="3")

    print("【第 1 步】认证：无凭证 / 坏凭证 / 过期 / 算法混淆")
    check("health 保持公开（无凭证）", call(base, "GET", "/api/v1/health")[0], 200)
    check("无凭证 → 401", call(base, "GET", f"/api/v1/kg/graph/{OWNER}")[0], 401)
    check("坏签名 → 401", call(base, "GET", f"/api/v1/kg/graph/{OWNER}",
                                sign({"sub": "2", "username": OWNER, "role": "user",
                                      "exp": int(time.time()) + 600}, tamper=True))[0], 401)
    check("过期凭证 → 401", call(base, "GET", f"/api/v1/kg/graph/{OWNER}",
                                 token_for(OWNER, exp=int(time.time()) - 60))[0], 401)
    check("alg=none 混淆 → 401", call(base, "GET", f"/api/v1/kg/graph/{OWNER}",
                                      sign({"sub": "2", "username": OWNER, "role": "user",
                                            "exp": int(time.time()) + 600}, alg="none"))[0], 401)
    check("非三段式垃圾串 → 401", call(base, "GET", f"/api/v1/kg/graph/{OWNER}", "not-a-jwt")[0], 401)
    check("本人有效凭证 → 200", call(base, "GET", f"/api/v1/kg/graph/{OWNER}", own)[0], 200)

    print("\n【第 2 步】复用 8000 登录体系：同一密钥签发即被接受，换密钥即被拒")
    check("共享密钥签发的 JWT → 200", call(base, "GET", f"/api/v1/kg/graph/{OWNER}", own)[0], 200)
    check("别家密钥签发的 JWT → 401", call(base, "GET", f"/api/v1/kg/graph/{OWNER}",
                                          sign({"sub": "2", "username": OWNER, "role": "user",
                                                "exp": int(time.time()) + 600}, WRONG_SECRET))[0], 401)

    print("\n【第 3 步】归属校验：他人 user_id 一律 403")
    for name, method, path, body, s_none, s_own, s_other in GET_CASES + POST_CASES:
        # 「无凭证」「他人」两条在鉴权阶段就被拦下，毫秒级返回；
        # 「本人」这条会真的跑业务逻辑（部分接口要调 LLM 生成内容，实测 10~40s），
        # 因此给更长的超时 —— 否则会把「慢」误报成「鉴权失败」。
        check(f"{name}｜无凭证", call(base, method, path, None, body)[0], s_none)
        check(f"{name}｜他人", call(base, method, path, other, body)[0], s_other)
        check(f"{name}｜本人", call(base, method, path, own, body, timeout=90)[0], s_own)

    # 推理接口单独跑：本人那一次要等真实大模型（30~40s），超时放宽到 120s。
    inf_name, inf_m, inf_p, inf_b, inf_n, inf_o, inf_x = INFERENCE_CASE
    check(f"{inf_name}｜无凭证", call(base, inf_m, inf_p, None, inf_b)[0], inf_n)
    check(f"{inf_name}｜他人", call(base, inf_m, inf_p, other, inf_b)[0], inf_x)
    print(f"  ...   {inf_name}｜本人在跑真实推理，约需 30~40s，请稍候")
    check(f"{inf_name}｜本人", call(base, inf_m, inf_p, own, inf_b, timeout=120)[0], inf_o)

    print("\n【跨用户接口】只允许管理员")
    check("全量问询｜普通用户 → 403", call(base, "GET", "/api/v1/checkin/daily/all", own)[0], 403)
    check("全量问询｜无凭证 → 401", call(base, "GET", "/api/v1/checkin/daily/all")[0], 401)
    check("预警列表不传 user_id｜普通用户 → 403", call(base, "GET", "/api/v1/alerts", own)[0], 403)
    check("预警列表不传 user_id｜管理员 → 200",
          call(base, "GET", "/api/v1/alerts", token_for("admin", sub="1", role="admin"))[0], 200)
    check("处置预警｜普通用户 → 403", call(base, "POST", "/api/v1/alerts/999/status", own,
                                         {"status": "closed"})[0], 403)
    # 不存在的 id：普通用户必须是 403 而不是 404 —— 否则可据状态码差异枚举出
    # 「哪些预警 id 真实存在」，泄露他人预警编号。
    check("处置不存在预警｜普通用户 → 403（不得泄露存在性）",
          call(base, "POST", "/api/v1/alerts/999999/status", own, {"status": "closed"})[0], 403)
    check("清空子图｜他人 user_id → 403", call(base, "DELETE", f"/api/v1/kg/users/{OTHER}", own)[0], 403)

    print("\n【反证】把「本人」用例的凭证换掉，结果必须随之改变")
    # 若鉴权没生效，下面两条都会是 200 —— 那说明前面的「本人 200」是假通过。
    check("反证：他人凭证读本人图谱 ≠ 200",
          call(base, "GET", f"/api/v1/kg/graph/{OWNER}", other)[0] != 200, True)
    check("反证：坏签名读本人图谱 ≠ 200",
          call(base, "GET", f"/api/v1/kg/graph/{OWNER}",
               sign({"sub": "2", "username": OWNER, "role": "user",
                     "exp": int(time.time()) + 600}, tamper=True))[0] != 200, True)

    total = _passed + len(_failed)
    print(f"\n{'=' * 60}")
    if _failed:
        print(f"结果：{_passed}/{total} 通过，{len(_failed)} 条失败")
        for f in _failed:
            print(f"  · {f}")
        return 1
    print(f"结果：{_passed}/{total} 全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
