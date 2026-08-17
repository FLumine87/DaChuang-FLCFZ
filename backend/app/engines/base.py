from abc import ABC, abstractmethod
from typing import Any, Dict, List


class BaseEngine(ABC):
    """算法引擎基类"""
    
    @abstractmethod
    async def initialize(self) -> None:
        """初始化引擎"""
        pass
    
    @abstractmethod
    async def health_check(self) -> bool:
        """健康检查"""
        pass


class EngineRegistry:
    """引擎注册表"""
    _engines: Dict[str, type] = {}
    
    @classmethod
    def register(cls, name: str, engine_class: type) -> None:
        cls._engines[name] = engine_class
    
    @classmethod
    def get(cls, name: str) -> type:
        if name not in cls._engines:
            raise ValueError(f"Engine '{name}' not registered")
        return cls._engines[name]
    
    @classmethod
    def list_engines(cls) -> List[str]:
        return list(cls._engines.keys())
