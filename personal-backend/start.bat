@echo off
cd /d %~dp0
echo ==========================================
echo   个人端 KG + Agent 后端服务启动器
echo   端口: 8001  (Neo4j: 7687)
echo ==========================================
echo.

REM 检查 Neo4j 是否运行
netstat -ano | findstr ":7687" | findstr "LISTENING" >nul
if errorlevel 1 (
    echo [警告] Neo4j 未运行！请先执行: docker start gifted_buck
    echo.
)

REM 检查端口 8001 是否被占用
netstat -ano | findstr ":8001" | findstr "LISTENING" >nul
if not errorlevel 1 (
    echo [提示] 端口 8001 已被占用，尝试结束旧进程...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8001" ^| findstr "LISTENING"') do (
        taskkill -F -PID %%a 2>nul
        echo [ok] 已结束 PID=%%a
    )
    timeout /t 2 /nobreak >nul
)

if not exist venv (
    echo 创建虚拟环境...
    python -m venv venv
)

call venv\Scripts\activate.bat

REM 检查依赖是否已安装
venv\Scripts\python.exe -c "import apscheduler" 2>nul
if errorlevel 1 (
    echo 安装依赖...
    venv\Scripts\pip.exe install -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/
)

echo.
echo 启动 FastAPI 服务...
echo 按 Ctrl+C 停止服务
echo.
venv\Scripts\python.exe -m uvicorn app.main:app --port 8001 --host 127.0.0.1
