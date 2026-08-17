from pydantic_settings import BaseSettings
from typing import Optional
from functools import lru_cache
import os


class Settings(BaseSettings):
    APP_NAME: str = "心理筛查预警系统API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True
    
    DATABASE_URL: str = "sqlite:///./data/dev.db"
    
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    
    UPLOAD_DIR: str = "./uploads"
    MAX_UPLOAD_SIZE: int = 50 * 1024 * 1024
    
    ENABLE_MOCK_ENGINES: bool = True

    # 动态跨模态哈希引擎配置
    HASHING_USE_MOCK: bool = False          # True 则仍走 Mock（兼容旧演示）
    HASHING_DATA_DIR: str = "./data/hashing"
    HASHING_CODE_LENGTH: int = 32          # 哈希码位数 K
    HASHING_LAMBDA_S: float = 0.6          # 监督相似度权重 λ
    HASHING_NUM_TABLES: int = 4            # 多哈希表数量 T
    HASHING_PROBE_RADIUS: int = 2          # 多探测 Hamming 半径
    HASHING_TRAIN_MAX: int = 150           # 从数据库播种时用于「训练」的代表性小样本上限
                                           # （纯 Python 特征值分解为 O(n^2)，故训练只在小样本上做；
                                           #  全部记录仍按样本外方式编码入索引，语料规模不受训练开销限制）

    # 智谱 AI 密钥：仅从环境变量 ZHIPUAI_API_KEY 读取（建议写入 .env）。
    # 不在此处写死任何密钥。若未设置，真实引擎会在调用时自动降级为 Mock 报告，
    # 因此本项目开箱即用、无需任何外部 API 即可运行。
    ZHIPUAI_API_KEY: str = os.getenv("ZHIPUAI_API_KEY", "")
    ZHIPUAI_MODEL: str = "glm-4.7"
    ZHIPUAI_MAX_TOKENS: int = 65536
    ZHIPUAI_TEMPERATURE: float = 1.0
    ZHIPUAI_ENABLE_THINKING: bool = True

    # ---------------- RAG 引擎提供方 ----------------
    # deepseek(默认) | zhipu | （设 ENABLE_MOCK_ENGINES=True 则强制 Mock，无需任何密钥）
    RAG_PROVIDER: str = os.getenv("RAG_PROVIDER", "deepseek")

    # DeepSeek（仅用于"生成报告"；检索走本地 TF-IDF，无需向量库/embedding 接口）
    # 密钥仅从环境变量读取，不写死在源码；未设置时引擎自动降级为 Mock 报告。
    DEEPSEEK_API_KEY: str = os.getenv("DEEPSEEK_API_KEY", "")
    DEEPSEEK_MODEL: str = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    DEEPSEEK_BASE_URL: str = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
    DEEPSEEK_MAX_TOKENS: int = 4096
    DEEPSEEK_TEMPERATURE: float = 0.7

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
