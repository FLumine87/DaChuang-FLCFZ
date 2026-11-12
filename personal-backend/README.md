# backend - 个人端 KG + Agent 服务

阶段 1 + 2 + 3 交付：FastAPI 骨架 + Neo4j 个人知识图谱 + 兴趣采集 Agent
+ 心理状况推理 Agent（双图谱查询）+ 预警对接（SQLite）+ 缓解推荐 Agent
+ 前端个人端三页面（对话 / 图谱可视化 / 推送）。

> 注意：本机 8000 端口被 Docker Compose 的后端容器占用，本服务统一使用 **8001** 端口。

## 快速开始

```bash
# 1. 配置环境（Neo4j 与 LLM 均可后配，Mock 模式可离线运行）
copy .env.example .env

# 2. 启动（自动建 venv、装依赖、起服务）
start.bat
```

服务启动后：API 文档 http://localhost:8001/docs

## 验证脚本

```bash
venv\Scripts\python scripts/verify_stage3.py   # 端到端：health + 推理+推荐 + 图谱 + 预警
```

## 离线演示（无需 Neo4j / LLM Key）

```bash
venv\Scripts\python scripts/demo_extract.py        # 兴趣采集（Mock 抽取）
venv\Scripts\python scripts/demo_inference.py demo_user   # 推理 Agent（需 Neo4j）
```

## 接入 Neo4j

1. 启动 Neo4j（本地安装或 `docker start gifted_buck` / `docker run -p 7687:7687 -p 7474:7474 neo4j`）
2. 在 `.env` 中填写 `NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD`
3. 初始化本体（约束与索引）：`venv\Scripts\python scripts/init_kg.py`
4. 导入领域 KG 种子数据（5 种障碍 + 症状/诱因/应对建议）：`venv\Scripts\python scripts/seed_domain_kg.py`
5. 写入演示数据：`venv\Scripts\python scripts/demo_extract.py --write`

## 接入真实 LLM（火山引擎方舟）

```env
LLM_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
LLM_API_KEY=sk-...
LLM_MODEL=ep-xxxxxxxxxxxxx   # 接入点 ID 或模型 ID
ENABLE_MOCK_ENGINES=False
LLM_VERIFY_SSL=False         # 校园网 SSL 拦截时开启
MUSIC_API_URL=               # 可选：自建 NetEaseCloudMusicApi 地址，如 http://localhost:3000
```

## API 一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/health | 健康检查（含 Neo4j 状态与运行模式） |
| POST | /api/v1/kg/extract | 兴趣采集 Agent：文本 → 三元组 → 写入个人 KG |
| POST | /api/v1/kg/triples | 手动批量写入三元组（量表回写等场景） |
| GET | /api/v1/kg/graph/{user_id} | 获取个人子图（前端可视化用） |
| DELETE | /api/v1/kg/users/{user_id} | 清空用户子图（调试用） |
| POST | /api/v1/inference/run | 推理 + 缓解推荐：返回 `{report, content_feed}`；橙/红级自动写预警；红级 content_feed 为空（走预警） |
| GET | /api/v1/alerts | 预警列表（可按 user_id/level/status 过滤） |
| GET | /api/v1/alerts/{id} | 预警详情 |
| POST | /api/v1/alerts | 手动创建预警 |
| POST | /api/v1/alerts/{id}/status | 状态流转 pending → confirmed → processing → closed |

## 个人 KG 本体（阶段 1）

```
(:User {user_id})-[LIKES {category}]->(:Interest {category})
(:User)-[FOLLOWS {category}]->(:Interest)
(:User)-[EXPERIENCED_EMOTION {value}]->(:Emotion)
(:User)-[SHOWS_SYMPTOM]->(:Symptom)
(:User)-[EXPERIENCED_EVENT]->(:LifeEvent)
(:User)-[HAS_TRIGGER]->(:Trigger)
(:User)-[RESPONDS_TO {value}]->(:Coping)
```

实体节点全局共享（同名同节点），用户事实通过带属性的边表达；
每用户即一个以 `User` 为根的子图。

## 领域 KG 本体（阶段 2，全局共享）

```
(:Disorder)-[HAS_SYMPTOM]->(:Symptom)
(:Disorder)-[HAS_TRIGGER]->(:Trigger)
(:Disorder)-[RECOMMEND_COPING]->(:Coping {category})
```

推理逻辑：聚合个人子图（近 30 天症状/情绪/事件）→ 对照领域 KG 匹配障碍
（按症状覆盖率打分）→ 绿(<1)/黄(1-1.9)/橙(2-2.9)/红(≥3 或危机词直判) →
轻中度推荐应对方式（优先匹配用户兴趣画像），橙红级自动落预警。

预警数据存 SQLite（`backend/mental_screening.db`），与 Neo4j 图谱数据分离。

## 缓解推荐 Agent（阶段 3）

`app/services/recommendation_agent.py`：把推理报告的应对建议映射为具体缓解内容——
音乐类兴趣 → 歌单推荐（优先调 MUSIC_API_URL 指向的 NetEaseCloudMusicApi，失败用内置种子）；
体育赛事类兴趣 → 关注的球队/赛事动态（种子库，可扩展 RSS/API）；其他 → 心理科普文章。
LLM 可用时生成推荐语（ENABLE_LLM_CONTENT），失败回退模板。红级/危机时不推荐娱乐内容。

## 前端个人端（阶段 3）

前端 `src/pages/me/` 下三个页面，挂在 `/personal/me/*` 路由（用户角色登录后可见）：
- `ChatPage.tsx` 对话页：发消息 → 后端抽取三元组入图谱 → 本地兜底回复；可弹窗生成推理报告
- `KgPage.tsx` 图谱页：力导向 SVG 可视化个人子图，支持点击节点查看关联
- `FeedPage.tsx` 推送页：展示当前状态 + 个性化缓解内容 + 累积预警记录

前端通过 `src/services/api.ts` 封装后端调用，默认指向 `http://localhost:8001`，
可用环境变量 `VITE_API_BASE` 覆盖。前端登录用户名即 KG 的 user_id（如 `xiaoyu`）。


## 接入真实大模型（陪伴对话 / 三元组抽取）

`.env` 里三行决定它走真实大模型还是内置模板：

```ini
ENABLE_MOCK_ENGINES=False                        # 必须关掉，否则永远走内置逻辑
LLM_BASE_URL=https://api.deepseek.com/v1         # 任何 OpenAI 兼容端点
LLM_API_KEY=sk-你的真实key                        # 形如 sk- 后跟 30+ 位
LLM_MODEL=deepseek-chat
```

改完重启本服务（`venv/bin/python -m uvicorn app.main:app --port 8001`），
然后看 `GET /api/v1/health`：

```json
{"status":"ok","neo4j_connected":false,"mock_mode":false}
```

`mock_mode` 变成 **false** 就说明接上了。此时前端「AI 陪伴对话」会出现
**逐字打字机效果**，回复由大模型生成、并从中抽取三元组补到该条回复下方。

### 没有 Key 时怎么验证链路

`scripts/fake_openai.py` 是一个**本地假的 OpenAI 兼容接口**（会按协议发 SSE），
用来证明"问题只在 Key、不在代码"：

```bash
venv/bin/python scripts/fake_openai.py          # 起在 8899
# 再把 .env 的 LLM_BASE_URL 指到 http://127.0.0.1:8899/v1，KEY 随便填
```

实测该链路下前端确实逐字流入（每 200ms 约 5 个字），三元组也能补上。
**注意：它返回的是写死的文案，只用于验证，不要拿它演示。**
