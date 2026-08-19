import random
from datetime import datetime, timedelta
from typing import List, Dict, Any

from app.engines.hashing.interface import HashingEngineInterface


class MockHashingEngine(HashingEngineInterface):
    """
    跨模态哈希检索引擎的Mock实现
    
    此实现返回预设的模拟结果，用于开发和测试。
    后续可替换为真实的哈希检索引擎实现。
    """
    
    MOCK_CASES = [
        {
            "id": "RET-001",
            "summary": "男性，20岁，PHQ-9得分17，存在明显的兴趣缺失和睡眠障碍，历史上有类似波动",
            "tags": ["抑郁", "睡眠障碍"],
        },
        {
            "id": "RET-002",
            "summary": "男性，21岁，语音分析显示情绪低落特征，文本中多次出现消极词汇",
            "tags": ["情绪低落", "消极认知"],
        },
        {
            "id": "RET-003",
            "summary": "女性，19岁，GAD-7得分14，伴有躯体化焦虑症状",
            "tags": ["焦虑", "躯体化"],
        },
        {
            "id": "RET-004",
            "summary": "绘画测试分析：房树人测试显示自我认知偏低，社会支持感薄弱",
            "tags": ["自我认知", "社会支持"],
        },
        {
            "id": "RET-005",
            "summary": "语音情感分析：语速偏慢，音调平坦，情感表达抑制",
            "tags": ["情感抑制", "语音特征"],
        },
        {
            "id": "RET-006",
            "summary": "女性，22岁，SCL-90总分偏高，人际关系敏感，存在强迫倾向",
            "tags": ["人际关系", "强迫倾向"],
        },
        {
            "id": "RET-007",
            "summary": "男性，19岁，学业压力导致焦虑，伴有考前紧张症状",
            "tags": ["学业压力", "考试焦虑"],
        },
        {
            "id": "RET-008",
            "summary": "女性，21岁，家庭关系问题导致情绪波动，存在适应障碍",
            "tags": ["家庭问题", "适应障碍"],
        },
    ]
    
    MODALITY_MAP = {
        "text": "text",
        "audio": "audio",
        "image": "image",
        "multimodal": "multimodal",
    }
    
    ALERT_LEVELS = ["green", "yellow", "orange", "red"]
    
    def __init__(self):
        self._initialized = False
    
    async def initialize(self) -> None:
        self._initialized = True
    
    async def health_check(self) -> bool:
        return self._initialized
    
    async def encode(self, data: Any, modality: str) -> List[int]:
        random.seed(hash(str(data)) % (2**32))
        hash_code = [random.randint(0, 1) for _ in range(64)]
        return hash_code
    
    async def search(
        self, 
        query: str, 
        modality: str = "text",
        top_k: int = 5
    ) -> List[Dict]:
        random.seed(hash(query) % (2**32))
        
        cases = self.MOCK_CASES.copy()
        random.shuffle(cases)
        
        results = []
        for i, case in enumerate(cases[:top_k]):
            base_similarity = 0.95 - (i * 0.05)
            similarity = base_similarity + random.uniform(-0.03, 0.03)
            similarity = max(0.5, min(0.99, similarity))
            
            days_ago = random.randint(30, 180)
            date = (datetime.now() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
            
            results.append({
                "id": case["id"],
                "similarity": round(similarity, 2),
                "modality": self.MODALITY_MAP.get(modality, "text"),
                "summary": case["summary"],
                "tags": case["tags"],
                "alert_level": random.choice(self.ALERT_LEVELS),
                "date": date,
            })
        
        return results
    
    async def index_case(self, case_data: Dict) -> bool:
        return True
