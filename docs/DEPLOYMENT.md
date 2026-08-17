# 心理筛查预警系统 - 部署文档

本文档详细介绍了心理筛查预警系统的多种部署方式，包括 Windows/Linux 本地部署和 Docker 容器化部署。

## 目录

- [环境要求](#环境要求)
- [Windows 本地部署](#windows-本地部署)
- [Linux 本地部署](#linux-本地部署)
- [Docker 部署](#docker-部署)
- [生产环境部署](#生产环境部署)
- [常见问题](#常见问题)

---

## 环境要求

### 基础环境

| 组件 | 最低版本 | 推荐版本 |
|------|----------|----------|
| Python | 3.11 | 3.11+ |
| Node.js | 18.0 | 20.x LTS |
| npm | 9.0 | 10.x |
| Docker | 20.10 | 24.x |
| Docker Compose | 2.0 | 2.x |

### 硬件要求

| 环境 | CPU | 内存 | 磁盘 |
|------|-----|------|------|
| 开发环境 | 2核 | 4GB | 10GB |
| 生产环境 | 4核+ | 8GB+ | 50GB+ |

### 端口要求

| 服务 | 端口 | 说明 |
|------|------|------|
| 后端 API | 8000 | FastAPI 服务 |
| 前端服务 | 5173 | Vite 开发服务器 |
| 前端生产 | 80/443 | Nginx/生产服务器 |

---

## Windows 本地部署

### 1. 安装前置软件

#### 1.1 安装 Python

1. 访问 [Python 官网](https://www.python.org/downloads/) 下载 Python 3.11+
2. 运行安装程序，**勾选 "Add Python to PATH"**
3. 验证安装：
```powershell
python --version
pip --version
```

#### 1.2 安装 Node.js

1. 访问 [Node.js 官网](https://nodejs.org/) 下载 LTS 版本
2. 运行安装程序
3. 验证安装：
```powershell
node --version
npm --version
```

### 2. 获取项目代码

```powershell
# 克隆项目（或直接解压项目压缩包）
git clone <项目地址>
cd DaChuang-FLCFZ
```

### 3. 后端部署

#### 3.1 方式一：使用启动脚本（推荐）

```powershell
cd backend
start.bat
```

脚本会自动完成：
- 创建 Python 虚拟环境
- 安装依赖包
- 启动后端服务

#### 3.2 方式二：手动部署

```powershell
cd backend

# 创建虚拟环境
python -m venv venv

# 激活虚拟环境
venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 创建环境配置文件
copy .env.example .env

# 启动服务
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

#### 3.3 验证后端

访问 http://localhost:8000/docs 查看 API 文档

### 4. 前端部署

```powershell
# 打开新的终端窗口
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

### 5. 访问系统

- 前端界面：http://localhost:5173
- 后端 API：http://localhost:8000
- API 文档：http://localhost:8000/docs

---

## Linux 本地部署

### 1. 安装前置软件

#### 1.1 Ubuntu/Debian

```bash
# 更新包管理器
sudo apt update

# 安装 Python
sudo apt install python3.11 python3.11-venv python3-pip -y

# 安装 Node.js (使用 NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install nodejs -y

# 验证安装
python3 --version
node --version
npm --version
```

#### 1.2 CentOS/RHEL

```bash
# 安装 Python 3.11
sudo yum install python3.11 python3.11-pip -y

# 安装 Node.js
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install nodejs -y

# 验证安装
python3.11 --version
node --version
npm --version
```

### 2. 获取项目代码

```bash
# 安装 git（如未安装）
sudo apt install git -y  # Ubuntu/Debian
# 或
sudo yum install git -y  # CentOS/RHEL

# 克隆项目
git clone <项目地址>
cd DaChuang-FLCFZ
```

### 3. 后端部署

#### 3.1 方式一：使用启动脚本（推荐）

```bash
cd backend
chmod +x start.sh
./start.sh
```

#### 3.2 方式二：手动部署

```bash
cd backend

# 创建虚拟环境
python3 -m venv venv

# 激活虚拟环境
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 创建环境配置文件
cp .env.example .env

# 启动服务
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 4. 前端部署

```bash
# 打开新的终端窗口
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

### 5. 后台运行（生产环境推荐）

#### 5.1 使用 systemd 管理后端服务

创建服务文件：
```bash
sudo nano /etc/systemd/system/mental-screening-backend.service
```

内容：
```ini
[Unit]
Description=Mental Screening Backend API
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/DaChuang-FLCFZ/backend
Environment="PATH=/path/to/DaChuang-FLCFZ/backend/venv/bin"
ExecStart=/path/to/DaChuang-FLCFZ/backend/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

启动服务：
```bash
sudo systemctl daemon-reload
sudo systemctl enable mental-screening-backend
sudo systemctl start mental-screening-backend
sudo systemctl status mental-screening-backend
```

#### 5.2 使用 PM2 管理前端服务

```bash
# 安装 PM2
sudo npm install -g pm2

cd frontend

# 构建生产版本
npm run build

# 使用 serve 提供静态文件服务
npm install -g serve
pm2 start "serve -s dist -l 5173" --name mental-screening-frontend

# 保存 PM2 配置
pm2 save
pm2 startup
```

---

## Docker 部署

### 1. 安装 Docker

#### 1.1 Windows

1. 下载 [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop)
2. 运行安装程序并重启电脑
3. 启动 Docker Desktop

#### 1.2 Linux (Ubuntu)

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | sh

# 将当前用户添加到 docker 组
sudo usermod -aG docker $USER

# 重新登录后验证
docker --version
docker compose version
```

### 2. 使用 Docker Compose 部署（推荐）

#### 2.1 一键启动

```bash
cd DaChuang-FLCFZ

# 构建并启动所有服务
docker compose up -d

# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f
```

#### 2.2 服务说明

| 服务 | 容器名 | 端口映射 |
|------|--------|----------|
| backend | mental-screening-backend | 8000:8000 |
| frontend | mental-screening-frontend | 5173:5173 |

#### 2.3 常用命令

```bash
# 停止服务
docker compose down

# 重启服务
docker compose restart

# 重新构建
docker compose up -d --build

# 查看后端日志
docker compose logs -f backend

# 查看前端日志
docker compose logs -f frontend

# 进入后端容器
docker compose exec backend bash

# 进入前端容器
docker compose exec frontend sh
```

### 3. 单独构建镜像

#### 3.1 构建后端镜像

```bash
cd backend
docker build -t mental-screening-backend:latest .
```

#### 3.2 构建前端镜像

```bash
cd frontend
docker build -t mental-screening-frontend:latest .
```

#### 3.3 手动运行容器

```bash
# 运行后端
docker run -d \
  --name backend \
  -p 8000:8000 \
  -v $(pwd)/backend/uploads:/app/uploads \
  -e DATABASE_URL=sqlite:///./mental_screening.db \
  -e SECRET_KEY=your-secret-key \
  mental-screening-backend:latest

# 运行前端
docker run -d \
  --name frontend \
  -p 5173:5173 \
  -e VITE_API_URL=http://localhost:8000 \
  mental-screening-frontend:latest
```

### 4. Docker 环境变量配置

在项目根目录创建 `.env` 文件：

```env
# 后端配置
DATABASE_URL=sqlite:///./mental_screening.db
SECRET_KEY=your-production-secret-key
DEBUG=False
ENABLE_MOCK_ENGINES=True

# 前端配置
VITE_API_URL=http://your-domain.com:8000
```

修改 `docker-compose.yml` 使用环境变量：

```yaml
services:
  backend:
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - SECRET_KEY=${SECRET_KEY}
      - DEBUG=${DEBUG}
      - ENABLE_MOCK_ENGINES=${ENABLE_MOCK_ENGINES}
```

---

## 生产环境部署

### 1. 使用 Nginx 反向代理

#### 1.1 安装 Nginx

```bash
# Ubuntu/Debian
sudo apt install nginx -y

# CentOS/RHEL
sudo yum install nginx -y
```

#### 1.2 配置 Nginx

创建配置文件：
```bash
sudo nano /etc/nginx/sites-available/mental-screening
```

配置内容：
```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    location / {
        root /path/to/DaChuang-FLCFZ/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # API 代理
    location /api {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 上传文件
    location /uploads {
        proxy_pass http://127.0.0.1:8000;
    }
}
```

启用配置：
```bash
sudo ln -s /etc/nginx/sites-available/mental-screening /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 2. 使用 PostgreSQL 数据库（生产环境推荐）

#### 2.1 安装 PostgreSQL

```bash
# Ubuntu/Debian
sudo apt install postgresql postgresql-contrib -y

# 启动服务
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

#### 2.2 创建数据库和用户

```bash
sudo -u postgres psql

# 创建用户
CREATE USER mental_user WITH PASSWORD 'your_password';

# 创建数据库
CREATE DATABASE mental_screening OWNER mental_user;

# 授权
GRANT ALL PRIVILEGES ON DATABASE mental_screening TO mental_user;

\q
```

#### 2.3 修改后端配置

修改 `backend/.env`：
```env
DATABASE_URL=postgresql://mental_user:your_password@localhost:5432/mental_screening
```

安装 PostgreSQL 驱动：
```bash
pip install psycopg2-binary
```

执行数据库迁移：
```bash
cd backend
alembic upgrade head
```

### 3. HTTPS 配置（使用 Let's Encrypt）

```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx -y

# 获取证书
sudo certbot --nginx -d your-domain.com

# 自动续期测试
sudo certbot renew --dry-run
```

### 4. 生产环境检查清单

- [ ] 修改 `SECRET_KEY` 为安全的随机字符串
- [ ] 设置 `DEBUG=False`
- [ ] 使用 PostgreSQL 替代 SQLite
- [ ] 配置 HTTPS
- [ ] 设置防火墙规则
- [ ] 配置日志收集
- [ ] 设置定时备份
- [ ] 配置监控告警

### 5. 防火墙配置

```bash
# Ubuntu/Debian (UFW)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 22/tcp
sudo ufw enable

# CentOS/RHEL (firewalld)
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --reload
```

---

## 常见问题

### 1. 端口被占用

**问题**：启动时提示端口已被占用

**解决**：
```bash
# Windows - 查找占用进程
netstat -ano | findstr :8000
taskkill /PID <进程ID> /F

# Linux - 查找并终止进程
lsof -i :8000
kill -9 <PID>
```

### 2. Python 依赖安装失败

**问题**：pip install 报错

**解决**：
```bash
# 升级 pip
python -m pip install --upgrade pip

# 使用国内镜像
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

### 3. Node 依赖安装失败

**问题**：npm install 报错

**解决**：
```bash
# 清除缓存
npm cache clean --force

# 删除 node_modules 重新安装
rm -rf node_modules package-lock.json
npm install

# 使用国内镜像
npm install --registry=https://registry.npmmirror.com
```

### 4. Docker 容器无法访问

**问题**：容器启动后无法访问服务

**解决**：
```bash
# 检查容器状态
docker compose ps

# 查看容器日志
docker compose logs backend
docker compose logs frontend

# 检查端口映射
docker port <container_name>
```

### 5. 数据库连接失败

**问题**：后端无法连接数据库

**解决**：
```bash
# 检查数据库服务状态
sudo systemctl status postgresql

# 测试连接
psql -U mental_user -d mental_screening -h localhost

# 检查连接字符串格式
# PostgreSQL: postgresql://user:password@host:port/database
# SQLite: sqlite:///./database.db
```

### 6. 前端无法连接后端 API

**问题**：前端请求 API 报跨域错误

**解决**：
1. 确保后端已启动并监听正确端口
2. 检查 `vite.config.ts` 代理配置
3. 生产环境确保 Nginx 反向代理配置正确

### 7. 文件上传失败

**问题**：上传文件时报错

**解决**：
```bash
# 检查上传目录权限
chmod -R 755 backend/uploads

# 检查磁盘空间
df -h

# 检查文件大小限制（后端默认 50MB）
# 修改 app/config.py 中的 MAX_UPLOAD_SIZE
```

---

## 技术支持

如遇到其他问题，请：
1. 查看项目文档：[README.md](./README.md)、[API.md](./docs/API.md)
2. 查看后端日志：`docker compose logs backend` 或后端控制台输出
3. 查看前端日志：浏览器开发者工具控制台
4. 提交 Issue 到项目仓库
