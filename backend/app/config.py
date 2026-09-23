"""轻量配置（纯标准库）：本地读取环境变量与 .env，Worker 由入口注入 vars/secrets。

去掉了 pydantic-settings：Cloudflare Python Worker 打包体积敏感，
改用普通类 + 简单 .env 解析，字段与旧配置完全一致。
"""
import os
from functools import lru_cache


def _coerce(current, value):
    """按字段当前类型把字符串值转换为 bool/int/float/str。"""
    if isinstance(current, bool):
        return str(value).lower() in ("1", "true", "yes", "on")
    if isinstance(current, int):
        try:
            return int(value)
        except (TypeError, ValueError):
            return current
    if isinstance(current, float):
        try:
            return float(value)
        except (TypeError, ValueError):
            return current
    return value


class Settings:
    APP_NAME: str = "心理筛查预警系统API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True

    DATABASE_URL: str = "sqlite:///./data/dev.db"

    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    UPLOAD_DIR: str = "./uploads"
    MAX_UPLOAD_SIZE: int = 50 * 1024 * 1024

    # Cloudflare R2（上传文件存储；仅 Worker 环境下使用，本地仍写磁盘）
    R2_BUCKET_NAME: str = "uploads"
    # 可选：R2 绑定的公开访问域名（开启 public bucket 后填）
    R2_PUBLIC_BASE_URL: str = ""

    ENABLE_MOCK_ENGINES: bool = True

    # 动态跨模态哈希引擎配置
    HASHING_USE_MOCK: bool = False
    HASHING_DATA_DIR: str = "./data/hashing"
    HASHING_CODE_LENGTH: int = 64          # 哈希码位长
    HASHING_LAMBDA_S: float = 0.6          # 语义监督项权重
    HASHING_BAND_BITS: int = 8             # 位带宽度（K=64 → 8 张位带表）
    HASHING_PROBE_BITS: int = 2            # 位带内可翻转比特数：保证半径 = 8×2 = 16 位内不漏召回
    HASHING_TABLE_RHO_MIN: float = 0.10    # 时间窗表"语义一致性"下限，低于则不再参与探测
    HASHING_TABLE_SIGMA_MIN: float = 0.02  # 时间窗表"编码信息量"下限
    HASHING_WINDOW_DAYS: int = 122         # 时间窗长度（约 4 个月）
    HASHING_EPOCH: str = "2025-08-01"      # 时间窗起算日
    HASHING_TRAIN_MAX: int = 300           # 训练抽样上限（配对记录数）

    # 模拟多模态语料（scripts/generate_retrieval_corpus.py 生成）
    # 存在时优先作为检索库；缺失则回退主库业务表 / retrieval_seed.db / demo
    HASHING_USE_CORPUS: bool = True
    HASHING_CORPUS_DB: str = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "data", "hashing", "corpus.db",
    )

    # 随项目发布的检索语料种子库（本地开发用；Worker 下检索走 Mock 降级）
    RETRIEVAL_SEED_DB: str = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "retrieval_seed.db"
    )

    # 智谱 AI（预留，未启用时走 Mock）
    ZHIPUAI_API_KEY: str = ""
    ZHIPUAI_MODEL: str = "glm-4.7"
    ZHIPUAI_MAX_TOKENS: int = 65536
    ZHIPUAI_TEMPERATURE: float = 1.0
    ZHIPUAI_ENABLE_THINKING: bool = True

    # RAG 引擎提供方：deepseek(默认) | zhipu（ENABLE_MOCK_ENGINES=True 时强制 Mock）
    RAG_PROVIDER: str = "deepseek"

    # DeepSeek（仅用于"生成报告"；密钥仅从环境变量读取，未设置时自动降级 Mock）
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_MODEL: str = "deepseek-chat"
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com/v1"
    DEEPSEEK_MAX_TOKENS: int = 4096
    DEEPSEEK_TEMPERATURE: float = 0.7

    def __init__(self) -> None:
        # 从 backend/.env 加载（简单 KEY=VALUE 解析；环境变量优先）
        env_file = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"
        )
        if os.path.exists(env_file):
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if v and hasattr(self, k):
                        setattr(self, k, _coerce(getattr(self, k), v))

    def apply_worker_overrides(self, env) -> None:
        """Worker 环境下由入口调用：把 Cloudflare vars/secrets 覆盖到配置。

        vars/secrets 在 Worker env 上以同名字段暴露（纯字符串）；
        D1/R2 等非字符串绑定不经此处理（见 app.core.runtime）。
        """
        bool_keys = {"DEBUG", "ENABLE_MOCK_ENGINES", "ZHIPUAI_ENABLE_THINKING"}
        for key in (
            "SECRET_KEY", "DEBUG", "ENABLE_MOCK_ENGINES",
            "DEEPSEEK_API_KEY", "DEEPSEEK_MODEL", "DEEPSEEK_BASE_URL",
            "DEEPSEEK_MAX_TOKENS", "DEEPSEEK_TEMPERATURE",
            "ZHIPUAI_API_KEY", "ZHIPUAI_MODEL", "ZHIPUAI_ENABLE_THINKING",
            "RAG_PROVIDER", "R2_BUCKET_NAME", "R2_PUBLIC_BASE_URL",
            "ACCESS_TOKEN_EXPIRE_MINUTES",
        ):
            val = getattr(env, key, None)
            if val is None or val == "":
                continue
            if key in bool_keys:
                val = str(val).lower() in ("1", "true", "yes", "on")
            setattr(self, key, val)


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
