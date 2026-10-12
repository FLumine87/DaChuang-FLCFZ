"""以后台子进程方式可靠启动 uvicorn。

修复历史问题：
- 不能用 DETACHED_PROCESS（uvicorn 会随启动脚本退出而被回收）
- 用 CREATE_NEW_PROCESS_GROUP 保证进程独立，同时通过 PID 文件跟踪

用法：python scripts/run_server.py [port]
"""
import os
import subprocess
import sys
import time
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = sys.argv[1] if len(sys.argv) > 1 else "8001"
LOG = os.path.join(BASE, f"uvicorn_{PORT}.log")
PID_FILE = os.path.join(BASE, f".uvicorn_{PORT}.pid")
VENV_PYTHON = os.path.join(BASE, "venv", "Scripts", "python.exe")

# 先杀掉占用该端口的旧进程
try:
    out = subprocess.check_output(
        ["netstat", "-ano"], text=True, encoding="utf-8", errors="replace"
    )
    for line in out.splitlines():
        if f":{PORT}" in line and "LISTENING" in line:
            parts = line.split()
            pid = parts[-1]
            if pid.isdigit():
                try:
                    subprocess.run(
                        ["taskkill", "-F", "-PID", pid],
                        capture_output=True, timeout=10,
                    )
                    print(f"[ok] 已结束旧进程 PID={pid}")
                    time.sleep(1)
                except Exception:
                    pass
except Exception:
    pass

# Windows 后台进程：CREATE_NEW_PROCESS_GROUP 保证 Ctrl+C 不会传导到子进程
flags = 0
if sys.platform == "win32":
    flags = subprocess.CREATE_NEW_PROCESS_GROUP

log_f = open(LOG, "w", encoding="utf-8")
proc = subprocess.Popen(
    [VENV_PYTHON, "-m", "uvicorn", "app.main:app", "--port", PORT],
    cwd=BASE, stdout=log_f, stderr=subprocess.STDOUT,
    creationflags=flags, close_fds=True,
)

# 写 PID 文件供后续管理
with open(PID_FILE, "w") as f:
    f.write(str(proc.pid))

print(f"[ok] 已启动 PID={proc.pid}，端口={PORT}，日志={LOG}")
print("[..] 等待服务就绪...")

ok = False
for _ in range(25):
    time.sleep(1)
    try:
        r = urllib.request.urlopen(
            f"http://localhost:{PORT}/api/v1/health", timeout=3
        )
        print(f"[ok] 服务就绪: {r.read().decode()}")
        ok = True
        break
    except Exception:
        # 进程可能已退出，检查一下
        if proc.poll() is not None:
            print(f"[!] 进程已退出，返回码 {proc.returncode}，请查看日志: {LOG}")
            sys.exit(1)
        continue

if not ok:
    print(f"[!] 等待超时，请查看日志: {LOG}")
    sys.exit(1)
