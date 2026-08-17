"""
最小集成验证（无需数据库）：
  1) 后端鉴权：无 token -> 401；合法 token -> 200；非 admin -> 403
  2) RAG 引擎：缺 zhipuai 时优雅降级到 Mock 报告
"""
import sys
sys.path.insert(0, ".")

from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient

from app.core.security import (
    create_access_token,
    get_current_user,
    require_admin,
)
from datetime import timedelta

app = FastAPI()


@app.get("/protected")
def protected(current_user=Depends(get_current_user)):
    return {"user": current_user}


@app.get("/admin-only")
def admin_only(admin=Depends(require_admin)):
    return {"admin": admin}


client = TestClient(app)

print("=== 1) 鉴权行为 ===")
r = client.get("/protected")
print("无 token       ->", r.status_code, "(期望 401)")
assert r.status_code == 401

admin_token = create_access_token(
    {"sub": "1", "username": "admin", "role": "admin"}, expires_delta=timedelta(minutes=30)
)
r = client.get("/protected", headers={"Authorization": f"Bearer {admin_token}"})
print("admin 合法 token ->", r.status_code, "(期望 200)")
assert r.status_code == 200
assert r.json()["user"]["role"] == "admin"

user_token = create_access_token(
    {"sub": "2", "username": "user", "role": "user"}, expires_delta=timedelta(minutes=30)
)
r = client.get("/admin-only", headers={"Authorization": f"Bearer {user_token}"})
print("普通用户访问admin ->", r.status_code, "(期望 403)")
assert r.status_code == 403

r = client.get("/admin-only", headers={"Authorization": f"Bearer {admin_token}"})
print("admin 访问admin   ->", r.status_code, "(期望 200)")
assert r.status_code == 200
print("鉴权验证通过 ✅")


print("\n=== 2) RAG 引擎降级 ===")
from app.engines.rag.zhipu_rag_engine import ZhipuRAGEngine, ZHIPU_AVAILABLE
print("zhipuai 可用?", ZHIPU_AVAILABLE, "(期望 False，未安装)")
eng = ZhipuRAGEngine()
import asyncio
report = asyncio.run(eng.generate_report({
    "score": 22, "max_score": 27, "alert_level": "red",
    "questionnaire": "PHQ-9", "name": "测试被试",
}))
print("降级报告含 sections?", "sections" in report, "| 含 summary?", "summary" in report)
assert "sections" in report and "summary" in report
print("RAG 降级验证通过 ✅")
print("\n全部验证通过。")
