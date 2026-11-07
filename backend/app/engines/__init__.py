def get_rag_engine():
    """
    获取RAG引擎实例

    根据配置返回 Mock 引擎或真实引擎：
      - ENABLE_MOCK_ENGINES=True  -> 强制 Mock（开箱即用，无需任何密钥）
      - 否则按 RAG_PROVIDER 选择：deepseek(默认) / zhipu
    真实引擎在无 API Key 或调用失败时也会自动降级为 Mock 报告。
    """
    from app.config import settings
    if settings.ENABLE_MOCK_ENGINES:
        from app.engines.rag.mock_engine import MockRAGEngine
        return MockRAGEngine()
    provider = getattr(settings, "RAG_PROVIDER", "deepseek").lower()
    if provider == "zhipu":
        from app.engines.rag.zhipu_rag_engine import ZhipuRAGEngine
        return ZhipuRAGEngine()
    # 默认 deepseek
    from app.engines.rag.deepseek_rag_engine import DeepSeekRAGEngine
    return DeepSeekRAGEngine()


def get_multimodal_processor():
    """
    获取多模态处理器实例
    """
    from app.engines.multimodal.mock_processor import MockMultimodalProcessor
    return MockMultimodalProcessor()


_HASHING_ENGINE = None
_IMAGE_INDEX = None


def get_image_index():
    """全量图像库（FER2013）的独立单模态索引，只服务图像搜图像。

    与主跨模态引擎分开：主索引里的图像是按情绪弱配对挂到文本语音记录上的
    1686 张；这里覆盖全部 35887 张，不参与跨模态配对训练。
    """
    global _IMAGE_INDEX
    if _IMAGE_INDEX is not None:
        return _IMAGE_INDEX
    from app.core import runtime
    if runtime.is_worker():
        return None
    try:
        import os
        from app.engines.hashing.image_index import ImageHashIndex
        from app.config import settings
        base = settings.HASHING_DATA_DIR
        idx = ImageHashIndex(
            corpus_db=os.path.join(base, "image_corpus.db"),
            state_path=os.path.join(base, "image_state.json"),
            code_length=int(getattr(settings, "HASHING_CODE_LENGTH", 64)),
        )
        if not os.path.exists(idx.corpus_db) or not idx.build():
            return None
        _IMAGE_INDEX = idx
    except Exception:
        return None
    return _IMAGE_INDEX


def get_hashing_engine():
    """
    获取哈希检索引擎实例（单例缓存，避免每次请求重复训练）。

    默认返回真实「动态跨模态哈希」引擎（在线监督集体矩阵分解 + 多哈希表
    增量索引）。若 HASHING_USE_MOCK 为 True，或真实引擎因异常无法构造成功，
    则回退到 Mock 实现，保证服务可启动。
    """
    global _HASHING_ENGINE
    if _HASHING_ENGINE is not None:
        return _HASHING_ENGINE
    # Worker（Pyodide）下强制 Mock 降级：
    #  1) 免费额度 CPU 限 10ms/请求，CMFH 特征值分解 O(n²) 训练无法完成；
    #  2) 真实引擎状态依赖本地 JSON 文件持久化（hashing_state.json），
    #     Worker 磁盘为临时内存文件系统，重启即失，无法冷启动复用。
    # （预留改进方向：付费计划 / 独立计算 Worker / 接入 Vectorize 承载检索后，
    #   可在此放开真实引擎；本地开发不受影响。）
    from app.core import runtime
    if runtime.is_worker():
        from app.engines.hashing.mock_engine import MockHashingEngine
        _HASHING_ENGINE = MockHashingEngine()
        return _HASHING_ENGINE
    use_mock = False
    try:
        from app.config import settings
        use_mock = getattr(settings, "HASHING_USE_MOCK", False)
    except Exception:
        use_mock = False
    if use_mock:
        from app.engines.hashing.mock_engine import MockHashingEngine
        _HASHING_ENGINE = MockHashingEngine()
    else:
        try:
            from app.engines.hashing.engine import DynamicCrossModalHashingEngine
            _HASHING_ENGINE = DynamicCrossModalHashingEngine()
        except Exception:
            from app.engines.hashing.mock_engine import MockHashingEngine
            _HASHING_ENGINE = MockHashingEngine()
    return _HASHING_ENGINE
