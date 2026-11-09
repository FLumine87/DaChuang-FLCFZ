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

    # ---------------- 鉴权（第 1/2 步） ----------------
    # 与主服务端 backend/.env 的 SECRET_KEY **必须完全一致**。
    # 个人端不自己签发凭证，只校验主服务端登录时签发的 HS256 JWT；
    # 两边密钥不同 → 签名验不过 → 所有请求 401。
    # 默认值与 backend/app/config.py 的默认值保持一致（本机开箱即用），
    # 部署到服务器时两边都要改成同一个随机长串。
    secret_key: str = "your-secret-key-change-in-production"

    # 开发便利开关：为 True 时，来自本机回环地址（127.0.0.1/::1）的请求
    # 即使没有凭证也放行（身份取自 ?user_id= 等声明值，不做归属校验）。
    #
    # 为什么要有它：仓库里有一批历史验证脚本（scripts/verify_*.py|mjs、e2e_verify.py）
    # 直连 8001 且不带凭证，一刀切会让它们全挂。默认 False（安全优先），
    # 需要跑旧脚本时临时设 True。
    # 上线/改 --host 0.0.0.0 时必须为 False。
    allow_anonymous_local: bool = False

    # 缓解推荐 Agent（阶段 3）
    music_api_url: str = ""          # 自建 NetEaseCloudMusicApi 地址，如 http://localhost:3000
    enable_llm_content: bool = True  # 是否用 LLM 生成推荐内容（False/失败时回退种子库）

    # 每日问询 Agent（阶段 3.5；2026-11-07 起改为「当天首次登录触发」）
    # 一天只问询一次，因此不再需要触发时刻配置（原 DAILY_CHECKIN_HOUR/MINUTE 已废弃）
    enable_daily_checkin: bool = True   # 是否启用每日问询（登录触发）


settings = Settings()
