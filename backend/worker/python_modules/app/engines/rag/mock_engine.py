from datetime import datetime
from typing import Dict, List

from app.engines.rag.interface import RAGEngineInterface


class MockRAGEngine(RAGEngineInterface):
    """
    RAG分析引擎的Mock实现
    
    此实现返回模板化的分析报告，用于开发和测试。
    后续可替换为真实的RAG引擎实现（接入LLM API）。
    """
    
    MOCK_KNOWLEDGE = [
        {
            "title": "PHQ-9抑郁量表评估指南",
            "content": "PHQ-9得分0-4分为无抑郁症状，5-9分为轻度抑郁，10-14分为中度抑郁，15-19分为中重度抑郁，20-27分为重度抑郁。",
        },
        {
            "title": "GAD-7焦虑量表评估指南",
            "content": "GAD-7得分0-4分为无焦虑症状，5-9分为轻度焦虑，10-14分为中度焦虑，15-21分为重度焦虑。",
        },
        {
            "title": "危机干预流程",
            "content": "对于高风险个案，应立即启动危机干预流程：1.评估风险等级 2.通知相关人员 3.安排专业评估 4.制定干预计划 5.持续跟踪。",
        },
    ]
    
    RISK_TEMPLATES = {
        "high": {
            "summary": "综合多模态数据分析，该被试呈现明显的心理问题特征，需要高度关注和及时干预。",
            "sections": [
                {
                    "title": "量表分析",
                    "content": "得分处于高风险区间，多项指标超过临界值，提示存在明显的心理问题。建议进一步专业评估。",
                },
                {
                    "title": "跨模态特征匹配",
                    "content": "通过动态跨模态哈希检索，匹配到多个高相似度历史案例。检索结果提示当前案例具有较高的风险特征，需要重点关注。",
                },
                {
                    "title": "综合评估结论",
                    "content": "基于RAG分析引擎综合以上多维度信息，结合知识库中的临床指南和循证数据，评估该被试当前处于高风险状态，存在进一步恶化的可能。建议立即安排专业心理咨询师进行面谈评估。",
                },
            ],
            "recommendations": [
                "立即安排专业心理咨询师一对一面谈",
                "评估自伤/自杀风险，必要时启动危机干预流程",
                "通知辅导员和院系相关负责人",
                "建议每周至少一次跟踪评估",
                "考虑转介至专业精神卫生机构",
            ],
        },
        "medium": {
            "summary": "综合分析显示该被试存在一定的心理问题倾向，建议进行进一步评估和关注。",
            "sections": [
                {
                    "title": "量表分析",
                    "content": "得分处于中等风险区间，部分指标超过临界值，提示存在一定的心理问题。建议持续关注。",
                },
                {
                    "title": "跨模态特征匹配",
                    "content": "检索到若干相似案例，特征匹配度中等。建议结合其他信息综合判断。",
                },
                {
                    "title": "综合评估结论",
                    "content": "评估该被试当前处于中等风险状态，建议安排专业心理咨询师进行评估，制定适当的干预计划。",
                },
            ],
            "recommendations": [
                "安排心理咨询师进行面谈评估",
                "制定个性化关注计划",
                "定期跟踪评估心理状态变化",
                "建立支持网络，提供必要的帮助资源",
            ],
        },
        "low": {
            "summary": "综合分析显示该被试心理状态基本正常，建议保持关注。",
            "sections": [
                {
                    "title": "量表分析",
                    "content": "得分处于正常范围，各项指标未超过临界值，心理状态基本健康。",
                },
                {
                    "title": "跨模态特征匹配",
                    "content": "检索结果未发现明显的高风险特征匹配。",
                },
                {
                    "title": "综合评估结论",
                    "content": "评估该被试当前心理状态良好，建议保持常规关注，如有变化及时评估。",
                },
            ],
            "recommendations": [
                "保持常规关注",
                "提供心理健康知识普及",
                "如有需要可主动寻求帮助",
            ],
        },
    }
    
    def __init__(self):
        self._initialized = False
    
    async def initialize(self) -> None:
        self._initialized = True
    
    async def health_check(self) -> bool:
        return self._initialized
    
    async def retrieve(self, query: str, top_k: int = 5) -> List[Dict]:
        return self.MOCK_KNOWLEDGE[:top_k]
    
    async def generate_report(self, screening_data: Dict) -> Dict:
        score = screening_data.get("score", 0)
        max_score = screening_data.get("max_score", 100)
        alert_level = screening_data.get("alert_level", "green")
        
        if alert_level in ["red", "orange"]:
            risk_level = "high"
        elif alert_level == "yellow":
            risk_level = "medium"
        else:
            risk_level = "low"
        
        template = self.RISK_TEMPLATES[risk_level]
        
        questionnaire = screening_data.get("questionnaire", "量表")
        name = screening_data.get("name", "被试")
        
        sections = []
        for section in template["sections"]:
            content = section["content"]
            if "量表" in content or "得分" in content:
                content = content.replace("得分", f"{questionnaire}得分{score}分（满分{max_score}分）")
            sections.append({
                "title": section["title"],
                "content": content,
            })
        
        return {
            "subject": name,
            "date": datetime.now().strftime("%Y-%m-%d"),
            "summary": template["summary"],
            "risk_level": risk_level,
            "sections": sections,
            "recommendations": template["recommendations"],
        }
    
    async def add_to_knowledge_base(self, documents: List[Dict]) -> bool:
        return True
