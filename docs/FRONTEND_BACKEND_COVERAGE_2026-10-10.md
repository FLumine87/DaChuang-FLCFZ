# 前后端功能与接口覆盖核查

核查日期：2026-10-10（Asia/Shanghai）

## 结论与版本

当前 TailAdmin Free 版已经覆盖管理员和个人用户的主要模块入口，但尚未覆盖后端全部业务操作，也尚未完成全部真实接口联调。

- 仓库：https://github.com/FLumine87/DaChuang-FLCFZ
- 本地 HEAD、origin/main 及只读远程查询得到的 main 均为 `3167a5bf0e4633e4a12ff2a05da081a287a63b01`。
- 核查对象：上述提交中的后端，与当前本地尚未提交的 TailAdmin 前端改动。
- 以 `backend/app/handlers/__init__.py` 的实际 ROUTES 为准。README/API 文档仍有旧框架描述，当前后端入口是标准库 HTTP 服务与 Worker dispatch，并非 README 所写的 FastAPI 实现。
- 后端登记 **57 条 /api 路由**，包含一条管理员测试路由，不包含根路径与健康检查。
- 前端有 **19 条对应的真实请求封装**，方法和路径均能在后端找到；其中 **18 条由页面直接或经会话模块调用**，`getAdminCollectionData` 只有封装、尚无页面调用。
- 另外 **38 条路由没有前端专用请求封装**。统一 HTTP 客户端已有 get/post/put/del，不代表每项业务的参数、响应类型和页面操作已经接好。
- 上述数字是路由使用数量，不是功能完成百分比。个人端和管理端的聚合接口已经覆盖部分通用读接口的功能，无须为每条后端 API 新建页面。

## 业务模块覆盖

| 模块 | 当前前端 | 接口现状与缺口 |
|---|---|---|
| 登录、注册、退出 | 有双角色入口与会话处理 | 三条请求路径对应；真实 JWT 的 counselor 角色处理还需统一 |
| 管理员数据概览 | 有指标、趋势、分布和预警列表 | 聚合查询已调用；四项顶部指标、目标完成率与变化幅度仍为常量，未使用已有 `/api/dashboard/stats` |
| 个人首页、我的档案 | 有汇总、记录与时间线展示 | 有真实请求；连续打卡为前端常量，情绪/睡眠趋势与行动计划部分为后端示例；个人接口未按当前用户隔离数据 |
| 个人心理筛查 | 有四种本地量表、作答、计分和提交 | 已调用个人提交接口；逐题答案未上传；提交未衔接后端自动预警流程；问卷模板仍来自前端常量 |
| 管理员筛查管理 | 有列表、浏览器内筛选与基本详情 | 只接聚合列表；未接通用筛查新增、修改、删除、完成及量表读取/新增 |
| 预警管理 | 管理员可读列表和详情；个人可筛选 | 未封装规则配置与预警更新/关闭；个人“标记为跟踪中/已缓解”没有 onClick |
| 案例管理 | 管理员列表卡片与搜索；个人汇总档案 | 未接案例详情、增改删、标签读取/创建、案例时间线读取/新增 |
| 文本采集 | 有输入与成功提示 | 提交仅改变组件状态，不发网络请求；后端也没有独立的日记采集写入路由 |
| 语音、图像采集 | 有本地录制/选择/预览及 upload 调用 | 后端上传固定返回 503；前端 FormData 被全局 JSON 头转成 JSON；失败后仍显示提交成功 |
| 管理员采集审阅 | 有三类数据及筛选、详情面板 | 页面直接导入 adminMockData；虽然预留 getAdminCollectionData，但没有使用；对应后端接口固定返回三个空数组 |
| 个人跨模态检索与报告 | 文本/图像/语音查询、模态过滤、结果媒体与报告展示 | 个人搜索与按需媒体接口已有调用；媒体是否可用还依赖后端语料；按筛查记录分析与报告接口未接 |
| 管理员检索 | 文本查询与返回报告展示 | 后端也支持图像/语音，前端 adminSearch 只提交 query，没有媒体查询入口及完整索引信息展示 |
| 知识图谱、预警研判 | 有概览、数字 ID 输入、证据和建议展示结构 | 两条查询/研判接口已接；Mock 模式明确拒绝调用；确认/修改/拒绝只改本地 state，后端没有任务处置保存接口 |

## 已定位的问题与证据

### 1. 文件上传链路目前无法真实使用

- `backend/app/handlers/upload.py:17`：POST /api/upload 固定抛出 503，multipart 解析和存储尚未启用。
- `frontend/src/services/http.ts:39`：axios 实例全局固定 `Content-Type: application/json`。
- `frontend/src/services/mockApi.ts:325`：上传传入 FormData，但未清除继承的 JSON 头。
- 使用项目已安装 axios 的自定义 adapter 复现：请求体变成字符串 `{"file":{}}`，不是 FormData。此验证没有发出网络请求。
- `frontend/src/pages/DataCollection.tsx:249`、`:352`：逐文件捕获异常后，仍无条件 `setSubmitted(true)`，会误报“哈希编码完成”。

需要同时补后端上传实现、前端 multipart 请求处理与真实成功/失败反馈。采集保存和检索页的 base64 媒体查询是两条不同链路，上传不可用不代表个人检索页的所有媒体查询都不可用。

### 2. 筛查到预警的业务闭环未连通

- `frontend/src/components/QuestionnaireForm.tsx:53`：提交回调只传 score/maxScore/level，没有传逐题 answers。
- `frontend/src/pages/Screening.tsx:44`：只提交量表标识、总分、满分和等级；失败仅输出 console，随后仍退出作答并刷新。
- `backend/app/handlers/personal.py:57`：个人提交调用 create_screening，未调用会计算规则并创建预警的 complete_screening。
- `backend/app/services/screening_service.py:141`：complete_screening 才调用 `_create_alert_if_needed`。
- 临时库复现：提交 GAD-7、18 分、level=red，返回成功并生成筛查记录，但 alerts 数量仍为 0。
- 未知量表返回 HTTP 200/code=0、data.status=error；前端未检查这个业务状态，不能依赖 HTTP 成功判断提交成功。

需要统一后端计分/规则执行入口，明确 answers 的序列化契约，保存完整答卷并在前端等待可靠结果。

### 3. 个人数据尚未按账号隔离

- `backend/app/handlers/personal.py:48`、`:82`、`:158`、`:163`：筛查、首页、预警和档案查询没有当前登录用户条件。
- 当前 screenings 表也没有直接的答卷所有者 user_id 字段；个人提交没有建立和 ctx.user 的归属关系。
- 临时库复现：普通用户获取个人筛查列表时，能读取另一条无归属关联的合成示例记录。

这会影响“我的筛查/我的档案”的业务正确性。正式联调应先明确个人记录的所有者字段与权限过滤，不能仅靠前端隐藏数据。

### 4. 部分后端已登记的 CRUD 路由仍会返回 500

在临时 SQLite 库、合成账号与有效本地 JWT 下，经实际 dispatch 复现：

| 请求 | 结果 | 原因位置 |
|---|---|---|
| GET /api/alerts | 500，coroutine 不可下标访问 | `backend/app/services/alert_service.py:89`，await 与下标操作顺序错误 |
| GET /api/cases | 同上 | `backend/app/services/case_service.py:38` |
| POST /api/alerts | 500，SQLite 不支持 coroutine 参数 | `backend/app/services/alert_service.py:125`，generate_alert_id 未 await |
| POST /api/cases | 同上 | `backend/app/services/case_service.py:83`，generate_case_id 未 await |

此外预警更新/关闭中存在未 await 的 get_alert_by_id 调用（alert_service.py:140、:156、:160、:168），需一并复核。本轮未将这些未执行的分支标记为已完成运行验证。

这些是通用业务接口问题，当前管理端的聚合列表接口使用不同查询，不能据此推断当前管理列表也一定返回 500。

### 5. 部分操作只有界面，没有业务调用

- `frontend/src/pages/Alerts.tsx:164`、`:169`：两个状态按钮没有 onClick；没有请求，也不会更新本地状态。
- `frontend/src/admin/pages/AdminAlerts.tsx`：只有列表选中和详情，没有分配、跟进或关闭操作。
- `frontend/src/admin/pages/AdminCases.tsx`：卡片没有详情入口或编辑动作。
- `frontend/src/admin/pages/AdminAgentWorkbench.tsx:101`：确认/修改/拒绝只写 taskStates；修改说明从 prompt 读出后没有保存；刷新会丢失。后端目前只提供研判读取，没有处置任务写入 API。
- `frontend/src/pages/ScreeningDetail.tsx` 未被路由或其他组件引用；其中“导出/生成报告”按钮也没有处理函数，不能因为文件存在就认定功能已覆盖。

### 6. 切换 VITE_USE_MOCK=false 不会让所有页面变成真实数据

- `frontend/src/admin/pages/AdminDataCollection.tsx:6`：数据直接来自本地 adminMockData，未读取服务层。
- `frontend/src/services/mockApi.ts:384`：getAdminCollectionData 只有定义，没有调用者。
- `backend/app/handlers/admin.py:208`：相应接口也仅返回三个空数组。
- `frontend/src/pages/DataCollection.tsx:382`：开放式文本提交没有服务调用。
- `frontend/src/admin/pages/AdminDashboard.tsx:79`：1,247/156/9/87% 和增幅等为常量。
- `frontend/src/pages/Dashboard.tsx:116`：连续打卡 12 天为常量；个人趋势和行动计划还包含后端生成的示例值。

后续需对真实、Mock、未启用状态使用明确标识，并逐项替换数据来源。统计“人数/次数”“本月/全部时间”的口径也须统一。

### 7. 参数、角色与错误跳转还未完全对齐

- 聚合列表向前端返回 `SCR-...` 等展示编号，而研判 API 与通用 CRUD 需要数据库数字 id；当前列表没有同时提供 dbId，也没有选中记录后直接研判的连贯入口。
- `frontend/src/services/mockApi.ts:148` 将登录响应的 counselor 转为 user，但 session.ts 仍从未修改的 JWT 读取 counselor；App.tsx 的 RequireRole 只接受 admin/user，咨询师账号会发生角色不一致。此项是静态代码结论，本轮未用远程咨询师账号登录。
- `frontend/src/services/http.ts:95`：401 跳转写死为 `/auth`，而项目使用 HashRouter、线上有仓库子路径，应按应用 base 跳转到 `/#/auth`，否则 GitHub Pages 上可能 404。
- `.github/workflows/deploy-frontend.yml` 固定 VITE_USE_MOCK=false；演示账号不是后端账号，不能把本地 Mock 登录验证当作线上真实认证验证。

## 已具备的接口基础

- 统一 axios 客户端、Bearer token 注入、统一响应解包和错误处理。
- VITE_API_BASE_URL、VITE_DEV_PROXY_TARGET 与 VITE_USE_MOCK 配置。
- 登录/注册/退出，以及主要聚合读取、个人筛查提交、检索、媒体读取、上传、图谱概览和研判的请求函数。
- 上述 19 条封装的方法与路由能够对应后端声明；仍需逐项验证字段、枚举、业务错误、权限和数据持久化。

## 建议补齐顺序

1. **先恢复真实链路的正确反馈**：401 跳转、上传编码与错误处理、后端现有 CRUD 异步错误、个人记录归属、筛查生成预警。
2. **补核心管理操作**：预警跟进/关闭、案例详情/编辑/时间线、筛查任务与量表读取/新增；保留现有 TailAdmin 组件与风格。
3. **补数据契约**：数字内部 id + 展示编号、前后端状态枚举、答卷答案格式、分页响应与统计口径。
4. **替换硬编码和断开的数据源**：管理员采集页、首页统计、文本日记提交；后端尚无实现的能力明确标为未启用或提供专门的演示路径。
5. **补研判处置保存协议**：与后端约定任务确认/修改/拒绝的接口、操作记录和再次查询；前端页面无法单方面完成持久化。
6. **按业务路径验收**：真实账号登录 → 筛查提交 → 生成预警 → 跟进/关闭 → 案例时间线；另外验证文本/语音/图像检索、上传成功与失败、刷新后的数据一致性。

## 验证范围

本轮完成源码逐项核对、TypeScript AST 请求/调用清单、Python AST 路由清单、axios 无网络序列化验证，以及临时 SQLite 数据库下的部分真实 handler/dispatch 验证。

临时验证使用合成数据和本地签名 JWT；数据库位于系统临时目录，结束后删除；为避免写入检索库，筛查增量索引入口在探针进程中被替换为空操作。没有修改项目业务代码或现有业务数据库，没有调用远程 Worker、D1/R2、外部大模型或真实语音/图像数据。因此不能将本报告理解为生产环境端到端通过。

## 全量路由清单

“已调用”表示存在实际源码调用路径，不表示已通过真实运行验收；“未封装”可能是聚合读取已替代，也可能是确实缺失，需结合上面的业务矩阵判断。


### auth

| 方法 | 后端路径 | 前端请求函数 | 使用状态 |
|---|---|---|---|
| POST | `/api/auth/login` | `apiLogin` | 已调用 |
| POST | `/api/auth/register` | `apiRegister` | 已调用 |
| POST | `/api/auth/logout` | `apiLogout` | 已调用 |

### personal

| 方法 | 后端路径 | 前端请求函数 | 使用状态 |
|---|---|---|---|
| GET | `/api/personal/screenings` | `getScreeningRecords` | 已调用 |
| POST | `/api/personal/screenings` | `submitScreening` | 已调用 |
| GET | `/api/personal/dashboard` | `getDashboardData` | 已调用 |
| GET | `/api/personal/warnings` | `getWarnings` | 已调用 |
| GET | `/api/personal/profile` | `getCases` | 已调用 |
| POST | `/api/personal/search` | `search` | 已调用 |

### admin

| 方法 | 后端路径 | 前端请求函数 | 使用状态 |
|---|---|---|---|
| GET | `/api/admin/test` | — | 开发测试接口，无需业务页面 |
| GET | `/api/admin/dashboard` | `getAdminDashboardData` | 已调用 |
| GET | `/api/admin/screenings` | `getAdminScreeningRecords` | 已调用 |
| GET | `/api/admin/alerts` | `getAdminAlerts` | 已调用 |
| GET | `/api/admin/cases` | `getAdminCases` | 已调用 |
| POST | `/api/admin/search` | `adminSearch` | 已调用 |
| GET | `/api/admin/data-collection` | `getAdminCollectionData` | 只有封装，页面未调用 |

### screening

| 方法 | 后端路径 | 前端请求函数 | 使用状态 |
|---|---|---|---|
| GET | `/api/screening/questionnaires` | — | 未封装 |
| POST | `/api/screening/questionnaires` | — | 未封装 |
| GET | `/api/screening` | — | 未封装 |
| POST | `/api/screening` | — | 未封装 |
| GET | `/api/screening/{screening_id}` | — | 未封装 |
| PUT | `/api/screening/{screening_id}` | — | 未封装 |
| DELETE | `/api/screening/{screening_id}` | — | 未封装 |
| POST | `/api/screening/{screening_id}/complete` | — | 未封装 |

### alerts

| 方法 | 后端路径 | 前端请求函数 | 使用状态 |
|---|---|---|---|
| GET | `/api/alerts/rules` | — | 未封装 |
| POST | `/api/alerts/rules` | — | 未封装 |
| PUT | `/api/alerts/rules/{rule_id}` | — | 未封装 |
| DELETE | `/api/alerts/rules/{rule_id}` | — | 未封装 |
| GET | `/api/alerts/stats` | — | 未封装 |
| GET | `/api/alerts` | — | 未封装 |
| POST | `/api/alerts` | — | 未封装 |
| GET | `/api/alerts/{alert_id}` | — | 未封装 |
| PUT | `/api/alerts/{alert_id}` | — | 未封装 |
| POST | `/api/alerts/{alert_id}/resolve` | — | 未封装 |

### cases

| 方法 | 后端路径 | 前端请求函数 | 使用状态 |
|---|---|---|---|
| GET | `/api/cases/tags` | — | 未封装 |
| POST | `/api/cases/tags` | — | 未封装 |
| GET | `/api/cases` | — | 未封装 |
| POST | `/api/cases` | — | 未封装 |
| GET | `/api/cases/{case_id}` | — | 未封装 |
| PUT | `/api/cases/{case_id}` | — | 未封装 |
| DELETE | `/api/cases/{case_id}` | — | 未封装 |
| GET | `/api/cases/{case_id}/timeline` | — | 未封装 |
| POST | `/api/cases/{case_id}/timeline` | — | 未封装 |

### retrieval

| 方法 | 后端路径 | 前端请求函数 | 使用状态 |
|---|---|---|---|
| POST | `/api/retrieval/search` | — | 未封装 |
| GET | `/api/retrieval/index-stats` | — | 未封装 |
| GET | `/api/retrieval/media/{unit_id}` | `fetchRetrievalMedia` | 已调用 |
| POST | `/api/retrieval/analyze` | — | 未封装 |
| GET | `/api/retrieval/report/{screening_id}` | — | 未封装 |

### knowledge-graph

| 方法 | 后端路径 | 前端请求函数 | 使用状态 |
|---|---|---|---|
| GET | `/api/knowledge-graph/overview` | `getGraphOverview` | 已调用 |
| GET | `/api/knowledge-graph/screenings/{screening_id}/evidence` | — | 未封装 |

### agents

| 方法 | 后端路径 | 前端请求函数 | 使用状态 |
|---|---|---|---|
| POST | `/api/agents/warning-assessment` | `assessWarning` | 已调用 |

### upload

| 方法 | 后端路径 | 前端请求函数 | 使用状态 |
|---|---|---|---|
| POST | `/api/upload` | `uploadFile` | 已调用 |
| GET | `/api/upload/{file_id}` | — | 未封装 |
| DELETE | `/api/upload/{file_id}` | — | 未封装 |

### dashboard

| 方法 | 后端路径 | 前端请求函数 | 使用状态 |
|---|---|---|---|
| GET | `/api/dashboard/stats` | — | 未封装 |
| GET | `/api/dashboard/recent-alerts` | — | 未封装 |
| GET | `/api/dashboard/summary` | — | 未封装 |

## 已封装接口的调用来源

| 函数 | 来源文件 | 调用者 |
|---|---|---|
| `apiLogin` | `frontend/src/services/mockApi.ts:144` | `frontend/src/pages/AuthPage.tsx` |
| `apiRegister` | `frontend/src/services/mockApi.ts:169` | `frontend/src/pages/AuthPage.tsx` |
| `apiLogout` | `frontend/src/services/mockApi.ts:179` | `frontend/src/auth/session.ts` |
| `getScreeningRecords` | `frontend/src/services/mockApi.ts:192` | `frontend/src/pages/Screening.tsx` |
| `submitScreening` | `frontend/src/services/mockApi.ts:216` | `frontend/src/pages/Screening.tsx` |
| `getDashboardData` | `frontend/src/services/mockApi.ts:233` | `frontend/src/pages/Dashboard.tsx` |
| `getWarnings` | `frontend/src/services/mockApi.ts:241` | `frontend/src/pages/Alerts.tsx` |
| `getCases` | `frontend/src/services/mockApi.ts:249` | `frontend/src/pages/Cases.tsx` |
| `search` | `frontend/src/services/mockApi.ts:280` | `frontend/src/pages/Retrieval.tsx` |
| `fetchRetrievalMedia` | `frontend/src/services/mockApi.ts:307` | `frontend/src/pages/Retrieval.tsx` |
| `uploadFile` | `frontend/src/services/mockApi.ts:325` | `frontend/src/pages/DataCollection.tsx` |
| `getAdminDashboardData` | `frontend/src/services/mockApi.ts:346` | `frontend/src/admin/pages/AdminDashboard.tsx` |
| `getAdminScreeningRecords` | `frontend/src/services/mockApi.ts:354` | `frontend/src/admin/pages/AdminScreening.tsx` |
| `getAdminAlerts` | `frontend/src/services/mockApi.ts:362` | `frontend/src/admin/pages/AdminAlerts.tsx` |
| `getAdminCases` | `frontend/src/services/mockApi.ts:370` | `frontend/src/admin/pages/AdminCases.tsx` |
| `adminSearch` | `frontend/src/services/mockApi.ts:378` | `frontend/src/admin/pages/AdminRetrieval.tsx` |
| `getAdminCollectionData` | `frontend/src/services/mockApi.ts:393` | 无 |
| `getGraphOverview` | `frontend/src/services/agentApi.ts:97` | `frontend/src/admin/pages/AdminAgentWorkbench.tsx` |
| `assessWarning` | `frontend/src/services/agentApi.ts:106` | `frontend/src/admin/pages/AdminAgentWorkbench.tsx` |
