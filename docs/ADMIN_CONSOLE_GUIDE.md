# 管理端开发交接：仪表盘、预警和案例

更新于 2026-10-12。本文面向刚加入项目的开发成员。管理端代码位于独立开发分支 `codex/admin-console-20261007`，已整合 2026-10-12 的 `main`；**尚未合并或部署**，线上网站仍是旧版。

## 1. 先理解系统和你的工作

系统让个人完成心理量表筛查，再向管理员展示需要跟进的预警和案例。项目另有多模态检索与 RAG 模块；本次管理端工作聚焦三个页面：仪表盘、预警管理、案例管理。

当前运行架构是 React + TypeScript + Vite 前端，Python 标准库轻量路由后端，本地 SQLite / Cloudflare D1 数据库。README 和项目书中 FastAPI、SQLAlchemy、Alembic 的描述属于旧架构，请以 `backend/app/main.py`、`backend/app/router.py`、`backend/app/db/database.py` 和 `backend/worker/src/entry.py` 为准。

一条数据怎样进入管理端：

```text
个人端作答 → POST /api/personal/screenings
             → 后端校验原始答案并计算分数、风险等级
             → screenings（写入 user_id）
             → cases（按 user_id 建档/更新）
             → 高风险时产生 alerts

管理员登录 → /api/admin/dashboard（数据库统计）
           → /api/admin/alerts（列表、详情、处置、处理历史）
           → /api/admin/cases（列表、详情、筛查/预警/跟进时间线）
```

`VITE_USE_MOCK=true` 时前端使用内置演示样本，页面会标出“演示数据”；`false` 才通过 API 读取数据库。数据库里即使有种子数据，统计也是实时 SQL 聚合，不能把样本误当真实业务用户。

## 2. 这次完成了什么

| 阶段 | 主要文件 | 作用 |
| --- | --- | --- |
| 数据和权限 | `backend/app/db/database.py`、`backend/worker/seed/schema.sql`、`backend/worker/seed/003_admin_ownership.sql`、`backend/app/handlers/__init__.py`、`backend/app/handlers/auth.py` | 筛查/案例增加账号归属，新增预警处理历史；收紧管理类接口权限；注册不能自行指定 admin 角色。 |
| 业务后端 | `backend/app/handlers/admin.py`、`backend/app/handlers/personal.py`、`backend/app/services/{screening_service,alert_service,case_service}.py` | 从数据库统计；预警筛选、分页、详情、顺序状态流转、分配、备注；案例详情和时间线；个人作答由后端复算；修复异步漏 `await`。 |
| 前端 | `frontend/src/services/adminApi.ts`、`frontend/src/admin/pages/{AdminDashboard,AdminAlerts,AdminCases}.tsx` | 接真实管理接口；展示加载、空数据、错误与重试；编辑可取消；提交防连点。 |
| 相关体验 | `frontend/src/{components/QuestionnaireForm.tsx,pages/Screening.tsx,pages/AuthPage.tsx,services/http.ts}` | 发送原始答案、提交失败保留表单、提示正确的演示账号、修复 GitHub Pages 的登录过期跳转。 |
| 验证 | `backend/scripts/test_admin_workflow.py` | 临时 SQLite 自动测试；不碰团队数据库。 |

预警状态只允许 **待处理 → 处理中 → 已解决 → 已关闭**，进入“已解决”必须填写本次处理记录。案例状态可在“进行中、持续观察、已结案”间更新，变更会进入案例时间线。旧案例没有 `user_id` 时，详情明确提示未关联，不通过同名推测归属。

## 3. 如何在本地运行和核对

在 `backend/` 执行 `python -m app.main` 启动本地 API。它会为现有本地 SQLite 表补齐 `user_id` 列。前端在 `frontend/` 安装依赖后执行 `npm run dev`。若不使用 Docker，请在 `frontend/.env.local` 设置：

```env
VITE_USE_MOCK=false
VITE_API_BASE_URL=
VITE_DEV_PROXY_TARGET=http://localhost:8000
```

配置演示模式时改为 `VITE_USE_MOCK=true`，该模式不会写入真实数据库。不要把演示模式的样本数量用于汇报真实业务量。使用真实模式前，需要数据库里已有管理员账号和问卷；`backend/scripts/init_local_db.py` 在种子 SQL 存在时可初始化本地样本库。

快速验证：

```text
backend/:  python scripts/test_admin_workflow.py
frontend/: npm run build
frontend/: npx eslint src/admin/pages/AdminDashboard.tsx src/admin/pages/AdminAlerts.tsx src/admin/pages/AdminCases.tsx src/services/adminApi.ts
```

自动测试覆盖数据库统计、账号隔离、普通用户禁止访问管理接口、公开注册不能提权、预警状态与重复请求、案例跟进和时间线、个人作答服务端复算。手工浏览器验证覆盖演示/真实数据展示、筛选、详情、返回、取消、重复点击、接口失败与重试。`npm run lint` 目前仍有两个与本次改动无关的旧报错：`src/auth/mockAuth.ts` 未使用参数和 `src/hooks/useAudioRecorder.ts` 渲染时访问 ref；本次修改文件单独检查通过。

## 4. 队长演示顺序

1. 用独立的测试数据库登录管理端，指出仪表盘数字与数据库记录一致，空库时显示空态。
2. 提交一次个人端问卷；返回管理端，刷新查看筛查数、案例和高风险预警变化。演示时只用虚构测试数据。
3. 在预警页按等级/状态筛选，打开详情，分配处理人，填写备注，逐步推进状态并查看审计历史。试一次取消修改。
4. 在案例页查看该账号的筛查、预警与时间线，添加一条跟进，再变更案例状态。
5. 暂停测试 API，展示错误提示；恢复后点“重试”。指出演示模式有明显标记，线上网站尚未更新。

## 5. 上线前仍需团队处理

- **先迁移 D1**：已有 Cloudflare D1 要在部署新版后端前执行一次 `backend/worker/seed/003_admin_ownership.sql`；新建数据库使用更新后的 `schema.sql`。不要对同一个旧库重复运行 `ALTER TABLE`。部署未获本次授权。
- **旧数据关联**：旧筛查/案例的 `user_id` 为空，需凭可信账号映射人工回填；不能凭姓名匹配。回填前个人端看不到这些旧记录，案例详情也不会自动聚合它们。
- **Worker 打包**：`backend/worker/pyproject.toml` 仍引用原开发机的绝对 wheel 路径；团队部署流程应先改成可移植构建，再打包当前后端。此项尚未在 Worker 环境验证。
- **安全与专业审查**：公开演示站显示默认管理员凭据，真实敏感数据上线前必须移除并更换凭据。四种量表的分级沿用原前端规则，尚需专业人员审核；系统结果不能充当临床诊断。
- **其余范围**：多模态证据、相似案例、报告并未接入案例详情；R2 上传仍取决于现有部署配置。数据库时间字段有本地时间/UTC 混用历史，显示时区尚需统一。

## 6. 建议学习顺序

1. 从 `frontend/src/admin/pages/AdminAlerts.tsx` 的保存按钮追到 `frontend/src/services/adminApi.ts`，看前端如何发请求。
2. 在 `backend/app/handlers/__init__.py` 找对应路由，再读 `backend/app/handlers/admin.py` 看输入、SQL 和返回结构。
3. 读 `backend/app/db/database.py`，理解本地 SQLite 与 Worker D1 的两套执行路径。
4. 改动前先跑 `backend/scripts/test_admin_workflow.py`，每次只改一个业务链路，再用浏览器核对加载、成功、失败和返回状态。
