from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """全局配置，从 backend/.env 读取。"""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "personal-kg-backend"

    # 业务库（预警记录等，与主项目 DATABASE_URL 约定一致）
    database_url: str = "sqlite:///./mental_screening.db"

    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "password"

    llm_base_url: str = "https://api.openai.com/v1"
    llm_api_key: str = ""
    llm_model: str = "gpt-4o-mini"
    llm_timeout: int = 60
    # 校园网/代理环境 SSL 校验失败时可设为 False 跳过证书校验
    llm_verify_ssl: bool = True

    enable_mock_engines: bool = True

    # 缓解推荐 Agent（阶段 3）
    music_api_url: str = ""          # 自建 NetEaseCloudMusicApi 地址，如 http://localhost:3000
    enable_llm_content: bool = True  # 是否用 LLM 生成推荐语（失败回退模板）

    # 定时日常问询 Agent（阶段 3.5）
    enable_daily_checkin: bool = True   # 是否启用定时问询
    daily_checkin_hour: int = 20        # 每天问询时间：时（24小时制）
    daily_checkin_minute: int = 0       # 每天问询时间：分


settings = Settings()
