"""LLM 客户端：从用户文本抽取个人 KG 三元组。

优先调用 OpenAI 兼容接口；未配置 LLM_API_KEY 或开启 Mock 模式时，
退化为内置关键词抽取器，保证离线可开发、可演示。
"""

import json
import re

import httpx

from ..config import settings

SYSTEM_PROMPT = """你是个人心理知识图谱的信息抽取 Agent。从用户输入中抽取与用户本人相关的事实，只输出 JSON 数组，不要输出任何其他文字。

每个元素格式：
{{"relation": <关系>, "object": <对象名>, "value": <可选>, "category": <可选>}}

关系只能是以下之一：
- LIKES：长期稳定的喜好（音乐/歌手/运动/球队/影视/游戏/书籍/美食等），category 填类别
- FOLLOWS：持续关注的事物（赛事/球队/资讯话题/博主等），category 填类别
- EXPERIENCED_EMOTION：当下经历的情绪，value 填 1-10 的强度整数
- SHOWS_SYMPTOM：心理或躯体症状（如 失眠/焦虑/注意力下降/食欲减退）
- EXPERIENCED_EVENT：近期生活事件（如 考试/面试/分手/搬家）
- HAS_TRIGGER：会诱发负面情绪的因素（如 雨天/深夜/独处）
- RESPONDS_TO：用户尝试过的心理调节方式，value 填 有效/无效/未知

规则：
1. 只抽取输入中明确提及的事实，禁止推测。
2. 主语永远是用户本人，输出中不要再出现主语。
3. 没有可抽取的事实时输出 []。"""


def mock_mode() -> bool:
    """当前是否处于 Mock 模式（未配置 Key 或显式开启）。"""
    return settings.enable_mock_engines or not settings.llm_api_key


def chat(system: str, user: str) -> str:
    """通用对话。Mock 模式返回空串，由调用方回退到模板逻辑。"""
    return chat_messages([{"role": "system", "content": system},
                          {"role": "user", "content": user}])


def chat_messages(messages: list[dict], temperature: float = 0.7) -> str:
    """多轮对话（陪伴聊天等场景）。Mock 模式返回空串，由调用方回退到本地文案。

    messages 为 OpenAI 格式 [{"role": ..., "content": ...}, ...]。
    """
    if mock_mode():
        return ""
    url = settings.llm_base_url.rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {settings.llm_api_key}"}
    payload = {
        "model": settings.llm_model,
        "messages": messages,
        "temperature": temperature,
    }
    try:
        with httpx.Client(timeout=settings.llm_timeout, verify=settings.llm_verify_ssl) as client:
            resp = client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]
    except Exception:
        return ""


def stream_chat_messages(messages: list[dict], temperature: float = 0.7):
    """多轮对话（流式）：按需 yield 增量文本片段，边生成边出。

    OpenAI 兼容的 SSE 流：每帧 `data: {...}`，以 `data: [DONE]` 结束，
    文本在 `choices[0].delta.content`。Mock 模式不产出任何内容，
    由调用方回退到本地文案（与 chat_messages 的行为保持一致）。

    2026-10-15：上游连接中断不再静默吞掉 —— 之前 except 里直接 return，
    前端会把半截回复当成完整回复渲染（比如只收到"最近"两个字）。
    现在异常向上抛，由 SSE 层转成 error 帧通知前端自动重试。
    """
    if mock_mode():
        return
    url = settings.llm_base_url.rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {settings.llm_api_key}"}
    payload = {
        "model": settings.llm_model,
        "messages": messages,
        "temperature": temperature,
        "stream": True,
    }
    with httpx.Client(timeout=settings.llm_timeout, verify=settings.llm_verify_ssl) as client:
        with client.stream("POST", url, json=payload, headers=headers) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    return
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                text = (choices[0].get("delta") or {}).get("content")
                if text:
                    yield text


def extract_triples(text: str) -> list[dict]:
    """抽取三元组。Mock 模式或未配置 Key 时使用关键词抽取器。"""
    if settings.enable_mock_engines or not settings.llm_api_key:
        return _mock_extract(text)
    return _llm_extract(text)


def _llm_extract(text: str) -> list[dict]:
    url = settings.llm_base_url.rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {settings.llm_api_key}"}
    payload = {
        "model": settings.llm_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
        "temperature": 0,
    }
    try:
        with httpx.Client(timeout=settings.llm_timeout, verify=settings.llm_verify_ssl) as client:
            resp = client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(
            f"LLM 接口返回错误 HTTP {exc.response.status_code}: "
            f"{exc.response.text[:300]}"
        ) from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"LLM 接口连接失败: {exc}") from exc
    except (KeyError, IndexError) as exc:
        raise RuntimeError(f"LLM 接口响应格式异常: {resp.text[:300]}") from exc
    return _parse_json_array(content)


def _parse_json_array(content: str) -> list[dict]:
    match = re.search(r"\[.*\]", content, re.DOTALL)
    if not match:
        return []
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return []
    return [item for item in data if isinstance(item, dict) and "relation" in item and "object" in item]


# ---------- Mock 抽取器（离线演示用，后续由 LLM 取代） ----------

_MOCK_INTERESTS = {
    "民谣": ("民谣", "音乐"), "流行": ("流行音乐", "音乐"), "摇滚": ("摇滚乐", "音乐"),
    "周杰伦": ("周杰伦", "音乐"), "林俊杰": ("林俊杰", "音乐"), "陈奕迅": ("陈奕迅", "音乐"),
    "演唱会": ("看演唱会", "音乐"),
    "NBA": ("NBA", "体育赛事"), "篮球": ("篮球", "体育赛事"), "足球": ("足球", "体育赛事"),
    "湖人": ("洛杉矶湖人", "体育赛事"), "勇士": ("金州勇士", "体育赛事"),
    "世界杯": ("世界杯", "体育赛事"), "奥运会": ("奥运会", "体育赛事"),
    "打游戏": ("电子游戏", "游戏"), "原神": ("原神", "游戏"), "王者": ("王者荣耀", "游戏"),
    "看电影": ("看电影", "影视"), "追剧": ("追剧", "影视"),
}

_MOCK_SYMPTOMS = ["失眠", "焦虑", "抑郁", "情绪低落", "注意力下降", "注意力不集中", "食欲下降", "疲惫", "心慌", "压力大"]

_MOCK_EMOTIONS = {
    "开心": "8", "高兴": "8", "兴奋": "9", "平静": "6",
    "难过": "3", "伤心": "3", "低落": "3", "沮丧": "3",
    "焦虑": "4", "紧张": "4", "烦躁": "4", "不安": "4",
}

_MOCK_EVENTS = ["考试", "挂科", "面试", "分手", "失恋", "搬家", "开学", "毕业", "加班", "答辩"]

_MOCK_COPING = ["听歌", "跑步", "运动", "冥想", "倾诉", "写日记", "睡觉", "散步"]


def _mock_extract(text: str) -> list[dict]:
    triples: list[dict] = []
    for kw, (name, category) in _MOCK_INTERESTS.items():
        if kw in text:
            rel = "FOLLOWS" if any(w in text for w in ("关注", "追", "看直播", "看比赛", "赛季")) else "LIKES"
            triples.append({"relation": rel, "object": name, "category": category})
    for kw in _MOCK_SYMPTOMS:
        if kw in text:
            triples.append({"relation": "SHOWS_SYMPTOM", "object": kw})
    for kw, value in _MOCK_EMOTIONS.items():
        if kw in text:
            triples.append({"relation": "EXPERIENCED_EMOTION", "object": kw, "value": value})
    for kw in _MOCK_EVENTS:
        if kw in text:
            triples.append({"relation": "EXPERIENCED_EVENT", "object": kw})
    for kw in _MOCK_COPING:
        if kw in text:
            effective = "无效" if any(w in text for w in ("没用", "没什么用", "还是")) else "有效"
            triples.append({"relation": "RESPONDS_TO", "object": kw, "value": effective})
    return triples
