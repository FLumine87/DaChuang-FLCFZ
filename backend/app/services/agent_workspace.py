"""Persistent, deterministic agent workflow preview; no model/network calls.

Demo and operational data occupy distinct namespaces. Media availability is
recorded as evidence coverage, never converted into a mental-health inference.
"""
import json
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from app.core.exceptions import HttpError
from app.db import database as db

SCHEMA = (
    """CREATE TABLE IF NOT EXISTS agent_workspace_runs (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, actor TEXT NOT NULL,
        created_at TEXT NOT NULL, payload TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS agent_workspace_tasks (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, subject TEXT NOT NULL,
        kind TEXT NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL,
        assignee TEXT NOT NULL DEFAULT '', due_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0, events TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(scope, subject, kind))""",
)
LEVEL_ORDER = {"red": 0, "orange": 1, "yellow": 2, "green": 3}
LEVEL_NAMES = {"red": "红色", "orange": "橙色", "yellow": "黄色", "green": "绿色"}


def now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def scope_value(value):
    if value not in ("demo", "live"):
        raise HttpError(400, "数据范围必须为 demo 或 live")
    return value


async def ensure_schema():
    for sql in SCHEMA:
        await db.execute_a(sql)


def demo_records():
    """Original synthetic scenarios. No real names, labels or participants."""
    records = []
    for i in range(24):
        level = "red" if i < 2 else "orange" if i < 6 else "yellow" if i < 12 else "green"
        final_score = {"red": 22, "orange": 16, "yellow": 9, "green": 3}[level]
        for week in range(3):
            records.append({
                "id": f"demo-{i}-{week}", "subject": f"demo:{i + 1:03}",
                "ref": f"演示案例 {i + 1:03}", "department": ["信息学院", "人文学院", "理学院"][i % 3],
                "questionnaire": "PHQ-9（合成演示）", "questionnaire_id": "demo-phq9",
                "score": max(0, final_score - (2 - week) * (2 if i < 8 else 0)),
                "max_score": 27, "alert_level": level, "status": "completed",
                "date": f"2026-10-{1 + week * 5:02}T08:00:00+00:00",
                "media": ["text", "audio", "image"] if i == 0 else [],
                "source": "synthetic", "linked": True,
            })
    return records


async def records_for(scope):
    if scope == "demo":
        return demo_records()
    columns = {r["name"] for r in await db.query_a("PRAGMA table_info(screenings)")}
    case_column = "s.case_id" if "case_id" in columns else "NULL AS case_id"
    rows = await db.query_a(
        f"SELECT s.id, {case_column}, s.department, s.questionnaire_id, q.name AS questionnaire, "
        "s.score, s.max_score, s.alert_level, s.status, "
        "COALESCE(s.screening_date,s.created_at) AS date "
        "FROM screenings s LEFT JOIN questionnaires q ON q.id=s.questionnaire_id "
        "WHERE s.status='completed' ORDER BY date, s.id")
    media = defaultdict(set)
    for row in await db.query_a("SELECT screening_id,file_type FROM media_files"):
        if row["file_type"] in ("text", "audio", "image"):
            media[row["screening_id"]].add(row["file_type"])
    return [{
        **r, "subject": f"case:{r['case_id']}" if r["case_id"] else f"screening:{r['id']}",
        "ref": f"案例 {r['case_id']}" if r["case_id"] else f"筛查 {r['id']}",
        "source": "local", "linked": bool(r["case_id"]),
        "media": sorted(media[r["id"]]), "department": r["department"] or "未分组",
    } for r in rows]


def parse_date(value):
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except (ValueError, TypeError):
        return None


def compile_subjects(records):
    groups = defaultdict(list)
    for record in records:
        groups[record["subject"]].append(record)
    output = []
    for subject, history in groups.items():
        history.sort(key=lambda r: (parse_date(r["date"]) or datetime.min, str(r["id"])))
        latest = history[-1]
        comparable = [r for r in history[:-1]
                      if r["questionnaire_id"] == latest["questionnaire_id"]
                      and r["max_score"] == latest["max_score"]]
        previous = comparable[-1] if comparable else None
        delta = latest["score"] - previous["score"] if previous else None
        reasons = [f"最近一次已记录为{LEVEL_NAMES.get(latest['alert_level'], '未知')}预警"]
        if delta is not None and delta > 0:
            reasons.append(f"同量表较上次上升 {delta} 分")
        if latest["linked"] and previous and previous["alert_level"] in ("red", "orange"):
            reasons.append("连续两次筛查需要人工复核")
        output.append({
            **latest, "subject": subject, "delta": delta, "history": history,
            "reasons": reasons, "evidence_ids": [str(latest["id"])] + ([str(previous["id"])] if previous else []),
            "missing": (["缺少稳定案例关联，不能形成跨次趋势"] if not latest["linked"] else [])
                       + ["语音和图片未做心理状态自动判定"],
        })
    return sorted(output, key=lambda r: (LEVEL_ORDER.get(r["alert_level"], 4), -(r["delta"] or 0), r["subject"]))


async def tasks_for(scope):
    rows = await db.query_a(
        "SELECT * FROM agent_workspace_tasks WHERE scope=? ORDER BY due_at,id", (scope,))
    for row in rows:
        row["events"] = json.loads(row["events"])
    return rows


async def overview(scope):
    await ensure_schema()
    records = await records_for(scope)
    latest = await db.query_one_a(
        "SELECT payload FROM agent_workspace_runs WHERE scope=? ORDER BY created_at DESC,id DESC LIMIT 1",
        (scope,))
    return {
        "scope": scope, "mode": "workflow-preview", "model_connected": False,
        "latest_run": json.loads(latest["payload"]) if latest else None,
        "tasks": await tasks_for(scope),
        "available_subjects": len(compile_subjects(records)),
        "departments": sorted({r["department"] for r in records}),
    }


async def run(scope, days, department, actor):
    await ensure_schema()
    if not isinstance(days, int) or isinstance(days, bool) or days not in (7, 30, 90):
        raise HttpError(400, "请选择 7、30 或 90 天")
    if not isinstance(department, str) or len(department) > 80:
        raise HttpError(400, "院系筛选无效")
    trace = []

    def record_step(agent, tool, summary, count):
        trace.append({"agent": agent, "tool": tool, "status": "completed",
                      "at": now(), "summary": summary, "count": count})

    all_records = await records_for(scope)
    anchor = datetime(2026, 10, 13) if scope == "demo" else datetime.now(timezone.utc).replace(tzinfo=None)
    cutoff = anchor - timedelta(days=days)
    filtered = [r for r in all_records if parse_date(r["date"])
                and cutoff <= parse_date(r["date"]) <= anchor + timedelta(days=1)
                and (department == "all" or r["department"] == department)]
    record_step("证据整理", "read_completed_screenings", f"读取 {len(filtered)} 条已完成筛查；按范围过滤", len(filtered))
    # Selection uses the window; history is restricted to each latest selected
    # observation to prevent future observations leaking into historical reports.
    subjects = compile_subjects(filtered)
    distribution = dict(Counter(s["alert_level"] for s in subjects))
    record_step("群体分析", "aggregate_subjects", f"按对象去重，统计 {len(subjects)} 个对象；不混算不同量表", len(subjects))
    priority = [s for s in subjects if s["alert_level"] in ("red", "orange", "yellow")]
    record_step("个案研判", "compare_same_scale", f"{len(priority)} 个对象进入人工复核候选名单", len(priority))
    created = await propose_tasks(scope, priority, actor)
    record_step("随访规划", "propose_tasks", f"生成 {created} 条新草案，已有任务保持不变", created)
    missing = sum(not s["linked"] for s in subjects)
    payload = {
        "id": uuid.uuid4().hex, "scope": scope, "created_at": now(), "days": days,
        "department": department, "mode": "workflow-preview", "model_connected": False,
        "total": len(subjects), "records": len(filtered), "distribution": distribution,
        "priority_count": len(priority), "unlinked_count": missing,
        "summary": f"本次分析覆盖 {len(subjects)} 个对象，{distribution.get('red', 0) + distribution.get('orange', 0)} 个对象已有橙红预警，需要优先人工复核。",
        "limits": ["当前为可追踪的规则工作流，未接入大模型。",
                   "预警等级来自已完成筛查；不从图片、声音或检索相似度推断心理状况。",
                   "时间窗口变化会影响样本组成，不自动解释为群体状况改善或恶化。"],
        "subjects": [{k: v for k, v in s.items() if k != "history"} for s in subjects],
        "trace": trace,
    }
    await db.execute_a("INSERT INTO agent_workspace_runs VALUES (?,?,?,?,?)",
                       (payload["id"], scope, actor, payload["created_at"], json.dumps(payload, ensure_ascii=False)))
    return await overview(scope)


async def propose_tasks(scope, subjects, actor):
    created = 0
    for item in subjects:
        kind = "review" if item["alert_level"] in ("red", "orange") else "followup"
        title = "安排授权人员复核" if kind == "review" else "安排后续筛查"
        due = (datetime.now(timezone.utc) + timedelta(days=1 if kind == "review" else 3)).date().isoformat()
        task_id = f"{scope}:{item['subject']}:{kind}"
        event = [{"at": now(), "actor": actor, "action": "proposed",
                  "evidence_ids": item["evidence_ids"],
                  "note": "由工作流生成待审核草案；期限为演示配置，待人工调整"}]
        inserted = await db.mutate_returning_a(
            "INSERT OR IGNORE INTO agent_workspace_tasks "
            "(id,scope,subject,kind,title,state,due_at,events,created_at,updated_at) "
            "VALUES (?,?,?,?,?,'proposed',?,?,?,?) RETURNING id",
            (task_id, scope, item["subject"], kind, title, due,
             json.dumps(event, ensure_ascii=False), now(), now()))
        created += int(inserted is not None)
    return created


async def case_detail(scope, subject):
    await ensure_schema()
    subjects = compile_subjects(await records_for(scope))
    row = next((s for s in subjects if s["subject"] == subject), None)
    # Accept existing case code only when it resolves to an internal case id.
    if row is None and scope == "live":
        found = await db.query_one_a("SELECT id FROM cases WHERE case_id=?", (subject,))
        if found:
            row = next((s for s in subjects if s["subject"] == f"case:{found['id']}"), None)
    if row is None:
        raise HttpError(404, "没有已完成且关联到该案例的筛查；请先完成案例关联")
    return {**row, "tasks": [t for t in await tasks_for(scope) if t["subject"] == row["subject"]],
            "materials": [
                {"kind": "text", "title": "虚构学习日记", "source": "项目原创合成素材",
                 "text": "这周课程比较多，我想整理一下学习计划，周末和同学一起散步。"},
                {"kind": "audio", "title": "日记朗读", "source": "Windows TTS 合成，非真人录音",
                 "url": "/agent-demo/diary.wav"},
                {"kind": "image", "title": "日程记录卡", "source": "项目原创 SVG，非受试者照片",
                 "url": "/agent-demo/planner.svg"},
            ] if scope == "demo" and row["subject"] == "demo:001" else []}


async def update_task(task_id, data, actor):
    await ensure_schema()
    task = await db.query_one_a("SELECT * FROM agent_workspace_tasks WHERE id=?", (task_id,))
    if not task:
        raise HttpError(404, "任务不存在")
    action = data.get("action")
    if not isinstance(action, str):
        raise HttpError(400, "操作类型无效")
    allowed = {"proposed": {"confirm", "modify", "reject"},
               "confirmed": {"complete", "followup", "modify"}, "modified": {"complete", "followup", "modify"}}
    if action not in allowed.get(task["state"], set()):
        raise HttpError(409, "任务状态已改变，不能执行此操作")
    version = data.get("version")
    if type(version) is not int or version != task["version"]:
        raise HttpError(409, "另一位管理员已更新任务，请刷新后再处理")
    note = data.get("note", "")
    assignee = data.get("assignee", task["assignee"])
    title = data.get("title", task["title"])
    due = data.get("due_at", task["due_at"])
    if any(not isinstance(v, str) for v in (note, assignee, title, due)):
        raise HttpError(400, "任务字段格式错误")
    note, assignee, title = note.strip(), assignee.strip(), title.strip()
    if not title or len(title) > 180 or len(note) > 2000 or len(assignee) > 80:
        raise HttpError(400, "标题、负责人或记录长度不符合要求")
    if action in ("confirm", "modify") and not assignee:
        raise HttpError(400, "请填写负责人")
    if action in ("reject", "complete", "followup") and not note:
        raise HttpError(400, "请填写处理说明或随访记录")
    try:
        datetime.strptime(due, "%Y-%m-%d")
    except ValueError:
        raise HttpError(400, "日期格式应为 YYYY-MM-DD")
    state = {"confirm": "confirmed", "modify": "modified", "reject": "rejected",
             "complete": "completed", "followup": task["state"]}[action]
    events = json.loads(task["events"])
    events.append({"at": now(), "actor": actor, "action": action, "note": note,
                   "title": title, "due_at": due, "assignee": assignee})
    result = await db.mutate_returning_a(
        "UPDATE agent_workspace_tasks SET state=?,assignee=?,title=?,due_at=?,events=?,"
        "updated_at=?,version=version+1 WHERE id=? AND version=? RETURNING *",
        (state, assignee, title, due, json.dumps(events, ensure_ascii=False), now(), task_id, version))
    if not result:
        raise HttpError(409, "任务已被更新，请刷新")
    result["events"] = json.loads(result["events"])
    return result
