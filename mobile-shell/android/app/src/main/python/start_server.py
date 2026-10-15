"""在 App 里拉起主后端（只监听 127.0.0.1）。

为什么要 chdir：
    backend 的配置里 DATABASE_URL = "sqlite:///./data/dev.db" 是**相对路径**，
    .env 也是按包目录去找的。Chaquoip 把 python 源码解到应用私有目录，
    进程的 CWD 并不是这里 —— 不 chdir 的话数据库会找不到、表建不出来、
    登录直接 500。所以进 main 之前先把工作目录切到本文件所在目录，
    让 ./data/dev.db 与 ./.env 都落在预期位置。

只绑 127.0.0.1：
    不对外暴露。前端（WebView）与它在同一台设备上，走环回即可。
"""

import os
import sys
import threading

_STARTED = False
_LOCK = threading.Lock()


def _here() -> str:
    return os.path.dirname(os.path.abspath(__file__))


def start(port: int = 8000) -> str:
    """在当前线程启动 HTTP 服务（阻塞）。返回状态字符串便于日志。"""
    os.chdir(_here())
    if _here() not in sys.path:
        sys.path.insert(0, _here())

    import uvicorn
    from app.main import app as backend_app

    uvicorn.run(backend_app, host="127.0.0.1", port=int(port), log_level="warning")
    return "stopped"


def start_background(port: int = 8000) -> str:
    """在后台线程启动，不阻塞 App 的启动流程。重复调用只会启动一次。"""
    global _STARTED
    with _LOCK:
        if _STARTED:
            return "already running"
        _STARTED = True
    t = threading.Thread(target=start, args=(port,), daemon=True)
    t.start()
    return "starting on 127.0.0.1:%d" % port


def smoke() -> str:
    """冒烟测试：不启服务，只确认依赖能 import。"""
    os.chdir(_here())
    if _here() not in sys.path:
        sys.path.insert(0, _here())
    msgs = []
    for name in ("fastapi", "uvicorn", "sqlalchemy", "pydantic", "numpy", "PIL"):
        try:
            __import__(name)
            msgs.append(name + " ok")
        except Exception as e:
            msgs.append(name + " FAIL: " + type(e).__name__ + " " + str(e)[:60])
    try:
        from app.main import app  # noqa: F401
        msgs.append("app.main ok")
    except Exception as e:
        msgs.append("app.main FAIL: " + type(e).__name__ + " " + str(e)[:120])
    return " | ".join(msgs)
