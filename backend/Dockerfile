FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --timeout 120 --retries 10 \
    -i https://pypi.tuna.tsinghua.edu.cn/simple \
    --trusted-host pypi.tuna.tsinghua.edu.cn \
    -r requirements.txt

COPY . .

RUN mkdir -p data uploads/audio uploads/image uploads/document

EXPOSE 8000

# 数据库初始化放到容器启动时执行：后端用 ./backend:/app 绑定挂载，运行时实际写的是
# 宿主机 ./backend/data/dev.db（构建阶段生成的库会被该挂载盖掉），且需先确保 data/ 目录存在。
#
# ⚠️ 启动命令修正（原命令在本仓库上必然失败，两处都错）：
#
#   1) `python init_data.py` —— 该文件在 git 历史里**从未存在过**
#      （maintainer 本地的脚本，未提交）。容器启动第一步就
#      `can't open file '/app/init_data.py'` 然后退出。
#      本仓库自带的初始化脚本是 `scripts/init_local_db.py`。
#
#   2) `uvicorn app.main:app` —— 已过时。本项目已从 FastAPI 重构为
#      「标准库 ThreadingHTTPServer」，app/main.py 只导出 dispatch，
#      **没有 ASGI 的 app 对象**，uvicorn 会在启动瞬间崩溃：
#          Attribute "app" not found in module "app.main"
#      正确入口是 `python -m app.main`（见 app/server.py 的 run_server）。
#
# 关于演示账号：run_server() 会调用 database.init_db_sync()，其中
#   · 建表 + 各类幂等迁移；
#   · _seed_demo_accounts() 补齐登录页宣传的两个演示账号
#       adminer / admin   → role=admin（管理端演示）
#       xiaoyu  / 123456  → role=user （个人端演示）
#   幂等：不存在则创建，角色或密码与宣传不符则纠正，重复启动安全。
#   —— 所以账号无需手工建，但**必须让服务真正启动**，否则不会执行到这一步。
CMD ["sh", "-c", "mkdir -p data uploads/audio uploads/image uploads/document && python scripts/init_local_db.py; exec python -m app.main"]
