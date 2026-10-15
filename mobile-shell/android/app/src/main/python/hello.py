"""Chaquopy 冒烟测试：确认 Python 运行时真的被打进 APK 并且能跑。

第一步先只验证工具链（能不能编译、能不能在设备上执行 Python），
确认之后再往里放真正的主后端代码。
"""


def greet(name: str = "world") -> str:
    import sys

    return f"hello {name} from Python {sys.version.split()[0]}"
