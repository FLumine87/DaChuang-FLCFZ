from typing import Literal, Optional

from pydantic import BaseModel, Field

from ..services.clinical_lexicon import CRISIS_KEYWORDS, CRISIS_PATTERNS

RiskLevel = Literal["unknown", "green", "yellow", "orange", "red"]

RISK_LABELS = {"unknown": "图谱参考，待标准筛查", "green": "绿（正常）", "yellow": "黄（关注）", "orange": "橙（预警）", "red": "红（危机）"}

# 图谱中的待确认安全线索：不直接映射当前风险或危机结论。
# 词表定义在 clinical_lexicon（与文本直检共用一份，避免两处不同步）。
__all__ = ["CRISIS_KEYWORDS", "CRISIS_PATTERNS"]


class InferenceRequest(BaseModel):
    user_id: str = Field(min_length=1)


class MatchedDisorder(BaseModel):
    name: str
    matched_symptoms: list[str]
    matched_triggers: list[str]
    score: float = Field(description="加权匹配分：Σ 症状特异性权重 + Σ 诱因权重，见 inference_agent.W_* 常量")
    coverage: float = Field(
        description=(
            "该障碍的症状被命中比例（命中品种数 / 全部症状数），"
            "仅描述\"线索覆盖面\"，不是患病概率，也不是与本人的相似度"
        )
    )
    specificity: float = Field(
        default=0.0,
        description=(
            "命中症状的平均特异性（IDF）：越高说明命中的是越\"指向性\"的症状。"
            "用来解决\"失眠\"这类多障碍共有症状把五个障碍打成并列的问题"
        ),
    )
    raw_score: float = Field(
        default=0.0,
        description="未按特异性加权的原始匹配分，保留给需要复现历史行为的调用方",
    )


class CopingRecommendation(BaseModel):
    name: str
    category: Optional[str] = None
    suggestion: Optional[str] = None
    reason: str = Field(description="为何推荐：来自领域KG / 结合兴趣 / 用户自证有效")


class RiskReport(BaseModel):
    user_id: str
    risk_level: RiskLevel
    risk_label: str
    overall_score: float = Field(description="兼容旧客户端的图谱匹配支持分，不是经验证的心理风险评分")
    crisis: bool = Field(description="图谱或本次文本中是否存在待确认的安全线索，不等于已确认危机")
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
    reference_only: bool = Field(default=True, description="图谱只提供参考，筛查分层由主业务后端统一计算")
    crisis_verified: bool = Field(
        default=False,
        description=(
            "安全线索是否来自**本人在对话里直接表达的原文**（而非历史图谱残留）。"
            "True 才应触发危机提示与人工复核；False 表示只是图谱里的历史线索，需核实"
        ),
    )
    crisis_recent_reference: bool = Field(default=False, description="仅表示图谱线索记录较近，不代表当前状态已核实")
    crisis_sources: list[str] = Field(
        default_factory=list,
        description="命中安全线索的出处：'text'=本次文本直检、'graph'=历史图谱节点",
    )
    unmapped_terms: list[str] = Field(
        default_factory=list,
        description=(
            "未能归一、因而没有参与障碍匹配的个人症状/诱因名。"
            "如实列出而不是静默丢弃——它同时是\"词典需要补充\"的信号"
        ),
    )
    source: str = "knowledge_graph"


class InferenceRunResponse(BaseModel):
    """推理接口返回：报告 + 缓解推荐 Agent 生成的个性化推送内容。"""
    report: RiskReport
    content_feed: list[CopingRecommendation] = Field(
        default_factory=list,
        description="缓解推荐 Agent 输出的具体缓解内容（歌曲/资讯/文章），红级为空",
    )
