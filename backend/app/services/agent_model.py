"""Optional DeepSeek draft for the workspace's synthetic cases."""

import asyncio
import json
import logging
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from app.config import settings
from app.core.runtime import is_worker

logger = logging.getLogger(__name__)
TIMEOUT = 20
TEAM_GATEWAY_HOST = "zhenze-huhehaote.cmecloud.cn"


def configured() -> bool:
    key = settings.DEEPSEEK_API_KEY.strip()
    return (settings.AGENT_DEMO_DEEPSEEK_ENABLED and not settings.ENABLE_MOCK_ENGINES
            and bool(key) and key != "your-deepseek-api-key-here"
            and bool(settings.DEEPSEEK_MODEL.strip()))


async def _complete(payload: dict) -> dict:
    url = f"{settings.DEEPSEEK_BASE_URL.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {settings.DEEPSEEK_API_KEY.strip()}",
               "Content-Type": "application/json"}
    body = json.dumps(payload, ensure_ascii=False)
    if is_worker():
        from js import AbortSignal, Object, fetch
        from pyodide.ffi import to_js

        options = to_js({"method": "POST", "headers": headers, "body": body,
                         "signal": AbortSignal.timeout(TIMEOUT * 1000)},
                        dict_converter=Object.fromEntries)
        response = await fetch(url, options)
        if not response.ok:
            raise ValueError(f"Upstream HTTP {response.status}")
        return json.loads(await response.text())

    def post():
        request = Request(url, data=body.encode("utf-8"), headers=headers, method="POST")
        with urlopen(request, timeout=TIMEOUT) as response:
            return json.load(response)

    return await asyncio.wait_for(asyncio.to_thread(post), timeout=TIMEOUT)


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
    if not configured():
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
