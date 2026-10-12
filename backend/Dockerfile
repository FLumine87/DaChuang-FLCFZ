FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
RUN echo "deb http://mirrors.tuna.tsinghua.edu.cn/debian trixie main" > /etc/apt/sources.list.d/tuna.list \
    && apt-get update && apt-get install -y --no-install-recommends gcc \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir --timeout 120 --retries 10 \
    -i https://pypi.tuna.tsinghua.edu.cn/simple \
    --trusted-host pypi.tuna.tsinghua.edu.cn \
    -r requirements.txt
COPY . .
RUN mkdir -p data uploads/audio uploads/image uploads/document
EXPOSE 8000
CMD ["sh", "-c", "mkdir -p data uploads/audio uploads/image uploads/document && python init_data.py && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
