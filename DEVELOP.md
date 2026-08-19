# 项目开发记录（DEV LOG）

> 本文档是「心理筛查预警系统」的**长期开发记录**，不只是当前部署迁移的任务记录：
> 它持续承载项目的调研结论、决策记录、实施计划、代码改动，以及过程想法与预留改进方向。
> 后续所有开发活动（新功能、重构、修复、部署变更等）都统一在此按日期追加，作为项目历史留档。
>
> 当前专项：**部署迁移**（本地/Docker → GitHub Pages 前端 + Cloudflare Workers 后端），详见「三 ~ 四」章节。
>
> **维护约定**：本文档是活文档，长期伴随项目。**每次开发活动**（迁移、新功能、修复、重构、决策变更）都须在「五、开发日志」追加记录（注明日期）；若改动涉及长期方向，同步更新对应章节。

---

## 一、文档状态总览

> 以下为**当前专项（部署迁移）**的进度；其他开发任务的记录统一见「五、开发日志」。

| 阶段 | 状态 |
|------|------|
| 项目现状调研 | ✅ 已完成 |
| Cloudflare 适配可行性调研 | ✅ 已完成 |
| 方案讨论与决策 | ✅ 已确定（2026-08-19；含 FastAPI → 轻量 Python Worker 方向调整） |
| 后端代码适配 | ✅ 完成（轻量化改造：去 FastAPI/Pydantic/SQLAlchemy） |
| 前端代码适配 | 🔄 进行中（源码改造已完成，待 GitHub Pages 部署） |
| 后端部署（Cloudflare Worker） | ✅ 已部署 https://mental-screening-api.787249795.workers.dev（gzip 73.63 KiB，免费额度） |
| 上线验证 | 🔄 待浏览器验证 |
| GitHub Pages 部署 | ⏳ 待配置 |

---

## 二、项目现状（调研结论）

### 2.1 技术架构

Monorepo，前后端分离：

```
DaChuang-FLCFZ/
├── backend/                     # Python FastAPI 后端
│   ├── app/
│   │   ├── api/v1/             # 9 个 API 模块
│   │   ├── core/               # 异常、统一响应、安全(JWT/bcrypt)
│   │   ├── db/                 # SQLAlchemy ORM + SQLite
│   │   ├── engines/            # 核心引擎（哈希检索 / 多模态 / RAG）
│   │   ├── schemas/            # Pydantic 模型
│   │   ├── services/           # 业务服务层
│   │   ├── config.py           # pydantic-settings 配置
│   │   └── main.py             # FastAPI 入口
│   ├── alembic/                # 数据库迁移
│   ├── data/retrieval_seed.db  # 检索语料种子库（约500条）
│   ├── uploads/                # 上传文件（本地磁盘）
│   ├── Dockerfile / start.sh / start.bat
│   └── requirements.txt
├── frontend/                    # React 19 + Vite 7 + TS 前端
│   ├── src/                    # 页面、组件、服务层、Mock 数据
│   └── vite.config.ts          # 开发代理配置
├── docs/                        # PRD / API / DEPLOYMENT 文档
└── docker-compose.yml           # 本地 Docker 一键部署
```

### 2.2 技术栈明细

| 部分 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 前端 | React / TypeScript / Vite | 19.x / 5.x / 7.x | Tailwind 4、React Router 7（BrowserRouter）、axios、Recharts |
| 后端 | Python / FastAPI | 3.11+ / 0.115.x | SQLAlchemy 2.0、Alembic、Pydantic 2、python-jose、passlib[bcrypt] |
| 数据库 | SQLite | - | 本地文件 `data/dev.db` + 种子库 `data/retrieval_seed.db` |
| 检索 | 本地 TF-IDF | - | 位于 `deepseek_rag_engine.py`，零依赖标准库实现 |
| 哈希引擎 | 纯 Python CMFH + LSH | - | 可选 numpy 加速，状态持久化到本地 JSON |
| 多模态 | Mock 处理器 | - | CLIP/Whisper 未实现，占位 |
| RAG 生成 | DeepSeek（urllib 调用） | - | 已实现；无 Key 时自动降级 Mock 报告 |

### 2.3 前端已有的云化友好设计（调研发现）

- [http.ts](../frontend/src/services/http.ts) 已支持 `VITE_API_BASE_URL`（生产后端地址注入）、`VITE_USE_MOCK`（Mock 开关）、`VITE_DEV_PROXY_TARGET`（开发代理）。
- 存在完整 Mock 数据层（`mockApi.ts` + `mockData.ts` + `mockAuth.ts`），可脱离后端纯静态演示。
- 路由使用 `BrowserRouter`（非 HashRouter），GitHub Pages 子路径部署需处理 base + 404 兜底。

---

## 三、迁移目标与决策记录

### 3.1 迁移目标

- **前端** → GitHub Pages（静态构建，全球 CDN）
- **后端** → Cloudflare Workers（serverless，免运维）
- **原则**：只做适配、**零功能新增**；已实现功能全量搬上云，未实现功能保持占位。

### 3.2 决策记录（2026-08-19 确定）

| # | 决策点 | 结论 | 理由 |
|---|--------|------|------|
| 1 | 后端计算层 | **A. Python Workers（FastAPI 保留）** | 免费额度（10万请求/天）；FastAPI 代码可保留；无需 TS 重写 |
| 2 | 向量检索 | **本期不做 Vectorize（纯适配）** | 用户明确：当前不做任何功能新增；仅预留改进方向 |
| 3 | 前端部署位置 | **GitHub Pages，前后端分开** | 符合用户最初设想 |
| 4 | 功能范围 | **纯适配，零新增** | 已实现全量改造，未实现保持占位（Mock） |

### 3.3 备选方案留档（讨论过程中评估过，最终未选）

| 方案 | 做法 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| B. Cloudflare Containers | 现有 Dockerfile 直接 `wrangler containers deploy` | 代码改动最小，numpy 无压力 | 需付费计划（$5/月起）；磁盘临时仍需 D1/R2 | 备选，后续若 Python Worker 受限可切换 |
| C. Cloudflare Tunnel | cloudflared 隧道暴露本机 FastAPI | 零改动 | 机器需常开，不算真正部署在云 | 仅作应急 |
| D. Mock 演示 | 前端纯静态 + VITE_USE_MOCK | 零后端改动 | 无真实后端 | 前端离线演示可用 |

---

## 四、迁移实施计划（将推进）

> 按执行顺序排列，每个任务完成后更新「五、开发日志」。

### 4.1 后端适配（Cloudflare Python Worker）

**技术选型**
- 运行时：Cloudflare Python Workers（Pyodide，Python 3.12+），`python_workers` 兼容标志
- 工具链：`uv` + `workers-py`（pywrangler），`wrangler` 部署
- 入口：`WorkerEntrypoint` + `asgi.fetch(app, request, env)` 包装现有 FastAPI

**改造清单**

| # | 模块 | 改动 | 类型 |
|---|------|------|------|
| 1 | 新增 Worker 项目骨架 | `pyproject.toml`、`wrangler.toml`、`src/entry.py` | 适配 |
| 2 | 数据层 [session.py](backend/app/db/session.py) | SQLite engine → D1（`sqlalchemy-cloudflare-d1` dialect `create_engine_from_binding`）；ORM 模型不动 | 适配 |
| 3 | 种子数据 | `retrieval_seed.db` → D1（`wrangler d1 execute --file`） | 适配 |
| 4 | 上传 [upload.py](backend/app/api/v1/upload.py) | 本地磁盘 → R2 对象存储（multipart 流式） | 适配 |
| 5 | 检索 [deepseek_rag_engine.py](backend/app/engines/rag/deepseek_rag_engine.py) | 保留现有 TF-IDF 检索，原样适配 | 适配 |
| 6 | RAG 生成 | DeepSeek urllib 调用 → 适配 Worker 网络环境（验证 urllib 或改用 fetch） | 适配 |
| 7 | 认证 [security.py](backend/app/core/security.py) | bcrypt/JWT 验证 Pyodide 兼容性，不兼容换等效纯 Python 实现 | 适配 |
| 8 | 哈希引擎 | 代码保留；验证免费额度 10ms CPU 限额，超限走 Mock/降级路径 | 适配/降级 |
| 9 | CORS [main.py](backend/app/main.py) | 放行 GitHub Pages 来源 | 适配 |
| 10 | 密钥 | DeepSeek Key、JWT Secret 放 Cloudflare Secrets / vars | 配置 |

### 4.2 前端适配（GitHub Pages）

| # | 改动 | 说明 |
|---|------|------|
| 1 | `vite.config.ts` | 配置 `base`（计划用相对路径 `./`，实现仓库无关） |
| 2 | SPA 路由兜底 | 新增 `public/404.html`（复制 index.html），解决 BrowserRouter 刷新 404 |
| 3 | API 地址 | 构建时注入 `VITE_API_BASE_URL=https://<worker>.workers.dev` |
| 4 | GitHub Actions | 新增 workflow：`npm ci && npm run build` → `actions/deploy-pages` 发布 |

### 4.3 部署配置

- GitHub Actions 中后端部署：`cloudflare/wrangler-action`（需 `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` secrets）
- D1 / R2 / Vectorize（预留）资源在 Cloudflare Dashboard 或 wrangler CLI 创建
- 域名：暂按 `*.workers.dev` 默认域名，后续可绑自定义域名（改进方向）

### 4.4 里程碑

- [ ] M1：Worker 最小骨架 + FastAPI 跑通（验证 pydantic-core/Pyodide 兼容）
- [ ] M2：D1 数据层适配 + 种子数据迁移
- [ ] M3：R2 上传适配 + 检索/RAG 适配
- [ ] M4：前端 GitHub Pages 适配 + Actions
- [ ] M5：联调 + 上线验证

---

## 五、开发日志（长期改动记录）

> **所有开发活动**（含部署迁移专项）在此按日期追加，长期累积；新记录加在表格末尾。
> 建议每次记录包含：日期、变更内容、涉及文件、备注（含决策理由与回退路径）。

| 日期 | 变更内容 | 涉及文件 | 备注 |
|------|---------|---------|------|
| 2026-08-19 | 完成项目调研与 Cloudflare 适配可行性分析 | - | 未改代码，仅文档与决策 |
| 2026-08-19 | 创建本文档（前身为 MIGRATION.md 项目迁移文档，并入后定位为长期开发记录） | DEVELOP.md | 建立开发记录基线 |
| 2026-08-19 | 文档定位扩展为长期开发记录：迁移仅为当前专项，后续所有开发活动统一按日期记录 | DEVELOP.md | 「五、改动记录」更名「五、开发日志」，更新引言与维护约定 |
| 2026-08-19 | 双模式运行时层：新增 `runtime.py`（is_worker/绑定注入）；`config.py` 支持 Worker vars/secrets 注入与 R2 配置 | app/core/runtime.py（新增）、app/config.py | 本地行为完全不变，Worker 走适配路径 |
| 2026-08-19 | 数据层 D1/SQLite 双模式：engine/session 工厂懒加载，Worker 下经 `sqlalchemy-cloudflare-d1` 走 D1 binding | app/db/session.py | `SessionLocal()` 调用方式保持兼容 |
| 2026-08-19 | main.py 适配：Worker 下跳过 uploads 目录创建与哈希引擎预热、不挂载 /uploads 静态目录 | app/main.py | CORS 保持不变 |
| 2026-08-19 | 密码哈希统一 `pbkdf2_sha256`（passlib 纯 Python，Pyodide 可用），verify 兼容旧 bcrypt 哈希 | app/core/security.py | 新哈希格式 `$pbkdf2-sha256$`；云端/本地凭据均可验证 |
| 2026-08-19 | 上传接口 R2 双模式：Worker 写入 R2（binding UPLOADS），本地仍写磁盘；返回路径兼容 | app/api/v1/upload.py | 多模态 Mock 处理器保持原调用 |
| 2026-08-19 | RAG 网络调用去线程化：移除 `asyncio.to_thread`（Pyodide 无线程），Worker 下改用 JS fetch | app/engines/rag/deepseek_rag_engine.py | payload 与本地 urllib 完全一致 |
| 2026-08-19 | 哈希引擎 Worker 下降级 Mock（免费 CPU 限额 + 状态无法持久化），留改进方向注释 | app/engines/__init__.py | 本地真实引擎不受影响 |
| 2026-08-19 | Cloudflare Worker 骨架：pyproject.toml（Pyodide 最小依赖集）、wrangler.toml（D1/R2/vars/secrets）、src/entry.py（asgi 桥接 + 引导） | backend/pyproject.toml、backend/wrangler.toml、backend/src/entry.py（均新增） | D1/R2 资源 ID 待创建后填入 |
| 2026-08-19 | D1 建表 SQL（由 alembic 001_init 转译）与本地 SQLite → D1 种子数据导出脚本 | backend/worker/seed/schema.sql、backend/scripts/export_d1_seed.py（均新增） | 密码哈希 pbkdf2 生成，Worker 可验证登录 |
| 2026-08-19 | 前端 GitHub Pages 适配：vite `base` 支持 VITE_BASE_PATH 注入、React Router basename 联动、构建后生成 404.html SPA 兜底、.env.production 占位 | frontend/vite.config.ts、frontend/src/main.tsx、frontend/package.json、frontend/.env.production | BrowserRouter 保留，子路径刷新不 404 |
| 2026-08-19 | .gitignore 补充 wrangler 本地状态与 D1 种子导出排除 | backend/.gitignore | 避免敏感数据入库 |
| 2026-08-19 | 云端资源：创建 D1 数据库 `mental-screening-db`（ID `3323979e-4a7d-4246-80ef-458a3ce356d0`，区域 WNAM）并填入 wrangler.toml | backend/wrangler.toml | 部署前置完成 |
| 2026-08-19 | R2 未激活处理：Dashboard 未激活 R2（API code 10042），暂注释 wrangler.toml 的 r2_buckets；upload.py 在 Worker 下检测到 UPLOADS 绑定缺失时返回 503 明确提示 | backend/wrangler.toml、backend/app/api/v1/upload.py | 仅影响「文件上传」接口，其余功能不受影响；激活后取消注释 + 创建 bucket 即可恢复 |
| 2026-08-19 | **方向调整（重大）**：免费计划 3MB(gzip) 体积限制放不下 FastAPI+SQLAlchemy（pydantic-core 单文件 4MB），决策放弃 FastAPI 技术栈 → 轻量 Python Worker | - | 讨论确认：B 方案「保留 Python 引擎/业务，API+数据层改标准库手写」 |
| 2026-08-19 | **后端轻量化改造**：config 去 pydantic-settings；JWT 自实现 HS256（去 jose）；数据层 `app/db/database.py`（sqlite3 本地 / D1 Worker 双模式，内嵌建表 SQL）；services 原生 SQL；`app/handlers/` 手写路由 handler（替代 FastAPI 装饰器）；`app/router.py` 路由分发；`app/server.py` 本地标准库 HTTP 服务器 | app/config.py、app/core/*、app/db/database.py、app/services/*、app/handlers/*、app/router.py、app/server.py | 引擎（哈希/RAG/多模态）全保留；上传暂 503 占位（multipart 解析待 R2 激活后实现） |
| 2026-08-19 | 删除旧 FastAPI 模块：app/api/、app/db/models/、app/schemas/、app/db/session.py、alembic/、旧 init_data.py 与 scripts | - | 由 handlers/database.py 替代；本地初始化改 `scripts/init_local_db.py` + `scripts/smoke_test.py` |
| 2026-08-19 | **部署成功（免费额度）**：Worker 打包仅 backend wheel（纯标准库），Total Upload 271.77 KiB / gzip 73.63 KiB，远低于 3MB 限制；部署至 https://mental-screening-api.787249795.workers.dev | backend/worker/（entry.py 手动路由、pyproject 仅 wheel 依赖） | 本地冒烟测试通过（登录/鉴权/401/检索/个人端）；云端接口待浏览器验证 |

---

## 六、技术要点与风险备忘

### 6.1 Cloudflare Python Workers 限制（Pyodide）

- **无线程**：所有路由 handler 必须 `async def`；同步 handler 会报 `RuntimeError: can't start new thread`。
- **CPU 限额**：免费计划 10ms CPU/请求；付费计划 30s CPU/请求。哈希引擎（特征值分解 O(n²)）免费额度下跑不完 → 检索已确定保留 TF-IDF + 引擎走降级。
- **文件系统临时**：内存文件系统，isolate 销毁即丢失 → 持久数据必须用 D1 / R2 / KV。
- **静态导入**：`__import__()` / `importlib.import_module()` 不可用，导入必须写在模块顶层。
- **标准库差异**：`multiprocessing` / `threading` 不可用；`sqlite3` 内置可用（内存）。

### 6.2 风险清单

| 风险 | 等级 | 应对 |
|------|------|------|
| pydantic-core（FastAPI 依赖）在 Pyodide 的兼容性 | 中 | M1 先做最小可运行验证；社区有官方 FastAPI 示例成功，也有个别 issue，需实测 |
| sqlalchemy-cloudflare-d1 第三方库成熟度 | 中 | M2 验证；若不可用则手写 D1 适配层（`env.DB.prepare(...)`），业务 SQL 改动集中在 session/service 层 |
| bcrypt C 扩展在 Pyodide | 中 | 不兼容则换纯 Python 方案（如 `hashlib` + 随机盐），M1 一并验证 |
| 上传 R2 multipart 适配 | 低 | FastAPI UploadFile → 流式写入 R2，逻辑集中在一个文件 |
| GitHub Pages SPA 路由 | 低 | 404.html 兜底方案成熟 |

---

## 七、预留改进方向（想法记录，未实现）

> 以下为讨论中产生的想法，**本期不实现**，仅记录便于后续推进。均为"新增功能"，实施前需与需求方确认。

1. **Vectorize 语义检索**（用户已明确向量数据库是长期必需）
   - 用 Workers AI 中文 embedding（如 bge-m3）+ Vectorize 替代/补充现有 TF-IDF 检索
   - 免费额度：每索引 500 万向量、100 索引、1536 维、查询约 31ms
   - 注意：Vectorize 无全文搜索，接入即完整替换 TF-IDF 关键词检索
   - 预留位置：[rag/interface.py](backend/app/engines/rag/interface.py) 已是抽象接口，新增 Vectorize 引擎实现即可
2. **多模态真实分析**：Mock 处理器 → CLIP（图像）/ Whisper（语音），可依托 Cloudflare Workers AI 或容器
3. **哈希引擎云端化**：若 CPU 限额不足，可拆为专门 Worker / 付费计划 / 容器运行，或接入向量检索协同
4. **AutoRAG**：Cloudflare 全托管 RAG（open beta），上传 R2 文档后自动切分/embedding/检索/生成，可作低代码备选
5. **自定义域名**：前后端分别绑自定义域名，消除 GitHub Pages 子路径与 workers.dev 域名限制
6. **Cloudflare 缓存/安全增强**：CDN 缓存策略、WAF、速率限制（生产化必做）
7. **数据备份**：D1 自动备份与恢复策略（上线后配置）

---

## 八、待办与账号准备（需用户操作）

- [x] **Cloudflare 账号 / API Token**：已创建（`Edit Cloudflare Workers` + D1:Edit 权限），Account ID `0aea5331ce7c1727d6a4d82767d8f1c0`；本地以 `CLOUDFLARE_API_TOKEN` 环境变量使用。⚠️ Token 曾在对话中明文出现，部署完成后建议在 Dashboard 轮换一次。
- [ ] **R2 激活**（未激活，`wrangler r2 bucket create` 报 code 10042）：Dashboard → R2 → 激活免费计划后，取消 [wrangler.toml](../backend/wrangler.toml) 中 r2_buckets 注释，并执行 `npx wrangler r2 bucket create mental-screening-uploads`。**影响范围：仅「文件上传」接口**（语音/图像/文档采集），其余功能不受影响。
- [ ] **GitHub 仓库**：确认项目是否已推到 GitHub；未推则先建仓（仓库名决定前端 `VITE_BASE_PATH`，如 `/DaChuang-FLCFZ/`）
- [ ] **GitHub Actions secrets**：`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`（后端部署 workflow 用）
- [ ] **DeepSeek API Key**（可选）：无则保持 Mock 降级，功能不受影响；有则 `npx wrangler secret put DEEPSEEK_API_KEY`

---

## 九、参考资料

- Cloudflare Containers 公测公告：https://blog.cloudflare.com/containers-are-available-in-public-beta-for-simple-global-and-programmable
- Python Workers 更新（uv-first + 包支持）：https://blog.cloudflare.com/python-workers-advancements/
- Python Workers 官方文档：https://developers.cloudflare.com/workers/languages/python/
- D1 从 Python Worker 查询：https://developers.cloudflare.com/d1/examples/query-d1-from-python-workers
- sqlalchemy-cloudflare-d1（SQLAlchemy D1 dialect）：https://pypi.org/project/sqlalchemy-cloudflare-d1/
- Vectorize 文档：https://developers.cloudflare.com/vectorize/
- AutoRAG 介绍：https://blog.cloudflare.com/introducing-autorag-on-cloudflare/
