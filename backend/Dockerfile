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
# init_data.py 已做幂等判断（已有数据则跳过），重复执行安全。
CMD ["sh", "-c", "mkdir -p data uploads/audio uploads/image uploads/document && python init_data.py && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
