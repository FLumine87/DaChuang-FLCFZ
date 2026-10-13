"""Local-only smoke test; creates/updates DEMO tasks, never business tasks.

Uses the repository's development seed account unless AGENT_TEST_USERNAME and
AGENT_TEST_PASSWORD are supplied. Never prints credentials or access tokens.
"""
import json
import os
import urllib.error
import urllib.request
from urllib.parse import quote

BASE = "http://127.0.0.1:8000"


def call(method, path, data=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    body = json.dumps(data).encode() if data is not None else None
    with urllib.request.urlopen(
        urllib.request.Request(BASE + path, body, headers, method=method), timeout=20
    ) as response:
        return json.load(response)


def main():
    auth = call("POST", "/api/auth/login", {
        "username": os.getenv("AGENT_TEST_USERNAME", "admin"),
        "password": os.getenv("AGENT_TEST_PASSWORD", "admin123"),
    })
    token = auth["data"]["token"]
    try:
        call("GET", "/api/agent-workspace?scope=demo")
        raise AssertionError("Unauthenticated endpoint was accessible")
    except urllib.error.HTTPError as error:
        assert error.code == 401
    run = call("POST", "/api/agent-workspace/runs",
               {"scope": "demo", "days": 30, "department": "all"}, token)["data"]
    assert run["latest_run"]["total"] == 24
    case = call("GET", "/api/agent-workspace/cases/demo%3A001?scope=demo", token=token)["data"]
    assert {m["kind"] for m in case["materials"]} == {"text", "audio", "image"}
    assessed = call("POST", "/api/agent-workspace/cases/demo%3A001/runs", {"scope": "demo"}, token)["data"]
    reread = call("GET", "/api/agent-workspace/cases/demo%3A001?scope=demo", token=token)["data"]
    assert assessed["assessment"]["id"] == reread["assessment"]["id"]
    proposed = next((task for task in run["tasks"] if task["state"] == "proposed"), None)
    if proposed:
        path = "/api/agent-workspace/tasks/" + quote(proposed["id"], safe="")
        updated = call("PUT", path, {
            "version": proposed["version"], "action": "confirm",
            "assignee": "演示负责人", "note": "本地接口验收（仅演示空间）",
        }, token)["data"]
        refreshed = call("GET", "/api/agent-workspace?scope=demo", token=token)["data"]
        assert next(t for t in refreshed["tasks"] if t["id"] == updated["id"])["state"] == "confirmed"
    for path in ("/agent-demo/planner.svg", "/agent-demo/diary.wav"):
        with urllib.request.urlopen("http://127.0.0.1:5173" + path, timeout=20) as response:
            assert len(response.read()) > 100
    live = call("GET", "/api/agent-workspace?scope=live", token=token)["data"]
    print("PASS: auth, group run, individual run + reload, encoded routes, 3 media assets, saved task reload")
    print("Business subjects available:", live["available_subjects"])


if __name__ == "__main__":
    main()
