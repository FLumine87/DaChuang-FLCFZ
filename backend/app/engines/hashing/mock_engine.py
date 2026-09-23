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
        top_k: int = 5,
        modality_filter: str = None,
        exclude_ids: list = None,
    ) -> List[Dict]:
        random.seed(hash(query) % (2**32))

        cases = self.MOCK_CASES.copy()
        random.shuffle(cases)
        if modality_filter:
            filtered = [c for c in cases if self._mock_modality(c) == modality_filter]
            cases = filtered or cases

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

    @staticmethod
    def _mock_modality(case: Dict) -> str:
        """按案例序号轮转分配模态，使 Mock 结果也覆盖文本/语音/图像三类。"""
        idx = int(str(case["id"]).split("-")[-1]) if str(case["id"]).split("-")[-1].isdigit() else 0
        return ("text", "image", "audio")[idx % 3]

    async def search_with_info(self, query: str, modality: str = "text", top_k: int = 5,
                               modality_filter: str = None, exclude_ids: list = None):
        """与真实引擎保持同一签名：返回 (结果列表, 检索过程信息)。"""
        results = await self.search(query, modality=modality, top_k=top_k,
                                   modality_filter=modality_filter, exclude_ids=exclude_ids)
        info = {
            "candidates": len(self.MOCK_CASES),
            "index_size": len(self.MOCK_CASES),
            "keys_probed": 0,
            "scanned_all": True,
            "scoring": "mock",
            "query_code_hex": self.encode_sync(query),
            "query_themes": [],
            "query_modality": modality,
            "modality_filter": modality_filter,
            "mode": "mock",
        }
        return results, info

    def encode_sync(self, data) -> str:
        random.seed(hash(str(data)) % (2**32))
        bits = "".join(str(random.randint(0, 1)) for _ in range(64))
        return format(int(bits, 2), "016x")

    def stats(self) -> Dict:
        return {
            "source": "mock",
            "units": len(self.MOCK_CASES),
            "records": len(self.MOCK_CASES),
            "code_length": 64,
            "trained": False,
            "modalities": {"text": 3, "image": 3, "audio": 3},
            "windows": {0: len(self.MOCK_CASES)},
            "tables": [{"window": 0, "size": len(self.MOCK_CASES), "sigma": 0.0,
                        "rho": 0.0, "active": True, "trust": 0.0}],
            "num_bands": 8,
            "guaranteed_radius": 16,
            "trained_modalities": [],
        }

    async def index_case(self, case_data: Dict) -> bool:
        return True
