from abc import abstractmethod
from typing import List, Dict, Any
from app.engines.base import BaseEngine


class HashingEngineInterface(BaseEngine):
    """跨模态哈希检索引擎接口"""
    
    @abstractmethod
    async def encode(self, data: Any, modality: str) -> List[int]:
        """
        将输入数据编码为哈希码
        
        Args:
            data: 输入数据（文本/语音/图像）
            modality: 模态类型 (text/audio/image)
        
        Returns:
            哈希码列表
        """
        pass
    
    @abstractmethod
    async def search(
        self, 
        query: str, 
        modality: str = "text",
        top_k: int = 5
    ) -> List[Dict]:
        """
        检索相似案例
        
        Args:
            query: 查询内容
            modality: 查询模态
            top_k: 返回结果数量
        
        Returns:
            相似案例列表
        """
        pass
    
    @abstractmethod
    async def index_case(self, case_data: Dict) -> bool:
        """
        将案例添加到索引
        
        Args:
            case_data: 案例数据
        
        Returns:
            是否成功
        """
        pass
