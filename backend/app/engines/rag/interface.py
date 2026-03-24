from abc import abstractmethod
from typing import Dict, List, Any
from app.engines.base import BaseEngine


class RAGEngineInterface(BaseEngine):
    """RAG分析引擎接口"""
    
    @abstractmethod
    async def retrieve(self, query: str, top_k: int = 5) -> List[Dict]:
        """
        从知识库检索相关文档
        
        Args:
            query: 查询内容
            top_k: 返回结果数量
        
        Returns:
            相关文档列表
        """
        pass
    
    @abstractmethod
    async def generate_report(self, screening_data: Dict) -> Dict:
        """
        生成智能分析报告
        
        Args:
            screening_data: 筛查数据
        
        Returns:
            分析报告
        """
        pass
    
    @abstractmethod
    async def add_to_knowledge_base(self, documents: List[Dict]) -> bool:
        """
        添加文档到知识库
        
        Args:
            documents: 文档列表
        
        Returns:
            是否成功
        """
        pass
