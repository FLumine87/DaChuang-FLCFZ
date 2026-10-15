"""AI 陪伴对话（Companion Chat）的请求/响应模型。

真实模式：后端调 LLM 生成支持性回应（可携带用户个人 KG 做个性化上下文）；
Mock 模式 / LLM 不可用：返回 mock=True + 空回复，前端回退到本地兜底文案。
"""

from pydantic import BaseModel, Field


class ChatTurn(BaseModel):
    """一轮历史对话。role 仅允许 user / assistant。"""

    role: str = Field(pattern="^(user|assistant)$")
    text: str


class CompanionChatRequest(BaseModel):
    user_id: str
    message: str = Field(min_length=1, max_length=4000)
    # 最近几轮对话（不含本轮 user 消息），前端截断后传入
    history: list[ChatTurn] = Field(default_factory=list, max_length=12)


class CompanionChatResponse(BaseModel):
    user_id: str
    # mock=True 时 reply 为空串，前端用本地兜底文案并如实标注来源
    reply: str = ""
    mock: bool
    # 本轮回复是否用上了个人知识图谱上下文
    kg_context_used: bool = False
