import os
from typing import Dict, Any

from app.engines.multimodal.interface import MultimodalProcessorInterface


class MockMultimodalProcessor(MultimodalProcessorInterface):
    """
    多模态处理器的Mock实现
    
    此实现返回预设的模拟结果，用于开发和测试。
    后续可替换为真实的处理器实现：
    - 文本：NLP情感分析
    - 音频：Whisper转录 + 情感分析
    - 图像：视觉模型特征提取
    """
    
    def __init__(self):
        self._initialized = False
    
    async def initialize(self) -> None:
        self._initialized = True
    
    async def health_check(self) -> bool:
        return self._initialized
    
    async def process_text(self, text: str) -> Dict:
        return {
            "text": text,
            "length": len(text),
            "word_count": len(text.split()),
            "sentiment": "neutral",
            "sentiment_score": 0.5,
            "keywords": [],
            "entities": [],
            "features": {
                "embedding_dim": 768,
                "has_embedding": False,
            },
        }
    
    async def process_audio(self, audio_path: str) -> Dict:
        file_size = 0
        if os.path.exists(audio_path):
            file_size = os.path.getsize(audio_path)
        
        return {
            "file_path": audio_path,
            "file_size": file_size,
            "duration": 0.0,
            "sample_rate": 16000,
            "transcription": "",
            "language": "zh",
            "emotion": "neutral",
            "emotion_scores": {
                "happy": 0.1,
                "sad": 0.2,
                "angry": 0.1,
                "neutral": 0.5,
                "fear": 0.1,
            },
            "features": {
                "pitch_mean": 0.0,
                "pitch_std": 0.0,
                "energy_mean": 0.0,
                "speaking_rate": 0.0,
            },
        }
    
    async def process_image(self, image_path: str) -> Dict:
        file_size = 0
        if os.path.exists(image_path):
            file_size = os.path.getsize(image_path)
        
        return {
            "file_path": image_path,
            "file_size": file_size,
            "dimensions": {
                "width": 0,
                "height": 0,
                "channels": 3,
            },
            "analysis": {
                "main_objects": [],
                "colors": [],
                "composition": "unknown",
            },
            "drawing_test_result": {
                "house": None,
                "tree": None,
                "person": None,
                "overall_assessment": "待分析",
            },
            "features": {
                "embedding_dim": 2048,
                "has_embedding": False,
            },
        }
    
    async def extract_features(self, data: Any, modality: str) -> Dict:
        if modality == "text":
            return await self.process_text(data)
        elif modality == "audio":
            return await self.process_audio(data)
        elif modality == "image":
            return await self.process_image(data)
        else:
            return {
                "modality": modality,
                "features": {},
                "error": f"Unknown modality: {modality}",
            }
