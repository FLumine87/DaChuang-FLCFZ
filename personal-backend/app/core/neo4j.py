from functools import lru_cache

from neo4j import GraphDatabase

from ..config import settings

_driver = None


def get_driver():
    """惰性创建 Neo4j 驱动单例。"""
    global _driver
    if _driver is None:
        _driver = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
        )
    return _driver


@lru_cache(maxsize=1)
def neo4j_health() -> bool:
    """检查 Neo4j 连通性（结果缓存一次，避免健康检查反复重连）。"""
    try:
        get_driver().verify_connectivity()
        return True
    except Exception:
        return False
