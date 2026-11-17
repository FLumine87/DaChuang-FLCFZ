# 云服务器部署指南（腾讯云轻量 · Ubuntu 24.04 Docker 版）

适用：`Ubuntu24.04-Docker29`，2 核 4G，公网 IP `<服务器公网IP>`。
架构：nginx（前端静态）+ 主后端 + 个人端 AI 服务 + Neo4j，只暴露 80 端口。

## 0. 控制台准备

1. **防火墙**：轻量应用服务器 → 防火墙，放行 `TCP 22 / 80 / 443`。
   **不要**放行 8000、8001、7474、7687——它们只在容器网络内互相访问。
2. **登录方式**：控制台「重置密码」设置 ubuntu 用户密码，或在「SSH 密钥」绑定公钥。
3. 记下公网 IP：`<服务器公网IP>`。

## 1. 登录并加 swap

```bash
ssh ubuntu@<服务器公网IP>

# 4G 内存构建镜像容易 OOM，加 2G swap
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h

# Docker 版已预装，确认版本
docker --version
docker compose version
```

## 2. 拉取代码（私有仓库用部署密钥）

```bash
ssh-keygen -t ed25519 -C "dachuang-deploy" -f ~/.ssh/dachuang_deploy -N ""
cat ~/.ssh/dachuang_deploy.pub
```

把公钥添加到 GitHub：仓库 → Settings → Deploy keys → Add deploy key（只读即可）。

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/dachuang_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config

git clone git@github.com:FLumine87/DaChuang-FLCFZ.git ~/app
cd ~/app
```

部署文件（compose、Dockerfile、nginx 配置、env 模板）随仓库一起克隆，无需额外上传；
真实密钥只在服务器上创建的 `.env.prod` 里，该文件已被 `.gitignore` 排除。

## 3. 配置生产环境变量

```bash
cp .env.prod.example .env.prod

# 生成三条随机值，分别填入 SECRET_KEY / STEWARD_SYNC_SECRET / NEO4J_PASSWORD
openssl rand -base64 48
openssl rand -base64 48
openssl rand -base64 36

nano .env.prod
```

必填项：

| 变量 | 说明 |
| --- | --- |
| `SECRET_KEY` | JWT 签名密钥，**两个服务必须一致** |
| `STEWARD_SYNC_SECRET` | 主后端与个人端的私有同步密钥，**两端必须一致** |
| `NEO4J_PASSWORD` | Neo4j 初始密码（写入数据卷后改这里不生效） |
| `DEEPSEEK_API_KEY` | 主后端 RAG/文档分析 |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | 个人端画像与陪伴对话 |
| `ENABLE_MOCK_ENGINES` | 生产保持 `False` |

`.env.prod` 已被 `.gitignore` 忽略，不会提交；模板 `.env.prod.example` 可以入库。

## 4. 构建并启动

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

首次构建约 5–10 分钟（有 swap 不会因内存被杀）。启动顺序由 compose 控制：
Neo4j 健康 → `graph-init` 建约束/导入领域语料 → 个人端 → 主后端 → nginx。

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
docker stats --no-stream
```

期望：`neo4j`、`backend`、`personal`、`web` 四个容器 Up（backend/personal 带 healthy），
`graph-init` 状态为 Exited (0)。

## 5. 首次验证

1. 浏览器打开 `http://<服务器公网IP>`。
2. 管理端：`adminer / admin`；个人端：`xiaoyu / 123456`（首次启动自动创建）。
   **登录后立刻在账号设置里改密码。**
3. 检查接口：

```bash
curl -I http://127.0.0.1/
docker compose --env-file .env.prod -f docker-compose.prod.yml logs --tail=50 backend
docker compose --env-file .env.prod -f docker-compose.prod.yml logs --tail=50 personal
```

4. 全新数据库只有表结构和演示账号，没有筛查/案例数据，属于正常。
   生产库文件是 `backend/data/prod.db`；仓库里跟踪的 `data/dev.db` 是本机演示数据，不使用。

## 6. 可选：同步本机的跨模态检索资产

服务器全新初始化时不带 `hashing_state.json`、`index.db`、`real_corpus.db` 等本机产物，
跨模态检索会按需从 `corpus.db` 重建，结果可能与本机演示不完全一致。
需要完全一致时，在本机执行（约 250MB，可只传需要的文件）：

```powershell
scp -r .\backend\data\hashing\* ubuntu@<服务器公网IP>:~/app/backend/data/hashing/
```

然后重启后端：

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml restart backend
```

## 7. 日常更新

```bash
cd ~/app
git pull
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build backend personal web
```

只改前端时可只重建 `web`；只改个人端时重建 `personal`。

## 8. 备份

SQLite 在线备份（不停服务）：

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec backend \
  python -c "import sqlite3;sqlite3.connect('data/prod.db').execute(\"VACUUM INTO 'data/prod-backup.db'\")"
docker compose --env-file .env.prod -f docker-compose.prod.yml exec personal \
  python -c "import sqlite3;sqlite3.connect('data/mental_screening.db').execute(\"VACUUM INTO 'data/mental-backup.db'\")"

tar czf ~/backup-$(date +%F).tgz backend/data/*.db backend/uploads personal-backend/data/*.db .env.prod
```

Neo4j 数据在命名卷 `psych-screening-prod_neo4j_data` 中，重要时用 `neo4j-admin database dump` 导出。

## 9. 域名与 HTTPS（可选）

- 大陆服务器绑定域名需要 ICP 备案；没有域名可先用 IP 访问。
- 备案后再加 HTTPS：可在宿主机装 Caddy/Nginx 做 443 终止并反代到 `127.0.0.1:80`，
  或在 `web` 前再加一层 TLS 容器。当前配置只监听 80，不涉及证书。

## 10. 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 构建到一半容器被杀 | 内存不足：确认 swap 已启用；或在本地构建后推镜像到仓库再拉取 |
| 个人端接口全部 401 | 两端 `SECRET_KEY` 不一致，改 `.env.prod` 后重建 `backend` 与 `personal` |
| 心理管家一直“未连接” | 看 `personal` 日志：`STEWARD_SYNC_SECRET` 与主后端不一致，或 `STEWARD_BACKEND_URL` 不可达 |
| Neo4j 报认证失败 | 数据卷里已写入旧密码：`docker compose ... down` 后删除 `neo4j_data` 卷再启动（会清空图谱） |
| 图片/语音 404 | 确认 `backend/uploads` 已挂载且有文件；nginx `/uploads/` 反代是否生效 |
| AI 请求超时 | nginx 已放宽到 300s；再看模型 Key、额度与 `STEWARD_LLM_TIMEOUT` |
| 80 端口被占用 | 改 `.env.prod` 的 `PUBLIC_PORT`，例如 8080，并在防火墙放行 |

## 11. 安全清单

- [ ] `adminer`、`xiaoyu` 默认密码已修改
- [ ] `.env.prod` 权限 `chmod 600`，未提交仓库
- [ ] 防火墙未放行 8000/8001/7474/7687
- [ ] `ENABLE_MOCK_ENGINES=False`
- [ ] 定期备份 `backend/data`、`backend/uploads`、`personal-backend/data`
