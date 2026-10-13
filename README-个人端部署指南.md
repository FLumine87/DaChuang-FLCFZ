# 个人端部署配置说明（README）

> 适用于想在**自己电脑**上运行本项目的开发者。原系统为"动态跨模态哈希检索 + RAG 心理筛查预警平台"（前端 Mock 为主），本说明覆盖**新增的个人端 Agent + 知识图谱后端**的完整启动配置。

## 0. 环境要求

| 依赖 | 版本要求 | 用途 |
|---|---|---|
| Python | ≥ 3.10 | 后端 FastAPI |
| Node.js | ≥ 18 | 前端 Vite |
| Docker Desktop | 任意近期版本 | 运行 Neo4j（也可自行安装 Neo4j Desktop，改 `.env` 连接即可） |
| 大模型 API Key | 任一 OpenAI 兼容服务 | 三元组抽取 / 报告生成 / 推荐语（**必须自己申请**） |

> 没有 Key 也能跑：设置 `ENABLE_MOCK_ENGINES=True` 进入离线 Mock 模式（抽取用内置规则，报告用模板），功能可演示但智能程度降级。

## 1. 启动 Neo4j（知识图谱数据库）

方式一（推荐，Docker）：

```bat
docker run -d --name personal-kg-neo4j -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=neo4j/your_password neo4j:5-community
```

方式二：使用 Neo4j Desktop / 已安装的 Neo4j 服务，记住 bolt 地址、账号、密码即可。

## 2. 后端配置与启动

### 2.1 创建 `.env`

复制 `backend/.env.example` 为 `backend/.env`，填入你的实际值。**LLM 必须换成你自己的 Key**：

```env
# Neo4j（对应第 1 步）
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_password

# 大模型（任一 OpenAI 兼容接口，三选一示例）
# DeepSeek:   https://api.deepseek.com/v1        模型 deepseek-chat
# 通义千问:   https://dashscope.aliyuncs.com/compatible-mode/v1  模型 qwen-plus
# OpenAI:     https://api.openai.com/v1          模型 gpt-4o-mini
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-你的key
LLM_MODEL=deepseek-chat

# 校园网/代理环境报 SSL 证书错误时设为 False，否则保持 True
LLM_VERIFY_SSL=True

# 无 Key 离线开发时设为 True（Mock 抽取+模板报告）
ENABLE_MOCK_ENGINES=False
```

### 2.2 安装依赖并初始化图谱

```bat
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/

python scripts\init_kg.py        :: 初始化个人 KG 约束
python scripts\seed_domain_kg.py :: 导入领域 KG 种子（5 障碍）
```

> 国内网络建议用阿里云镜像；清华源在本机实测不通。

### 2.3 启动后端

```bat
venv\Scripts\python.exe -m uvicorn app.main:app --port 8001 --host 127.0.0.1
```

保持该窗口打开（关闭即停止）。启动后访问 `http://localhost:8001/docs` 可看到 Swagger。
也可以直接双击 `backend\start.bat`（等效命令）。

## 3. 前端配置与启动

```bat
cd frontend
npm install
npm run dev
```

启动后终端会显示地址（默认 `http://localhost:5173`，端口被占用时自动切 5174/5175，**后端 CORS 白名单已放行这三个端口，无需改动**）。

前端默认请求 `http://localhost:8001`（见 `frontend/src/services/api.ts` 的 `API_BASE`），如后端不在本机请修改该常量。

## 4. 使用入口

1. 打开前端地址，用测试账号登录（`xiaoyu / 123456`）；
2. 侧边栏底部「**智能心理助手**」分组进入三个新页面：
   - 对话助手（聊天→抽取入图→生成心理报告）
   - 我的图谱（个人知识图谱可视化）
   - 今日推荐（缓解内容 + 兴趣推送 + 预警记录）；
3. 原「心理筛查」页提交 PHQ-9/GAD-7 量表后，得分会自动写入个人图谱并触发最新风险评估。

## 5. 常见问题（FAQ）

**Q: 报 `Neo4j 未连接，请先启动 Neo4j 并配置 .env`？**
A: Neo4j 没启动或 `.env` 密码不对。Docker 方式重启：```docker start personal-kg-neo4j```；注意 Windows 重启后 Docker Desktop 需手动打开。

**Q: 报 `LLM 接口连接失败` / SSL 证书错误？**
A: 校园网等存在 SSL 拦截的环境，把 `.env` 中 `LLM_VERIFY_SSL=False`。

**Q: 报 `LLM 接口返回错误 HTTP 404`？**
A: `LLM_MODEL` 不是该服务的有效模型名。注意火山引擎方舟必须用 `ep-` 开头的接入点 ID 或平台有效模型 ID。

**Q: 不想配 Key 能跑吗？**
A: 能。`.env` 中 `ENABLE_MOCK_ENGINES=True`，LLM 相关全部自动降级为内置规则/模板。

**Q: 8001 端口被占用（`WinError 10048`）？**
A: 找到占用进程结束后再启动：```netstat -ano | findstr :8001``` 查 PID，然后 ```taskkill /F /PID <pid>```。

**Q: 前端提示"服务连接异常"？**
A: 依次检查：后端窗口是否还开着 → 浏览器 F12 看请求地址和 CORS 报错 → 确认前端跑在 5173/5174/5175。

**Q: 音乐推荐想接真实歌单？**
A: 自行部署 [NetEaseCloudMusicApi](https://github.com/Binaryify/NetEaseCloudMusicApi)，在 `.env` 加 `MUSIC_API_URL=http://localhost:3000`；不配则使用内置种子兜底。

## 6. 验证脚本（可选）

```bat
python scripts\verify_stage3.py       :: 阶段3 端到端（图谱/推理/预警）
python scripts\verify_scale_decay.py  :: 量表回写 + 时间衰减验证
```
