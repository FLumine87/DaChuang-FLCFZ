"""管理端 AI 研判：去标识化证据构造、模型调用、输出校验与调用审计。

两条链路共用本模块：
    · 个案：问卷历史 + 多模态材料摘要 → 个案分析草案
    · 群体：规则统计聚合 + 匿名主体 → 群体总结与异常提示

边界：
    · 只发送白名单字段，姓名/电话/学号/案例编号/文件名一律不出现；
    · 多模态只发文本内容、描述与检索结论摘要，不发原始文件；
    · 模型只做归纳与建议，不改变预警等级，不自动创建任务。
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
import uuid
from datetime import datetime, timezone

from app.config import settings
from app.db import database as db
from app.services import agent_model

SCHEMA = (
    """CREATE TABLE IF NOT EXISTS agent_model_calls (
        id TEXT PRIMARY KEY, scope TEXT, subject_ref TEXT, purpose TEXT,
        status TEXT, model TEXT, latency_ms INTEGER, error_type TEXT,
        created_at TEXT)""",
)

KIND_LABELS = {"text": "文本补充", "audio": "语音片段", "image": "图片"}
RISK_LEVELS = ("red", "orange", "yellow")

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
_ID_CARD = re.compile(r"\d{17}[\dXx]")
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE = re.compile(r"1[3-9]\d{9}")
_LONG_DIGITS = re.compile(r"\d{11,}")

SYSTEM_INDIVIDUAL = (
    "你是学校心理筛查辅助分析助手。只依据输入的问卷历史与多模态材料摘要做归纳。"
    "不得诊断疾病、不得判断病情严重程度、不得建议用药或治疗，不得更改已有预警等级，"
    "不得编造未提供的细节。多模态材料只作为补充线索，不能根据图片或语音推断情绪或心理状态。"
    "写作要求：结论优先。summary 用 2-3 句给出核心结论，不要逐条复述分数；"
    "basis 只用一句话说明参考了哪些量表与材料类型（如“3 次 PHQ-9、1 次 PSS-10、8 条文本补充”），"
    "不要出现 S1/M1 等编号、相似度或检索命中细节；findings 写 3-5 条发现结论，每条一句话，不复述原始数据；"
    "recommendations 写 2-4 条可执行建议。"
    "只输出 JSON，格式为："
    '{"summary":"结论摘要","basis":"参考依据概述","findings":["发现结论"],'
    '"recommendations":["处置建议"],"evidence_refs":["S1","M1"]}。'
    "引用必须是输入中真实存在的编号。"
)

SYSTEM_GROUP = (
    "你是学校心理筛查辅助分析助手。只依据给定的群体统计与匿名主体信息做归纳。"
    "不得诊断疾病、不得判断个人病情、不得建议用药或治疗，不得更改已有预警等级，"
    "不得编造未提供的细节，不得尝试还原匿名主体的身份。"
    "只输出 JSON，格式为："
    '{"overview":"群体总体情况","key_findings":["关键发现"],"anomalies":["异常提示"],'
    '"department_focus":["院系关注点"],"suggested_actions":["管理建议"],"limits":["数据局限"]}。'
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


async def ensure_schema() -> None:
    for sql in SCHEMA:
        await db.execute_a(sql)


def scrub_pii(text, names=None) -> str:
    """尽力掩码自由文本里的手机号、证件号、邮箱与超长数字。"""
    if not isinstance(text, str):
        return ""
    text = _CONTROL.sub("", text)
    for name in names or []:
        if isinstance(name, str) and len(name.strip()) >= 2:
            text = text.replace(name.strip(), "某同学")
    text = _ID_CARD.sub("[证件号已隐去]", text)
    text = _EMAIL.sub("[邮箱已隐去]", text)
    text = _PHONE.sub("[电话已隐去]", text)
    text = _LONG_DIGITS.sub("[数字已隐去]", text)
    return text


def _text(value, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return _CONTROL.sub("", value).strip()[:limit]


def _subject_ref(value) -> str:
    key = (getattr(settings, "AGENT_PSEUDONYM_KEY", "") or "").strip()
    if not key or not value:
        return "匿名个案"
    digest = hmac.new(key.encode("utf-8"), str(value).encode("utf-8"),
                      hashlib.sha256).hexdigest()[:12]
    return f"subject-{digest}"


def _parse_analysis(value) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except (ValueError, TypeError):
            return {}
    return {}


def build_multimodal_evidence(materials, limit: int | None = None):
    """把材料转成脱敏的多模态证据摘要与覆盖统计。

    返回 (evidence, coverage)。evidence 最多 limit 条；coverage 统计全部材料。
    """
    limit = settings.AGENT_AI_MAX_MATERIALS if limit is None else limit
    coverage = {"text": 0, "audio": 0, "image": 0}
    evidence = []
    counters = {"text": 0, "audio": 0, "image": 0}
    for item in materials or []:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "").lower()
        if kind not in KIND_LABELS:
            continue
        coverage[kind] += 1
        if len(evidence) >= limit:
            continue
        counters[kind] += 1
        raw = item.get("text") or item.get("description") or ""
        content = scrub_pii(raw)[:400].strip() or "（无文字描述）"
        entry = {
            "ref": f"M{len(evidence) + 1}",
            "kind": kind,
            "label": f"{KIND_LABELS[kind]} {counters[kind]}",
            "content": content,
        }
        analysis = _parse_analysis(item.get("analysis"))
        if analysis:
            hits = analysis.get("hits")
            entry["retrieval"] = {
                "level": analysis.get("level") or analysis.get("levelLabel") or "",
                "conclusion": _text(analysis.get("conclusion"), 200),
                "hit_count": analysis.get("hit_count") if isinstance(
                    analysis.get("hit_count"), int) else (
                    len(hits) if isinstance(hits, list) else 0),
            }
        evidence.append(entry)
    return evidence, coverage


def _same_scale_delta(history, index: int):
    current = history[index]
    for previous in history[index + 1:]:
        if (previous.get("questionnaire_id") == current.get("questionnaire_id")
                and previous.get("max_score") == current.get("max_score")):
            try:
                return current["score"] - previous["score"]
            except (KeyError, TypeError):
                return None
    return None


def build_individual_input(case: dict) -> dict:
    """构造个案 AI 输入：只保留白名单字段。"""
    history = [row for row in (case.get("history") or []) if isinstance(row, dict)]
    history.sort(key=lambda row: str(row.get("date") or ""), reverse=True)
    screenings = []
    for index, row in enumerate(history[:5]):
        screenings.append({
            "ref": f"S{index + 1}",
            "questionnaire": _text(row.get("questionnaire"), 60) or "量表",
            "score": row.get("score"),
            "max_score": row.get("max_score"),
            "level": str(row.get("alert_level") or "green"),
            "delta": _same_scale_delta(history, index),
        })
    previous_level = history[1].get("alert_level") if len(history) > 1 else None
    multimodal, coverage = build_multimodal_evidence(case.get("materials"))
    missing = [_text(item, 80) for item in (case.get("missing") or [])
               if isinstance(item, str) and item.strip()][:4]
    return {
        "subject_ref": _subject_ref(case.get("subject")),
        "current": {
            "level": str(case.get("alert_level") or "green"),
            "score": case.get("score"),
            "max_score": case.get("max_score"),
        },
        "trend": {"delta": case.get("delta"), "previous_level": previous_level},
        "screenings": screenings,
        "multimodal": multimodal,
        "coverage": coverage,
        "missing": missing,
    }


def _avg(values):
    values = [v for v in values if isinstance(v, (int, float))]
    return round(sum(values) / len(values), 1) if values else None


def build_group_input(run: dict) -> dict:
    """构造群体 AI 输入：聚合统计 + 匿名主体，不出现 case/screening 编号。"""
    subjects = [row for row in (run.get("subjects") or []) if isinstance(row, dict)]
    trend = {"rising": 0, "flat": 0, "falling": 0, "no_history": 0}
    by_department = {}
    for row in subjects:
        delta = row.get("delta")
        if delta is None:
            trend["no_history"] += 1
        elif delta > 0:
            trend["rising"] += 1
        elif delta < 0:
            trend["falling"] += 1
        else:
            trend["flat"] += 1
        name = _text(row.get("department"), 40) or "未分组"
        bucket = by_department.setdefault(
            name, {"subjects": 0, "red_orange": 0, "deltas": []})
        bucket["subjects"] += 1
        if row.get("alert_level") in ("red", "orange"):
            bucket["red_orange"] += 1
        if delta is not None:
            bucket["deltas"].append(delta)

    minimum = settings.AGENT_AI_MIN_DEPT_SIZE
    departments, other = [], {"subjects": 0, "red_orange": 0, "deltas": []}
    for name, bucket in sorted(by_department.items(), key=lambda kv: -kv[1]["subjects"]):
        if bucket["subjects"] < minimum:
            for key in ("subjects", "red_orange"):
                other[key] += bucket[key]
            other["deltas"].extend(bucket["deltas"])
            continue
        departments.append({
            "name": name,
            "subjects": bucket["subjects"],
            "red_orange": bucket["red_orange"],
            "avg_delta": _avg(bucket["deltas"]),
        })
    if other["subjects"]:
        departments.append({
            "name": "其他",
            "subjects": other["subjects"],
            "red_orange": other["red_orange"],
            "avg_delta": _avg(other["deltas"]),
        })

    priority = [row for row in subjects if row.get("alert_level") in RISK_LEVELS]
    priority = priority[:settings.AGENT_AI_MAX_SUBJECTS]
    anonymous = []
    for index, row in enumerate(priority, start=1):
        anonymous.append({
            "ref": f"对象{index:02d}",
            "level": str(row.get("alert_level") or ""),
            "score": row.get("score"),
            "max_score": row.get("max_score"),
            "delta": row.get("delta"),
            "media": [item for item in (row.get("media") or [])
                      if item in KIND_LABELS],
            "reasons": [scrub_pii(item, None)[:80] for item in (row.get("reasons") or [])
                        if isinstance(item, str)][:4],
        })

    return {
        "window_days": run.get("days"),
        "department_scope": _text(run.get("department"), 40) or "all",
        "totals": {
            "subjects": run.get("total"),
            "records": run.get("records"),
            "priority": run.get("priority_count"),
            "unlinked": run.get("unlinked_count"),
        },
        "distribution": run.get("distribution") or {},
        "trend": trend,
        "departments": departments,
        "priority_subjects": anonymous,
    }


def _string_list(value, minimum: int, maximum: int, limit: int) -> list:
    if not isinstance(value, list):
        return []
    cleaned = []
    for item in value:
        if isinstance(item, str) and item.strip():
            cleaned.append(_CONTROL.sub("", item).strip()[:limit])
        if len(cleaned) >= maximum:
            break
    return cleaned if len(cleaned) >= minimum else []


def _validate_individual(data, allowed_refs) -> dict:
    if not isinstance(data, dict):
        raise ValueError("draft is not an object")
    summary = _text(data.get("summary"), 300)
    if not summary:
        raise ValueError("missing summary")
    basis = _text(data.get("basis"), 160)
    findings = _string_list(data.get("findings"), 1, 5, 100)
    recommendations = _string_list(data.get("recommendations"), 1, 4, 100)
    if not findings or not recommendations:
        raise ValueError("missing findings or recommendations")
    refs = []
    for item in data.get("evidence_refs") or []:
        if isinstance(item, str) and item in allowed_refs and item not in refs:
            refs.append(item)
    return {
        "summary": summary,
        "basis": basis,
        "findings": findings,
        "recommendations": recommendations,
        "evidence_refs": refs[:6],
    }


def _basis_text(payload: dict) -> str:
    """模型没给依据概述时的兜底：只说明用了哪些量表与材料，不展开细节。"""
    parts = []
    if payload.get("screenings"):
        parts.append(f"{len(payload['screenings'])} 次量表筛查")
    coverage = payload.get("coverage") or {}
    for kind, label in (("text", "文本补充"), ("audio", "语音片段"), ("image", "图片")):
        count = int(coverage.get(kind) or 0)
        if count:
            parts.append(f"{count} 条{label}")
    return "、".join(parts) or "本次没有可用材料"


def _strip_ref_codes(text: str) -> str:
    """去掉依据概述里的 S1/M1 编号，只保留“用了什么”。"""
    text = re.sub(r"[（(]\s*[SM]\d+(?:\s*[、,，\-–~至]\s*[SM]?\d+)*\s*[）)]", "", text)
    text = re.sub(r"\b[SM]\d+\b", "", text)
    text = re.sub(r"[（(]\s*[）)]", "", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip(" ，,；;、")


def _validate_group(data) -> dict:
    if not isinstance(data, dict):
        raise ValueError("summary is not an object")
    overview = _text(data.get("overview"), 400)
    if not overview:
        raise ValueError("missing overview")
    findings = _string_list(data.get("key_findings"), 1, 5, 120)
    if not findings:
        raise ValueError("missing key findings")
    limits = _string_list(data.get("limits"), 1, 3, 120)
    if not limits:
        limits = ["AI 总结基于规则统计，不能替代人工研判。"]
    return {
        "overview": overview,
        "key_findings": findings,
        "anomalies": _string_list(data.get("anomalies"), 0, 4, 120),
        "department_focus": _string_list(data.get("department_focus"), 0, 3, 120),
        "suggested_actions": _string_list(data.get("suggested_actions"), 1, 4, 120),
        "limits": limits,
    }


async def _audit(scope, subject_ref, purpose, status, latency_ms, error_type) -> None:
    """调用审计失败不影响研判主流程。"""
    try:
        await ensure_schema()
        await db.execute_a(
            "INSERT INTO agent_model_calls VALUES (?,?,?,?,?,?,?,?,?)",
            (uuid.uuid4().hex, scope, subject_ref, purpose, status,
             settings.DEEPSEEK_MODEL, int(latency_ms), error_type or "", _now()))
    except Exception:  # noqa: BLE001 - 审计是旁路，不能阻塞研判
        pass


def _result(status, payload_key, payload, started) -> dict:
    result = {
        "status": status,
        "model": settings.DEEPSEEK_MODEL,
        "latency_ms": int((time.monotonic() - started) * 1000),
        "generated_at": _now() if status == "generated" else None,
    }
    if payload is not None:
        result[payload_key] = payload
    return result


async def individual_analysis(scope: str, case: dict) -> dict:
    started = time.monotonic()
    if not agent_model.configured():
        return _result("not_configured", "draft", None, started)
    if not await agent_model.enabled():
        return _result("disabled", "draft", None, started)

    payload = build_individual_input(case)
    allowed = {row["ref"] for row in payload["screenings"]}
    allowed.update(row["ref"] for row in payload["multimodal"])
    try:
        data = await agent_model.chat_json(
            [{"role": "system", "content": SYSTEM_INDIVIDUAL},
             {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
            max_tokens=900, timeout=settings.AGENT_AI_TIMEOUT_SECONDS)
        draft = _validate_individual(data, allowed)
        if not draft["basis"]:
            draft["basis"] = _basis_text(payload)
        else:
            draft["basis"] = _strip_ref_codes(draft["basis"])
        latency = int((time.monotonic() - started) * 1000)
        await _audit(scope, payload["subject_ref"], "individual", "generated", latency, "")
        return _result("generated", "draft", draft, started)
    except Exception as exc:  # noqa: BLE001 - 模型异常一律降级，不阻塞规则研判
        latency = int((time.monotonic() - started) * 1000)
        await _audit(scope, payload["subject_ref"], "individual", "unavailable",
                     latency, type(exc).__name__)
        return _result("unavailable", "draft", None, started)


async def group_analysis(scope: str, run: dict) -> dict:
    started = time.monotonic()
    if not agent_model.configured():
        return _result("not_configured", "summary", None, started)
    if not await agent_model.enabled():
        return _result("disabled", "summary", None, started)

    payload = build_group_input(run)
    try:
        data = await agent_model.chat_json(
            [{"role": "system", "content": SYSTEM_GROUP},
             {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
            max_tokens=1200, timeout=settings.AGENT_AI_TIMEOUT_SECONDS)
        summary = _validate_group(data)
        latency = int((time.monotonic() - started) * 1000)
        await _audit(scope, "group", "group", "generated", latency, "")
        return _result("generated", "summary", summary, started)
    except Exception as exc:  # noqa: BLE001
        latency = int((time.monotonic() - started) * 1000)
        await _audit(scope, "group", "group", "unavailable", latency, type(exc).__name__)
        return _result("unavailable", "summary", None, started)
