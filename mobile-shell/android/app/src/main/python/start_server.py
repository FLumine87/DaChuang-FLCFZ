"""在 App 里拉起主后端（只监听 127.0.0.1）。

为什么 chdir：
    后端配置里 DATABASE_URL = "sqlite:///./data/dev.db" 是**相对路径**，
    .env 也是按包目录去找的。Chaquopy 把 python 源码解到应用私有目录，
    进程的 CWD 并不是这里 —— 不 chdir 的话数据库找不到、表建不出来，
    登录会直接 500。所以进 run_server 之前先把工作目录切到本文件所在目录。

为什么不用 uvicorn：
    **主后端根本不是 FastAPI**。它是 app/server.py 里基于标准库
    ThreadingHTTPServer 的轻量实现，入口就是 run_server(host, port)。
    我第一版按 FastAPI 写了 uvicorn 入口，是错的 —— 一并纠正。

只绑 127.0.0.1：
    不对外暴露。前端（WebView）与它同在一台设备上，走环回即可；
    绑 0.0.0.0 反而会让手机在局域网里多开一个口子。
"""

import os
import sys
import threading
import traceback

_STARTED = False
_LOCK = threading.Lock()
_LAST_ERROR = ""


def _here() -> str:
    return os.path.dirname(os.path.abspath(__file__))


def _prepare() -> None:
    """切工作目录 + 把源码目录放进 sys.path（chdir 之后相对导入才成立）。"""
    here = _here()
    os.chdir(here)
    if here not in sys.path:
        sys.path.insert(0, here)


def start(port: int = 8000) -> str:
    """在当前线程启动服务（阻塞，供后台线程调用）。"""
    global _LAST_ERROR
    try:
        _prepare()
        from app.server import run_server

        run_server(host="127.0.0.1", port=int(port))
        return "stopped"
    except Exception:
        _LAST_ERROR = traceback.format_exc()
        return "error: " + _LAST_ERROR[-400:]


def start_background(port: int = 8000) -> str:
    """后台线程启动，不阻塞 App 启动。重复调用只启一次。"""
    global _STARTED
    with _LOCK:
        if _STARTED:
            return "already running"
        _STARTED = True
    threading.Thread(target=start, args=(port,), daemon=True).start()
    return "starting on 127.0.0.1:%d" % port


def last_error() -> str:
    return _LAST_ERROR


def smoke() -> str:
    """冒烟测试：不启服务，只确认依赖与后端能 import、能建库。"""
    _prepare()
    msgs = []
    for name in ("numpy", "PIL", "sqlalchemy"):
        try:
            __import__(name)
            msgs.append(name + " ok")
        except Exception as e:
            msgs.append(name + " FAIL " + type(e).__name__ + ":" + str(e)[:50])
    try:
        from app.server import run_server  # noqa: F401
        msgs.append("server ok")
    except Exception as e:
        msgs.append("server FAIL " + type(e).__name__ + ":" + str(e)[:90])
    try:
        from app.db.database import init_db_sync
        init_db_sync()
        msgs.append("db ok")
    except Exception as e:
        msgs.append("db FAIL " + type(e).__name__ + ":" + str(e)[:90])
    return " | ".join(msgs)
