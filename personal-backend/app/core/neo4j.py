import threading
import time

from neo4j import GraphDatabase

from ..config import settings

_driver = None
_lock = threading.Lock()

# 健康检查结果缓存时长（秒）。
# 为什么需要 TTL：Neo4j 可能中途重启、改密码或被换成另一个容器。若把检查结果
# 永久缓存，进程不重启就会一直沿用"首次判断"，中间断连也不自知——所有图谱接口
# 会静默返回空图，界面上看不出是故障。3 秒足够抑制同一请求内的重复探测，
# 又能在服务恢复后自动接回；断连期间也仍按 3 秒一次重探，不会每个请求都去等超时。
_HEALTH_TTL = 3.0
_health_value: bool | None = None
_health_ts: float = 0.0


def get_driver():
    """惰性创建 Neo4j 驱动单例（线程安全）。"""
    global _driver
    if _driver is None:
        with _lock:
            if _driver is None:
                _driver = GraphDatabase.driver(
                    settings.neo4j_uri,
                    auth=(settings.neo4j_user, settings.neo4j_password),
                )
    return _driver


def _discard_driver() -> None:
    """丢弃当前驱动单例，让下次 get_driver() 重建。

    连接失效（Neo4j 重启 / 改密码 / 容器被替换）后必须换掉旧驱动，
    否则它内部的连接池会一直抱着失效连接，重试也只是继续失败。

    这里只清引用、不调用 close()：可能有其他线程正拿着这个驱动跑查询，
    强行关闭会把它们的会话一并打断。旧驱动失去引用后由 GC 回收连接池。
    """
    global _driver
    with _lock:
        _driver = None


def reset_driver() -> None:
    """对外暴露的自愈入口：清驱动 + 清健康缓存（诊断/显式刷新场景）。"""
    global _health_value, _health_ts
    _discard_driver()
    with _lock:
        _health_value = None
        _health_ts = 0.0


def neo4j_health(force: bool = False) -> bool:
    """检查 Neo4j 连通性，结果缓存 _HEALTH_TTL 秒。

    force=True 时忽略缓存强制重探（诊断接口/显式刷新用）。
    探测失败即丢弃驱动单例，使服务恢复后下一次重探能自动接回。
    """
    global _health_value, _health_ts
    if not force and _health_value is not None and (time.monotonic() - _health_ts) < _HEALTH_TTL:
        return _health_value

    try:
        get_driver().verify_connectivity()
        ok = True
    except Exception:
        ok = False
        # 先丢弃失效驱动，再写缓存：顺序反了会把刚写的缓存又清掉，
        # 导致断连期间每个请求都要从头等一次连接超时。
        _discard_driver()

    # 时间戳取探测"结束"后：一次失败的探测本身要等数秒连接超时，
    # 若用开始时刻，缓存写进去就已过期，TTL 形同虚设，
    # 断连期间每个请求都要重新等一遍超时。
    _health_value = ok
    _health_ts = time.monotonic()
    return ok
