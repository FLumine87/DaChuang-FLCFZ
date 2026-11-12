"""
运行时环境适配层（双模式）。

背景：后端需同时运行在两种环境——
  1. 本地（CPython + uvicorn + SQLite）：保持原有行为不变；
  2. Cloudflare Python Worker（Pyodide 运行时）：磁盘临时、无线程、
     数据持久化需走 D1 / R2，密钥走 vars / secrets。

本模块通过 `init_worker(env)` 在 Worker 入口（backend/worker/src/entry.py）
首次请求时注入 Cloudflare 平台绑定（D1 / R2 / vars / secrets），
业务层用 `is_worker()` 判断当前运行环境并选择适配路径。
本地运行时 `is_worker()` 恒为 False，走原有逻辑，互不影响。

（预留改进方向：后续若引入 Vectorize / Workers AI 等绑定，同样经由此层注入。）
"""

_RUNTIME = {
    "is_worker": False,  # 是否运行在 Cloudflare Python Worker
    "env": None,         # Worker 的 env 对象（含 D1/R2 bindings 与 vars/secrets）
}


def init_worker(env) -> None:
    """Worker 入口处调用一次，注入运行时环境（幂等，可重复调用）。"""
    _RUNTIME["is_worker"] = True
    _RUNTIME["env"] = env


def is_worker() -> bool:
    """当前是否运行在 Cloudflare Python Worker。"""
    return bool(_RUNTIME["is_worker"])


def get_worker_env():
    """获取 Worker env 对象；非 Worker 环境下返回 None。"""
    return _RUNTIME["env"]


def get_binding(name: str):
    """按绑定名取 Worker 平台资源（D1/R2/KV 等）；非 Worker 环境返回 None。"""
    env = _RUNTIME["env"]
    if env is None:
        return None
    return getattr(env, name, None)
