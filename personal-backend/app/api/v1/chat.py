"""AI 陪伴对话路由。

此前前端「AI 陪伴对话」的回复一直是本地随机兜底文案（从未经过大模型），
用户配置 API 后也"无法实现 AI 对话"。本路由补上真正的对话链路：

    POST /api/v1/chat/companion
      - 真实模式：拼装 system 人设 + 个人 KG 上下文 + 最近对话历史，
        调 OpenAI 兼容接口生成支持性回应；
      - Mock 模式：返回 mock=True + 空回复，前端回退本地文案并如实标注；
      - LLM 调用失败：502，前端同样回退本地文案并提示。

三元组抽取仍由前端另行调用 /kg/extract，与本接口互不阻塞。
"""

from fastapi import APIRouter, HTTPException

from ...schemas.chat import CompanionChatRequest, CompanionChatResponse
from ...services import kg_service
from ...services.llm_client import chat_messages, mock_mode

router = APIRouter(tags=["companion-chat"])

COMPANION_SYSTEM_PROMPT = """你是「心晴伙伴」，一位温暖的 AI 心理陪伴助手，陪伴大学生和年轻人聊聊近况。

回应原则：
1. 共情先行：先接住对方的情绪，再自然展开；不评判、不说教。
2. 简短真诚：一次回复 2-4 句话（50-150 字），像朋友聊天，不写小作文。
3. 善用倾听：可以温和地提一个开放式问题帮助对方表达，但一次最多问一个问题。
4. 个性化：如果给你提供了用户的兴趣或近况（来自个人知识图谱），可以在自然合适时提及，让对方感到被记住；不要生硬罗列。
5. 安全边界：你不做心理诊断，不评价量表，不建议任何药物；如果对方流露自伤、自杀念头或描述危机处境，用温和而坚定的语气建议立即联系信任的人、学校心理中心或心理援助热线（如全国 24 小时心理援助热线 12356）。
6. 用简体中文回复，语气温暖自然，避免 AI 腔和排比句。"""


def _kg_context(user_id: str) -> tuple[str, bool]:
    """把用户个人 KG 摘要拼成一段提示词；不可用时返回空串。"""
    try:
        graph = kg_service.get_subgraph(user_id)
    except Exception:
        return "", False
    if not graph.get("neo4j_connected"):
        return "", False
    seen: list[str] = []
    for link in graph.get("links", [])[:20]:
        target = (link.get("target") or "").split(":", 1)[-1]
        relation = link.get("relation") or ""
        category = link.get("category")
        if not target or not relation:
            continue
        piece = f"{relation}:{target}" + (f"({category})" if category else "")
        if piece not in seen:
            seen.append(piece)
    if not seen:
        return "", False
    return "以下是已记录的该用户个人知识图谱信息（供自然提及，禁止生硬罗列）：" + "；".join(seen), True


@router.post("/chat/companion", response_model=CompanionChatResponse)
def companion_chat(body: CompanionChatRequest) -> CompanionChatResponse:
    mock = mock_mode()
    kg_prompt, kg_used = _kg_context(body.user_id)
    if mock:
        # Mock（离线演示）模式：不假装是大模型，交给前端本地兜底
        return CompanionChatResponse(user_id=body.user_id, reply="", mock=True, kg_context_used=False)

    messages: list[dict] = [
        {"role": "system", "content": COMPANION_SYSTEM_PROMPT + (f"\n\n{kg_prompt}" if kg_prompt else "")}
    ]
    for turn in body.history:
        messages.append({"role": turn.role, "content": turn.text})
    messages.append({"role": "user", "content": body.message})

    reply = chat_messages(messages)
    if not reply.strip():
        # 非 mock 却拿不到回复 = LLM 调用失败（网络/鉴权/格式），让前端走兜底并提示
        raise HTTPException(status_code=502, detail="LLM 对话接口调用失败，请检查 personal-backend/.env 的 LLM_* 配置")
    return CompanionChatResponse(user_id=body.user_id, reply=reply.strip(), mock=False, kg_context_used=kg_used)
