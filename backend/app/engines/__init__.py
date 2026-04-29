from app.config import settings


def get_rag_engine():
    """
    获取RAG引擎实例
    
    根据配置返回Mock引擎或真实的智谱AI引擎
    """
    if settings.ENABLE_MOCK_ENGINES:
        from app.engines.rag.mock_engine import MockRAGEngine
        return MockRAGEngine()
    else:
        from app.engines.rag.zhipu_rag_engine import ZhipuRAGEngine
        return ZhipuRAGEngine()


def get_multimodal_processor():
    """
    获取多模态处理器实例
    """
    from app.engines.multimodal.mock_processor import MockMultimodalProcessor
    return MockMultimodalProcessor()


def get_hashing_engine():
    """
    获取哈希检索引擎实例
    """
    from app.engines.hashing.mock_engine import MockHashingEngine
    return MockHashingEngine()
