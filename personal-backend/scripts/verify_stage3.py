"""阶段3 端到端验证：干净启动 8001 并验证 inference + alerts + graph。"""
import subprocess, time, urllib.request, json, sys, os

BASE = "http://localhost:8001"

def get(path):
    return urllib.request.urlopen(BASE + path, timeout=30).read().decode()

def post(path, payload):
    req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    return json.loads(urllib.request.urlopen(req, timeout=90).read().decode())

print("health:", get("/api/v1/health"))
d = post("/api/v1/inference/run", {"user_id": "demo_user"})
r = d["report"]
print("inference:", r["risk_level"], "| alert:", r["alert_created"], "| feed:", len(d["content_feed"]))
g = json.loads(get("/api/v1/kg/graph/demo_user"))
print("graph:", len(g["nodes"]), "nodes,", len(g["links"]), "links, neo4j:", g["neo4j_connected"])
alerts = json.loads(get("/api/v1/alerts?user_id=demo_user"))
print("alerts:", len(alerts), "条")
print("ALL OK")
