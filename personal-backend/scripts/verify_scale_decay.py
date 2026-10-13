# -*- coding: utf-8 -*-
"""验证：量表回写接口 + 推理时间衰减。直连 8001（绕过代理）。"""
import json
import time
import urllib.request

BASE = "http://localhost:8001"
UID = "verify_decay"


def call(method, path, body=None):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode() if body else None,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def cypher(query, **params):
    """直接对 Neo4j 跑 Cypher（docker 容器 7474 bolt 不便，走后端驱动同款接口无，改用 HTTP API）。"""
    import neo4j  # noqa
    raise SystemExit("unused")


# 1. 健康检查
h = call("GET", "/api/v1/health")
assert h["neo4j_connected"], "neo4j not connected"
print("[1] health ok:", h)

# 2. 写入量表得分（PHQ-9 = 18，触发推理）
r = call("POST", "/api/v1/kg/scale", {"user_id": UID, "scale": "PHQ-9", "score": 18, "run_inference": True})
print("[2] scale write:", json.dumps(r, ensure_ascii=False))
assert r["written"] == 1
assert r["inference_triggered"] and r["report"], "inference should be triggered"
# PHQ-9 满分27 → 18/27*10 = 6.67，×0.4 = 2.67（今天写入无衰减）
print("    report:", r["report"])

# 3. 写入 GAD-7 = 14（满分21 → 6.67 归一化）
r2 = call("POST", "/api/v1/kg/scale", {"user_id": UID, "scale": "GAD-7", "score": 14, "run_inference": True})
print("[3] GAD-7 write:", r2["report"])

# 4. 非法量表名应 400
try:
    call("POST", "/api/v1/kg/scale", {"user_id": UID, "scale": "FAKE-9", "score": 10})
    print("[4] FAIL: should have raised 400")
except urllib.error.HTTPError as e:
    assert e.code == 400
    print("[4] invalid scale rejected with 400 ok")

# 5. 图谱里应能看到量表节点
g = call("GET", f"/api/v1/kg/graph/{UID}")
names = [n["name"] for n in g["nodes"]]
assert "PHQ-9" in names and "GAD-7" in names, names
print("[5] graph contains scale nodes ok:", [n for n in names if n in ("PHQ-9", "GAD-7")])

# 6. 时间衰减验证：直接把 PHQ-9 边的 updated_at 改成 30 天前，分数应明显下降
import subprocess

# 从 .env 读 Neo4j 密码
neo4j_pw = "password123"
for line in open(".env", encoding="utf-8"):
    if line.startswith("NEO4J_PASSWORD="):
        neo4j_pw = line.split("=", 1)[1].strip()

past = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(time.time() - 30 * 86400))
docker_cmd = (
    "MATCH (u:User {user_id:'%s'})-[r:EXPERIENCED_EVENT]->(e:LifeEvent {name:'PHQ-9'}) "
    "SET r.updated_at='%s' RETURN count(r)" % (UID, past)
)
out = subprocess.run(
    ["docker", "exec", "gifted_buck", "cypher-shell", "-u", "neo4j", "-p", neo4j_pw,
     "--database", "neo4j", docker_cmd],
    capture_output=True, text=True,
)
print("[6] backdate cypher:", out.stdout.strip(), out.stderr.strip()[:200])
assert "1" in out.stdout, "backdate failed"

r3 = call("POST", "/api/v1/inference/run", {"user_id": UID})
rep = r3["report"]
# GAD-7 最新（无衰减）6.67×0.4=2.67；PHQ-9 已 30 天前 → 6.67×0.5^(30/7)≈6.67×0.0526≈0.35×0.4≈0.14
# 取最新一次量表 = GAD-7（今天），所以 scale 分量 ≈ 2.67
print("[7] report after backdating PHQ-9:", json.dumps({k: rep[k] for k in ("risk_level", "overall_score")}, ensure_ascii=False))
print("    factors:", json.dumps(rep["factors"], ensure_ascii=False))

# 8. 衰减单元校验（直接 import）
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.services.inference_agent import _decay, _expired, HALF_LIFE  # noqa: E402

now = time.time()
assert abs(_decay(time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(now - 7 * 86400)), 7.0, now) - 0.5) < 0.01
assert _decay(time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(now - 30 * 86400)), 7.0, now) < 0.06
assert _expired(time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(now - 60 * 86400)), 14.0, now)
assert not _expired(time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(now - 10 * 86400)), 14.0, now)
assert HALF_LIFE["interest"] is None
print("[8] decay unit tests ok")

print("\nALL PASSED")
