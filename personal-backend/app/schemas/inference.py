from typing import Literal, Optional

from pydantic import BaseModel, Field

RiskLevel = Literal["green", "yellow", "orange", "red"]

RISK_LABELS = {"green": "绿（正常）", "yellow": "黄（关注）", "orange": "橙（预警）", "red": "红（危机）"}

# 命中即直接判定红级的危机信号
CRISIS_KEYWORDS = ("自杀", "自伤", "轻生", "想死", "不想活", "活不下去")


class InferenceRequest(BaseModel):
    user_id: str = Field(min_length=1)


class MatchedDisorder(BaseModel):
    name: str
    matched_symptoms: list[str]
    matched_triggers: list[str]
    score: float = Field(description="症状匹配数 * 1.0 + 诱因匹配数 * 0.5")
    coverage: float = Field(description="已匹配症状数 / 该障碍全部症状数")


class CopingRecommendation(BaseModel):
    name: str
    category: Optional[str] = None
    suggestion: Optional[str] = None
    reason: str = Field(description="为何推荐：来自领域KG / 结合兴趣 / 用户自证有效")


class RiskReport(BaseModel):
    user_id: str
    risk_level: RiskLevel
    risk_label: str
    overall_score: float
    crisis: bool = Field(description="是否命中危机信号")
    factors: list[str] = Field(description="可解释的风险因素列表")
    matched_disorders: list[MatchedDisorder]
    recommendations: list[CopingRecommendation]
    summary: str = Field(description="报告正文（LLM 组装或模板生成）")
    disclaimer: str
    alert_created: bool = Field(description="本次推理是否自动创建了预警")
    created_at: str
    mock: bool = Field(
        default=False,
        description="是否由 Mock 通路（模板/本地记录）生成，而非图谱推理；界面据此标注演示模式",
    )


class InferenceRunResponse(BaseModel):
    """推理接口返回：报告 + 缓解推荐 Agent 生成的个性化推送内容。"""
    report: RiskReport
    content_feed: list[CopingRecommendation] = Field(
        default_factory=list,
        description="缓解推荐 Agent 输出的具体缓解内容（歌曲/资讯/文章），红级为空",
    )
