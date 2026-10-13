"""On-demand individual assessment, sharing the group workflow's task queue."""
import json
import uuid

from app.db import database as db
from app.services import agent_workspace as workspace


async def ensure_schema():
    await workspace.ensure_schema()
    await db.execute_a("""CREATE TABLE IF NOT EXISTS agent_workspace_case_runs (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, subject TEXT NOT NULL,
        actor TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL)""")


async def detail(scope, subject):
    await ensure_schema()
    case = await workspace.case_detail(scope, subject)
    latest = await db.query_one_a(
        "SELECT payload FROM agent_workspace_case_runs WHERE scope=? AND subject=? "
        "ORDER BY created_at DESC,id DESC LIMIT 1", (scope, case["subject"]))
    case["assessment"] = json.loads(latest["payload"]) if latest else None
    return case


async def run(scope, subject, actor):
    await ensure_schema()
    case = await workspace.case_detail(scope, subject)
    priority = case["alert_level"] in ("red", "orange", "yellow")
    created = await workspace.propose_tasks(scope, [case] if priority else [], actor)
    assessment = {
        "id": uuid.uuid4().hex, "created_at": workspace.now(),
        "mode": "workflow-preview", "model_connected": False,
        "subject": case["subject"], "evidence_ids": case["evidence_ids"],
        "summary": "；".join(case["reasons"]),
        "recommendation": "请授权人员复核原始量表及实际情况，审核后分配任务。"
                          if priority else "保留常规关注；如实际情况与筛查不符，请人工复核。",
        "limits": case["missing"] + ["筛查线索不构成心理诊断；当前未接入大模型。"],
        "trace": [
            {"tool": "read_case_history", "summary": f"读取 {len(case['history'])} 次已完成筛查"},
            {"tool": "compare_same_scale", "summary": "仅比较同量表、同满分的历史记录"},
            {"tool": "inspect_material_coverage", "summary": "核查资料覆盖情况，不据声音或表情判定心理状态"},
            {"tool": "propose_tasks", "summary": f"新增 {created} 条待审核草案；已有任务不被覆盖"},
        ],
    }
    await db.execute_a(
        "INSERT INTO agent_workspace_case_runs VALUES(?,?,?,?,?,?)",
        (assessment["id"], scope, case["subject"], actor,
         assessment["created_at"], json.dumps(assessment, ensure_ascii=False)))
    return await detail(scope, case["subject"])
