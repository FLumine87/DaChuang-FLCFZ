from pydantic_settings import BaseSettings
from typing import Optional
from functools import lru_cache


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
    
    ZHIPUAI_API_KEY: str = "f3b23945f51043a498ce05499ef623fb.Qi9S3ifxUNQY76FZ"
    ZHIPUAI_MODEL: str = "glm-4.7"
    ZHIPUAI_MAX_TOKENS: int = 65536
    ZHIPUAI_TEMPERATURE: float = 1.0
    ZHIPUAI_ENABLE_THINKING: bool = True
    
    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
