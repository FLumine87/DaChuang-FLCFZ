from abc import abstractmethod
from typing import Dict, Any, Optional
from app.engines.base import BaseEngine


class MultimodalProcessorInterface(BaseEngine):
    """多模态处理器接口"""
    
    @abstractmethod
    async def process_text(self, text: str) -> Dict:
        """
        处理文本数据
        
        Args:
            text: 文本内容
        
        Returns:
            处理结果（特征、情感等）
        """
        pass
    
    @abstractmethod
    async def process_audio(self, audio_path: str) -> Dict:
        """
        处理音频数据
        
        Args:
            audio_path: 音频文件路径
        
        Returns:
            处理结果（转录文本、情感特征等）
        """
        pass
    
    @abstractmethod
    async def process_image(self, image_path: str) -> Dict:
        """
        处理图像数据
        
        Args:
            image_path: 图像文件路径
        
        Returns:
            处理结果（视觉特征、分析结果等）
        """
        pass
    
    @abstractmethod
    async def extract_features(self, data: Any, modality: str) -> Dict:
        """
        提取多模态特征
        
        Args:
            data: 输入数据
            modality: 模态类型
        
        Returns:
            特征向量
        """
        pass
