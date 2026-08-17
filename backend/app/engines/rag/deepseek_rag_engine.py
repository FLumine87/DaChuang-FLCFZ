"""
基于 DeepSeek 的 RAG 分析引擎（真实实现）。

生成：调用 DeepSeek 的 OpenAI 兼容 Chat Completion 接口（deepseek-chat），
      使用标准库 urllib 实现，不引入任何第三方依赖。
检索：本地零依赖的 TF-IDF 向量检索（复用项目 hashing/features.py 的文本
      特征分词器保持一致），对知识库文档做余弦相似度 top-k 召回。
降级：未配置 DEEPSEEK_API_KEY 或调用失败时，自动降级为 MockRAGEngine 报告，
      保证服务可启动、可演示，绝不会因外部 API 问题而崩溃。
"""
import asyncio
import json
import urllib.request
from datetime import datetime
from typing import Dict, List

from app.engines.rag.interface import RAGEngineInterface
from app.config import settings

# 复用项目已有的文本特征分词器，保持特征口径一致（纯标准库、零依赖）
from app.engines.hashing import features as F


# ----------------------------- 知识库 -----------------------------
# 可自行通过 add_to_knowledge_base() 扩展；检索基于这些文档的 TF 向量余弦相似度。
KNOWLEDGE_BASE: List[Dict] = [
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
    {
        "title": "自杀风险识别与干预",
        "content": "当个体出现自杀意念、自杀计划或既往自杀尝试时，应视为高风险。立即进行风险评估，移除可获取的危险手段，联系精神科专业人员与紧急求助渠道，并建立持续随访。",
    },
    {
        "title": "转介与随访流程",
        "content": "对于超出校内心理咨询能力范围（如中重度抑郁、焦虑或自杀风险）的个案，应及时转介至精神卫生专业机构，并在转介后保持定期随访与记录。",
    },
]


# --------------------------- 本地 TF-IDF 检索 ---------------------------
def _cosine(a: List[float], b: List[float]) -> float:
    """两个已 L2 归一化的向量，余弦相似度 = 点积。"""
    return sum(x * y for x, y in zip(a, b))


class _TFIDFRetriever:
    """基于 F.text_feature（归一化词频向量）的本地余弦检索。"""

    def __init__(self, docs: List[Dict]):
        self.docs = docs
        self._vectors = [F.text_feature(d["content"]) for d in docs]

    def search(self, query: str, top_k: int = 5) -> List[Dict]:
        qv = F.text_feature(query)
        scored = [(self._sim(qv, dv), i) for i, dv in enumerate(self._vectors)]
        scored.sort(key=lambda x: x[0], reverse=True)
        results = []
        for sim, i in scored[:top_k]:
            d = self.docs[i]
            results.append({
                "title": d["title"],
                "content": d["content"],
                "score": round(sim, 4),
            })
        return results

    @staticmethod
    def _sim(qv, dv):
        return _cosine(qv, dv)


# ----------------------------- 引擎本体 -----------------------------
class DeepSeekRAGEngine(RAGEngineInterface):
    """
    基于 DeepSeek 的 RAG 分析引擎。

    生成报告时：先用本地 TF-IDF 从知识库召回 top-k 相关指南，再连同被试信息
    一起交给 DeepSeek 生成结构化 JSON 报告。无 API Key 或调用失败时回退 Mock。
    """

    def __init__(self):
        self._initialized = False
        self._retriever = None

    async def initialize(self) -> None:
        if self._retriever is None:
            self._retriever = _TFIDFRetriever(KNOWLEDGE_BASE)
        self._initialized = True

    async def health_check(self) -> bool:
        return self._initialized and bool(settings.DEEPSEEK_API_KEY)

    async def retrieve(self, query: str, top_k: int = 5) -> List[Dict]:
        if self._retriever is None:
            self._retriever = _TFIDFRetriever(KNOWLEDGE_BASE)
        return self._retriever.search(query, top_k)

    async def generate_report(self, screening_data: Dict) -> Dict:
        # 无 Key -> 直接降级，连网络都不发
        if not settings.DEEPSEEK_API_KEY:
            return await self._fallback_report(screening_data)

        try:
            knowledge = await self.retrieve(
                f"{screening_data.get('questionnaire', '量表')} "
                f"{screening_data.get('alert_level', '')}",
                top_k=3,
            )
            knowledge_text = "\n".join(
                [f"{d['title']}: {d['content']}" for d in knowledge]
            )
            prompt = self._build_prompt(screening_data, knowledge_text)
            # 阻塞式 HTTP 放到线程，避免卡住事件循环
            content = await asyncio.to_thread(self._call_deepseek, prompt)
            report = self._parse_json(content)
            if report:
                report["subject"] = screening_data.get("name", "被试")
                report["date"] = datetime.now().strftime("%Y-%m-%d")
                return report
        except Exception as e:  # 网络/解析/限流等任何异常都降级
            print(f"[DeepSeekRAG] 调用失败，降级为 Mock 报告: {e}")

        return await self._fallback_report(screening_data)

    async def add_to_knowledge_base(self, documents: List[Dict]) -> bool:
        KNOWLEDGE_BASE.extend(documents)
        self._retriever = _TFIDFRetriever(KNOWLEDGE_BASE)
        return True

    # ----------------------------- 内部方法 -----------------------------

    def _build_prompt(self, screening_data: Dict, knowledge_text: str) -> str:
        score = screening_data.get("score", 0)
        max_score = screening_data.get("max_score", 100)
        alert_level = screening_data.get("alert_level", "green")
        questionnaire = screening_data.get("questionnaire", "量表")
        name = screening_data.get("name", "被试")
        return f"""你是一名专业的心理健康评估专家。请根据以下信息生成一份心理筛查分析报告。

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
        {{"title": "风险评估", "content": "基于得分与知识库的风险等级判断"}},
        {{"title": "综合评估结论", "content": "全面的评估结论"}}
    ],
    "recommendations": [
        "建议1",
        "建议2",
        "建议3"
    ]
}}

请直接返回JSON，不要包含其他文字。"""

    def _call_deepseek(self, prompt: str) -> str:
        url = f"{settings.DEEPSEEK_BASE_URL.rstrip('/')}/chat/completions"
        payload = {
            "model": settings.DEEPSEEK_MODEL,
            "messages": [
                {
                    "role": "system",
                    "content": "你是一名严谨的心理健康评估专家，只依据提供的量表得分与参考知识库作答，"
                               "不替代临床诊断，并在高风险时强调危机干预与专业转介。",
                },
                {"role": "user", "content": prompt},
            ],
            "temperature": settings.DEEPSEEK_TEMPERATURE,
            "max_tokens": settings.DEEPSEEK_MAX_TOKENS,
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
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data["choices"][0]["message"]["content"]

    @staticmethod
    def _parse_json(content: str) -> Dict:
        try:
            import re
            match = re.search(r"\{[\s\S]*\}", content)
            if match:
                return json.loads(match.group())
        except Exception as e:
            print(f"[DeepSeekRAG] JSON 解析失败: {e}")
        return None

    async def _fallback_report(self, screening_data: Dict) -> Dict:
        from app.engines.rag.mock_engine import MockRAGEngine
        return await MockRAGEngine().generate_report(screening_data)
