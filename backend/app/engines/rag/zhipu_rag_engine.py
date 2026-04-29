from datetime import datetime
from typing import Dict, List
import re

from app.engines.rag.interface import RAGEngineInterface
from app.config import settings

try:
    from zai import ZhipuAiClient
    ZHIPU_AVAILABLE = True
except ImportError:
    ZHIPU_AVAILABLE = False


class ZhipuRAGEngine(RAGEngineInterface):
    """
    基于智谱AI的RAG分析引擎实现
    
    使用智谱AI的glm-4.7模型生成专业的心理筛查分析报告
    """
    
    KNOWLEDGE_BASE = [
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
        {
            "title": "心理评估伦理准则",
            "content": "所有心理评估应遵循保密原则、知情同意原则、专业胜任原则和避免伤害原则。评估结果仅供专业参考，不能替代临床诊断。",
        },
    ]
    
    def __init__(self):
        self._initialized = False
        self._client = None
    
    async def initialize(self) -> None:
        if ZHIPU_AVAILABLE and settings.ZHIPUAI_API_KEY:
            self._client = ZhipuAiClient(api_key=settings.ZHIPUAI_API_KEY)
        self._initialized = True
    
    async def health_check(self) -> bool:
        if not self._initialized:
            return False
        if not ZHIPU_AVAILABLE:
            return False
        if not settings.ZHIPUAI_API_KEY:
            return False
        return True
    
    async def retrieve(self, query: str, top_k: int = 5) -> List[Dict]:
        """
        从知识库检索相关文档
        """
        results = []
        for doc in self.KNOWLEDGE_BASE:
            if query.lower() in doc["title"].lower() or query.lower() in doc["content"].lower():
                results.append(doc)
                if len(results) >= top_k:
                    break
        return results if results else self.KNOWLEDGE_BASE[:top_k]
    
    async def generate_report(self, screening_data: Dict) -> Dict:
        """
        使用智谱AI生成智能分析报告
        """
        if not ZHIPU_AVAILABLE or not self._client:
            return self._fallback_report(screening_data)
        
        score = screening_data.get("score", 0)
        max_score = screening_data.get("max_score", 100)
        alert_level = screening_data.get("alert_level", "green")
        questionnaire = screening_data.get("questionnaire", "量表")
        name = screening_data.get("name", "被试")
        
        knowledge = await self.retrieve(f"{questionnaire} {alert_level}", top_k=3)
        knowledge_text = "\n".join([f"{doc['title']}: {doc['content']}" for doc in knowledge])
        
        prompt = f"""你是一名专业的心理健康评估专家。请根据以下信息生成一份心理筛查分析报告。

【被试信息】
姓名：{name}
测评量表：{questionnaire}
得分：{score}分（满分{max_score}分）
预警等级：{alert_level}

【参考知识库】
{knowledge_text}

请按照以下结构生成JSON格式的报告：
{{
    "subject": "被试姓名",
    "date": "YYYY-MM-DD",
    "summary": "综合分析摘要",
    "risk_level": "high/medium/low",
    "sections": [
        {{"title": "量表分析", "content": "详细的量表得分分析"}},
        {{"title": "风险评估", "content": "基于得分的风险等级判断"}},
        {{"title": "综合评估结论", "content": "全面的评估结论"}}
    ],
    "recommendations": [
        "建议1",
        "建议2",
        "建议3"
    ]
}}

请直接返回JSON，不要包含其他文字。"""
        
        try:
            response = self._client.chat.completions.create(
                model=settings.ZHIPUAI_MODEL,
                messages=[{"role": "user", "content": prompt}],
                thinking={"type": "enabled"} if settings.ZHIPUAI_ENABLE_THINKING else None,
                max_tokens=settings.ZHIPUAI_MAX_TOKENS,
                temperature=settings.ZHIPUAI_TEMPERATURE
            )
            
            content = response.choices[0].message.content
            report = self._parse_json_response(content)
            
            if report:
                report["subject"] = name
                report["date"] = datetime.now().strftime("%Y-%m-%d")
                return report
            
        except Exception as e:
            print(f"智谱AI调用失败: {e}")
        
        return self._fallback_report(screening_data)
    
    async def add_to_knowledge_base(self, documents: List[Dict]) -> bool:
        """
        添加文档到知识库
        """
        for doc in documents:
            self.KNOWLEDGE_BASE.append(doc)
        return True
    
    def _fallback_report(self, screening_data: Dict) -> Dict:
        """
        当AI调用失败时的降级报告
        """
        from app.engines.rag.mock_engine import MockRAGEngine
        mock = MockRAGEngine()
        return mock.generate_report(screening_data)
    
    def _parse_json_response(self, content: str) -> Dict:
        """
        解析AI返回的JSON
        """
        try:
            import json
            match = re.search(r'\{[\s\S]*\}', content)
            if match:
                return json.loads(match.group())
        except Exception as e:
            print(f"JSON解析失败: {e}")
        return None
