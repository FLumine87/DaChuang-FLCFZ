"""给待审数据打主题标签。

两种来源：
1. 大模型建议（管理员点"AI 建议"时调用，结果不直接落库，由人工确认）
2. 规则兜底（没有 API Key 或调用失败时，用主题词典抽取）

标签空间固定为 `THEME_KEYWORDS` 里的类别。这一点很关键：监督矩阵按标签集合
算 Jaccard，自定义标签在语料里不存在，与任何样本的相似度都是 0，加进去反而
制造噪声。所以这里只接受标准类别，不接受自由文本。
"""
import asyncio
import json
import re
import urllib.request
from typing import Dict, List, Optional

from app.config import settings
from app.engines.hashing import features as F

LABEL_SPACE: List[str] = list(F.THEME_KEYWORDS.keys())
MAX_LABELS = 3

_SYSTEM_PROMPT = (
    "你是心理筛查数据的标注助手。你的任务是从给定的主题类别中，为一条用户自述"
    "挑选最贴切的标签。只依据文本内容判断，不做诊断，不臆测文本里没有的信息。"
)


def _prompt(text: str, modality: str = "text", max_labels: int = MAX_LABELS) -> str:
    kind = {"text": "文字自述", "audio": "语音转写", "image": "图像描述"}.get(modality, "文字自述")
    return (
        f"类别只能从下面这些里选，不要新增：{'、'.join(LABEL_SPACE)}\n\n"
        f"这是一段{kind}：\n{text}\n\n"
        f"请选出最贴切的 1 到 {max_labels} 个类别。"
        "如果内容实在无法判断，返回空数组。\n"
        "只输出 JSON 数组，例如 [\"焦虑\",\"睡眠障碍\"]，不要任何解释。"
    )


def _parse(raw: str) -> List[str]:
    """从模型输出里抠出 JSON 数组，并过滤到标准类别。"""
    if not raw:
        return []
    match = re.search(r"\[[\s\S]*?\]", raw)
    if not match:
        return []
    try:
        items = json.loads(match.group(0))
    except Exception:
        return []
    if not isinstance(items, list):
        return []
    space = set(LABEL_SPACE)
    out: List[str] = []
    for item in items:
        name = str(item).strip().strip('"\'')
        if name in space and name not in out:
            out.append(name)
    return out[:MAX_LABELS]


def _call_llm(text: str, modality: str) -> str:
    url = f"{settings.DEEPSEEK_BASE_URL.rstrip('/')}/chat/completions"
    payload = {
        "model": settings.DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": _prompt(text, modality)},
        ],
        # 标注要稳定，不走创作温度
        "temperature": 0.1,
        # 当前模型是推理型，思考过程也算 token。给 200 会被 reasoning 吃光、
        # content 返回空串（finish_reason=length），所以留出足够余量。
        "max_tokens": 1200,
        "stream": False,
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {settings.DEEPSEEK_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=40) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    message = data["choices"][0].get("message") or {}
    content = message.get("content") or ""
    if content.strip():
        return content
    # 推理模型偶尔仍会把预算耗在思考上，从 reasoning 尾部兜底抓答案
    reasoning = message.get("reasoning_content") or ""
    return reasoning[-400:] if reasoning else ""


def _has_llm() -> bool:
    return bool(getattr(settings, "DEEPSEEK_API_KEY", ""))


async def suggest_labels(text: str, modality: str = "text") -> Dict:
    """给出标签建议。返回 {labels, source, reason}。

    source: llm / rule / none。调用失败一律降级到规则，不向前端抛错。
    """
    text = (text or "").strip()
    if not text:
        return {"labels": [], "source": "none", "reason": "文本为空"}
    if _has_llm():
        try:
            raw = await asyncio.to_thread(_call_llm, text, modality)
            labels = _parse(raw)
            if labels:
                return {"labels": labels, "source": "llm", "reason": ""}
        except Exception as exc:
            # 超时 / 额度 / 网络问题都走规则兜底，人工仍可手动改
            rule = F.extract_themes(text)
            return {"labels": rule[:MAX_LABELS], "source": "rule",
                    "reason": f"大模型不可用，已退回规则抽取：{type(exc).__name__}"}
    rule = F.extract_themes(text)
    return {"labels": rule[:MAX_LABELS], "source": "rule" if rule else "none",
            "reason": "" if rule else "规则词典未命中，可手动选择"}


def normalize(labels: Optional[List[str]]) -> List[str]:
    """把人工提交的标签收敛到标准类别，去重并限数。"""
    space = set(LABEL_SPACE)
    out: List[str] = []
    for item in labels or []:
        name = str(item).strip()
        if name in space and name not in out:
            out.append(name)
    return out[:MAX_LABELS]
