# 个人端智能心理助手：新增 Agent 与知识图谱功能技术报告

> 版本：阶段 1–3.5 ｜ 日期：2026-10-12
> 依据论文：《面向心理咨询的改进知识图谱融合多智能体协作方法》（刘希）

## 一、建设背景

原系统为"动态跨模态哈希检索 + RAG 心理筛查预警平台"，仅具备机构端的筛查记录与预警看板，**无后端服务、无知识图谱、无 Agent 能力**。本阶段基于上述论文思路，为**个人端**新增"每用户专属知识图谱 + 多 Agent 协作"能力，形成「兴趣采集 → 心理状况推理 → 针对性缓解推荐 → 分级预警」的完整闭环。

## 二、总体架构

```
个人端（React，/personal/me/* 三个页面）
        │  HTTP (8001)
        ▼
FastAPI 后端（backend/app）
  ├─ Agent 1  兴趣/事实采集 Agent   —— LLM 三元组抽取（Mock 兜底）
  ├─ Agent 2  心理状况推理 Agent     —— 双图谱查询 + 规则评分 v2（时间衰减）
  ├─ Agent 3  缓解推荐 Agent        —— 种子库 + 音乐 API + LLM 生成推荐语
  ├─ Agent 4  定时日常问询 Agent     —— APScheduler 每日触发个性化问询
  └─ 安全子系统  危机词直判红级 → 绕过推荐链路，直接写预警库
        │
        ├─ Neo4j（个人 KG + 迷你领域 KG，容器 gifted_buck）
        └─ SQLite（mental_screening.db，预警记录）
```

**双图谱设计**（论文核心思想的落地）：
- **个人 KG**：每用户一棵子图，`(:User {user_id})` 为根隔离数据；实体（Emotion/Symptom/LifeEvent/Trigger/Interest）全局共享，用户事实写在**带属性的关系边**上（如 `value`、`updated_at`）。
- **领域 KG**：5 类心理障碍种子（抑郁/焦虑/失眠/强迫/社交恐惧）+ 各自症状、诱因、应对建议，供推理 Agent 对照匹配。
- 两库分查：个人子图聚合 → 对照领域 KG 的 `HAS_SYMPTOM/HAS_TRIGGER` 打分。

## 三、Agent 功能明细

### Agent 1：兴趣与事实采集 Agent
- 用户在 ChatPage 自由对话，LLM 按预定义 Schema 抽取三元组
  `(User)-[LIKES/HAS_HOBBY/EXPERIENCED_EMOTION/SHOWS_SYMPTOM/EXPERIENCED_EVENT/HAS_TRIGGER]->(实体)`；
- LLM 不可用/未配置 Key 时自动回退**内置 Mock 抽取器**（关键词规则），保证离线可演示；
- `Interest.category` 写入**节点属性**（而非边上），保证推荐与推理查询一致。

### Agent 2：心理状况推理 Agent（核心）
- **风险评分 v2（加权）**：`综合分 = 量表×40% + 症状×35% + 情绪×25%`
  - 量表：个人 KG 中 PHQ-9/GAD-7/SCL-90/ISI/PSS-10 最新得分，按各量表实际满分归一化到 0–10；
  - 症状：对照领域 KG 的最高匹配障碍，症状数×1.0 + 诱因数×0.5；
  - 情绪：多次低强度负面情绪（均值≤3 且次数≥2），封顶 2 分。
- **时间衰减加权**：`权重 = 0.5^(天数/半衰期)`，仅查询侧计算、不改存储：
  量表 7 天 / 情绪 14 天 / 事件诱因 21 天 / 症状 30 天；兴趣（长期画像）不衰减；
  超 4 个半衰期的数据直接不计入——**解决"一个月前的考试压力仍推高评分"的时效性问题**。
- **危机词安全机制**：对话/症状中命中"自杀、自残、轻生"等词直判红级，绕过加权与推荐链路，自动写入 SQLite 预警库。
- 分数线：绿 <1.5 / 黄 1.5–2.9 / 橙 3.0–4.9 / 红 ≥5.0 或危机词。
- 报告组装优先 LLM 生成自然语言，失败回退模板（含免责说明）；纯 Cypher 规则推理，不依赖 LLM 也可运行。

### Agent 3：缓解推荐 Agent
- 按领域 KG 应对建议 + 用户 `Interest.category` 匹配排序推荐；
- 内容源：音乐（自建 NetEaseCloudMusicApi，可配）/ 体育赛事 / 影视 / 书籍 / 小说 / 漫画 / 动漫 / 美食 / 烹饪，均带种子库离线兜底；
- 推荐语由 LLM 生成（失败回退模板）。

### Agent 4：定时日常问询 Agent
- APScheduler **BackgroundScheduler** 每日 20:00 按用户兴趣画像生成个性化问询文案；
- 前端 ChatPage"今日问询"按钮可随时拉取；⚠️ 禁用 AsyncIOScheduler（与 uvicorn 事件循环冲突导致静默崩溃）。

### 量表得分自动回写（配套打通）
- 个人端 `/Screening` 量表提交后自动调用 `POST /api/v1/kg/scale` 写入个人 KG，
  可附带自动触发推理，实现"筛查 → 图谱 → 报告"闭环（此前量表结果只在前端展示，与推理链路断开）。

## 四、前端个人端页面（新导航分组"智能心理助手"，不影响原界面）

| 页面 | 功能 |
|---|---|
| ChatPage（/me/chat） | 对话 + 一键抽取入图 + 生成风险报告 + 今日问询按钮 |
| KgPage（/me/kg） | 零依赖 SVG 力导向图谱，按实体类型/兴趣类别着色，支持缩放拖拽 |
| FeedPage（/me/feed） | 状态卡片 + 个性化缓解推荐（兴趣推送标签）+ 预警等级时间线 |
| Screening（原有页增强） | 量表提交后回写 KG 并提示最新风险等级 |

## 五、关键技术决策与踩坑

1. **neo4j 驱动兼容**：新版驱动 `.data()` 把节点剥成纯属性 dict，labels/type 丢失——Cypher 显式 `RETURN labels(n), type(r)`。
2. **每用户子图隔离**：所有查询以 `user_id` 为根，实体全局共享，避免数据膨胀。
3. **端口约定**：后端 **8001**（8000 被 docker-compose 开发容器占用）；前端 Vite 5173，自动切换 5174/5175 时后端 CORS 白名单需同步放行。
4. **进程管理（Windows）**：`start.bat` 在 CMD 前台运行保活；后台 nohup 方式进程会被回收；重启前先确认端口释放。
5. **LLM 接入**：火山引擎方舟 OpenAI 兼容接口；校园网 SSL 拦截需 `LLM_VERIFY_SSL=False`。
6. **验证**：`backend/scripts/verify_stage3.py`（阶段3）、`verify_scale_decay.py`（量表回写+衰减端到端，含回拨时间验证衰减生效）。

## 六、主要接口一览

| 接口 | 说明 |
|---|---|
| POST /api/v1/kg/extract | 对话文本 → 三元组抽取并入图 |
| POST /api/v1/kg/scale | 量表得分回写（可选触发推理） |
| GET /api/v1/kg/graph/{user_id} | 个人子图（节点+边） |
| POST /api/v1/inference/run | 运行推理，返回风险报告 |
| GET /api/v1/alerts?user_id= | 预警记录查询 |
| GET /api/v1/recommendations/by_interest?user_id= | 兴趣推送 |
| GET /api/v1/checkin/daily?user_id= | 今日问询 |

## 七、阶段路线与当前进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1 | 后端骨架 + 个人 KG + 兴趣采集 Agent | ✅ |
| 2 | 迷你领域 KG + 推理 Agent + 预警对接 | ✅ |
| 3 | 缓解推荐 Agent + 前端三页面 | ✅ |
| 3.5 | 风险评分 v2 + 兴趣扩展 + 定时问询 + 量表回写 + 时间衰减 | ✅ |
| 4 | LoRA 微调 Text2Cypher、GNN 子图风险分类 | 待启动（冲刺/评奖） |
