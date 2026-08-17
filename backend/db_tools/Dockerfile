FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# 直接使用 Python 镜像，已包含基本工具
# 跳过 apt-get update 以避免网络问题

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p data uploads/audio uploads/image uploads/document

WORKDIR /app

CMD ["tail", "-f", "/dev/null"]
