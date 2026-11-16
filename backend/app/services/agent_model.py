"""Optional DeepSeek draft for the workspace's synthetic cases."""

import asyncio
import json
import logging
from datetime import datetime, timezone
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from app.config import settings
from app.core.runtime import is_worker
from app.db import database as db

logger = logging.getLogger(__name__)
TIMEOUT = 20
TEAM_GATEWAY_HOST = "zhenze-huhehaote.cmecloud.cn"
SCHEMA = (
    """CREATE TABLE IF NOT EXISTS agent_model_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL DEFAULT '')""",
)


async def ensure_schema():
    for sql in SCHEMA:
        await db.execute_a(sql)


def configured() -> bool:
    """后端是否具备调用模型的凭据（与开关无关）。"""
    key = settings.DEEPSEEK_API_KEY.strip()
    return (not settings.ENABLE_MOCK_ENGINES
            and bool(key) and key != "your-deepseek-api-key-here"
            and bool(settings.DEEPSEEK_MODEL.strip()))


async def enabled() -> bool:
    """管理端模型开关；设置页未改过时回落到 AGENT_DEMO_DEEPSEEK_ENABLED（默认开启）。"""
    await ensure_schema()
    row = await db.query_one_a("SELECT enabled FROM agent_model_settings WHERE id = 1")
    if row is None:
        return bool(settings.AGENT_DEMO_DEEPSEEK_ENABLED)
    return bool(row["enabled"])


async def set_enabled(value: bool, actor: str) -> None:
    await ensure_schema()
    await db.execute_a(
        "INSERT INTO agent_model_settings (id, enabled, updated_at, updated_by) VALUES (1, ?, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled, "
        "updated_at=excluded.updated_at, updated_by=excluded.updated_by",
        (1 if value else 0, datetime.now(timezone.utc).isoformat(timespec="seconds"), actor))


async def availability() -> dict:
    """设置页与工作台共用：开关状态、凭据是否就绪、当前是否真的可调用。"""
    ready = configured()
    on = await enabled()
    return {"enabled": on, "configured": ready, "available": on and ready}


async def available() -> bool:
    """管理端 AI 研判总闸：开关开启且凭据就绪。"""
    return configured() and await enabled()


async def chat_json(messages: list, *, max_tokens: int = 900,
                    temperature: float = 0.3, timeout: int | None = None) -> dict:
    """通用 JSON 输出调用；供管理端个案/群体研判复用。"""
    hostname = urlsplit(settings.DEEPSEEK_BASE_URL).hostname
    options = {}
    if hostname in (TEAM_GATEWAY_HOST, "api.longcat.chat"):
        # 这些网关的模型默认先输出推理过程，会把 max_tokens 吃光导致 JSON 截断。
        options = {"thinking": {"type": "disabled"}}
        max_tokens = max(max_tokens, 2048)
    elif hostname == "api.deepseek.com":
        options = {"reasoning_effort": "none"}
    data = await _complete({
        "model": settings.DEEPSEEK_MODEL,
        "messages": messages,
        "response_format": {"type": "json_object"},
        "stream": False,
        "max_tokens": max_tokens,
        "temperature": temperature,
        **options,
    }, timeout=timeout)
    choice = data["choices"][0]
    if choice.get("finish_reason") != "stop":
        raise ValueError("Incomplete completion")
    content = choice["message"]["content"]
    return json.loads(content)


async def _complete(payload: dict, timeout: int | None = None) -> dict:
    url = f"{settings.DEEPSEEK_BASE_URL.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {settings.DEEPSEEK_API_KEY.strip()}",
               "Content-Type": "application/json"}
    body = json.dumps(payload, ensure_ascii=False)
    limit = timeout or TIMEOUT
    if is_worker():
        from js import AbortSignal, Object, fetch
        from pyodide.ffi import to_js

        options = to_js({"method": "POST", "headers": headers, "body": body,
                         "signal": AbortSignal.timeout(limit * 1000)},
                        dict_converter=Object.fromEntries)
        response = await fetch(url, options)
        if not response.ok:
            raise ValueError(f"Upstream HTTP {response.status}")
        return json.loads(await response.text())

    def post():
        request = Request(url, data=body.encode("utf-8"), headers=headers, method="POST")
        with urlopen(request, timeout=limit) as response:
            return json.load(response)

    return await asyncio.wait_for(asyncio.to_thread(post), timeout=limit)


def _draft(data: dict, evidence_ids: list[str]) -> dict:
    choice = data["choices"][0]
    if choice["finish_reason"] != "stop":
        raise ValueError("Incomplete completion")
    out = json.loads(choice["message"]["content"])
    if not isinstance(out, dict) or set(out) != {"summary", "review_points", "evidence_refs"}:
        raise ValueError("Invalid draft schema")

    def valid_text(value, limit):
        return isinstance(value, str) and bool(value.strip()) and len(value) <= limit

    points, refs = out["review_points"], out["evidence_refs"]
    if (not valid_text(out["summary"], 400)
            or not isinstance(points, list) or not 1 <= len(points) <= 4
            or not all(valid_text(point, 200) for point in points)
            or not isinstance(refs, list) or not refs
            or not all(isinstance(ref, str) and ref in evidence_ids for ref in refs)
            or len(set(refs)) != len(refs)):
        raise ValueError("Invalid draft fields or evidence references")
    model = data.get("model")
    return {**out, "model": model if valid_text(model, 100) else settings.DEEPSEEK_MODEL}


async def case_draft(scope: str, case: dict) -> dict:
    if scope != "demo" or case.get("source") != "synthetic":
        return {"status": "live_rules"}
    if not configured() or not await enabled():
        return {"status": "disabled"}

    # Send only fixed synthetic measurements and request-local evidence labels.
    by_ref = {
        f"E{i}": row for i, row in enumerate(
            (row for row in case["history"] if str(row["id"]) in case["evidence_ids"]), start=1)
    }
    evidence = [
        {"ref": ref, "score": row["score"], "max_score": row["max_score"]}
        for ref, row in by_ref.items()
    ]
    prompt_data = {"scale": "PHQ-9", "recorded_level": case["alert_level"],
                   "same_scale_delta": case["delta"], "screenings_oldest_first": evidence}
    try:
        hostname = urlsplit(settings.DEEPSEEK_BASE_URL).hostname
        model_options = {"max_tokens": 650}
        if hostname == TEAM_GATEWAY_HOST:
            # This gateway counts reasoning against max_tokens; its default thinking
            # mode can cut the required JSON short even on a small synthetic case.
            model_options = {"max_tokens": 2048, "thinking": {"type": "disabled"}}
        elif hostname == "api.deepseek.com":
            model_options["reasoning_effort"] = "none"
        data = await _complete({
            "model": settings.DEEPSEEK_MODEL,
            "messages": [
                {"role": "system", "content":
                 "根据虚构筛查数据，为授权工作人员写中文复核草案。仅说明已给的筛查事实、"
                 "证据不足和可核对的问题。沿用已有预警，不诊断、不建议用药或治疗、"
                 "不编造原始作答、病史或联系时限。只输出 JSON，格式示例："
                 '{"summary":"筛查摘要","review_points":["请核对原始量表"],"evidence_refs":["E1"]}。'
                 "引用必须是输入内的证据编号。"},
                {"role": "user", "content": json.dumps(prompt_data, ensure_ascii=False)},
            ],
            "response_format": {"type": "json_object"},
            "stream": False,
            **model_options,
        })
        result = _draft(data, list(by_ref))
        result["evidence_refs"] = [str(by_ref[ref]["id"]) for ref in result["evidence_refs"]]
        return {"status": "generated", "draft": result}
    except Exception as exc:
        # Do not log credentials, prompts or upstream response content.
        logger.warning("Workspace DeepSeek draft unavailable (%s)", type(exc).__name__)
        return {"status": "unavailable"}
