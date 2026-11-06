# 管理端业务联动与登录修复

本轮在 main ec75988 上建立独立分支 codex/admin-workflow-20261106。与上一轮 PR #3 的四项建议分开交付，保留原 Agent 的研判、任务审批及版本冲突控制。未部署、未操作线上账号库。

## 完成的功能

1. 登录提示：生产构建显示并填入线上已验证的公开演示账号 admin / admin123；本地开发与演示模式默认 adminer / admin。可通过 VITE_ADMIN_DEMO_USERNAME 和 VITE_ADMIN_DEMO_PASSWORD 配置公开演示账号，不能放真实员工密码。只更改提示和填入值，不重置密码，不尝试替用户登录其他账号。线上账号库以后变更时，应同步配置。
2. 今日工作：首页读取真实业务空间的待分配预警、待审核草案、今天到期及逾期任务，按北京时间的日期统计。点击任务可进入对应案例，进入随访处置时直接选择 live 空间和任务页。已完成/拒绝任务不计入待办，demo 任务不混入，预警计数不受列表每页 50 条的截断影响。
3. 统一案例资料：普通案例页与 Agent 使用明确的案例关联；只有账号唯一对应一个案例时，才兼容按 user_id 读取历史记录。包含独立多模态采集产生的预警和材料，不按姓名合并。新筛查同步写入 case_id，历史含多案例歧义时不自动猜测。案例筛查次数和最近时间改读实际记录，避免旧缓存数量与详情不一致。
4. 资料变化提示：个案研判保存材料版本的哈希快照；新增、修改、移除筛查或采集后，案例页与 Agent 页提示需重新复核。旧报告保留，新研判另存一份；缺少快照的历史报告显示“无法确认”，不会当成最新。该提示只反映资料变化，不自动更改心理风险等级或发送消息。
5. 案例详情加入采集、随访任务、任务操作时间线，以及前往 Agent 的入口；选中案例后加宽详情区域。个人端新增材料经真实接口落库后，可在管理端直接看到并触发资料更新提示。
6. 联调修复演示检索引擎缺少 media_path 参数的问题。模拟结果仅显示“未评估”，不根据演示命中生成真实业务预警；真实引擎的既有流程保持。

## 文件与协作边界

- backend/app/services/case_context.py：归属、关联材料及研判快照的公共读取规则。
- backend/app/handlers/admin.py：统一案例详情、真实记录计数、今日工作接口 GET /api/admin/work-queue。
- backend/app/services/case_service.py：新筛查关联案例，歧义时不自动归属。
- backend/app/services/agent_workspace.py、agent_individual.py：接入相同关联规则和材料覆盖，保存/比较快照；任务状态机和人工审批逻辑沿用。
- frontend/src/admin/components/TodayWork.tsx：首页待办和筛选。
- frontend/src/admin/pages/AdminCases.tsx、AgentWorkspaceV2.tsx：资料与任务联动、更新提示、URL 直达及刷新保留选择。
- frontend/src/auth/demoCredentials.ts、pages/LoginPage.tsx、.env.production、.env.example：登录提示与部署配置一致。
- backend/app/engines/hashing/mock_engine.py、handlers/personal.py：模拟引擎兼容与模拟数据边界修复。

与 Agent 负责人的接口约定：live subject 使用 case:内部主键；案例外部跳转仍可传公开编号 CASE-xxx。个案报告新增 evidence_snapshot，详情新增 assessmentState。新模型引擎接入时应保留版本提示、记录来源、任务去重和人工审批。

## 验证与本地复现

- backend：python -m unittest discover -s tests -v，17 项测试通过，包含 7 项新增归属、快照、待办和模拟分析测试。
- backend：python scripts/test_admin_workflow.py，既有 7 项回归通过。
- frontend：npm run build 和修改文件的 ESLint 检查通过；既有大包体积提示仍存在。
- frontend：npx playwright test e2e/admin-workflow.spec.ts --reporter=line，两项真实后端浏览器流程通过。使用临时 SQLite、实际 JWT 和实际 HTTP 接口，不拦截模拟业务响应。

本地验收：先在 backend 执行 python scripts/run_admin_acceptance.py，服务只监听 127.0.0.1:8016，生成临时账号 admin/admin123 和 flow-user/test123。退出关闭数据库，临时库可清理，不改团队演示库。

另一个终端在 frontend 设置 VITE_USE_MOCK=false，VITE_API_BASE_URL 为空，VITE_DEV_PROXY_TARGET=http://127.0.0.1:8016，VITE_ADMIN_DEMO_USERNAME=admin，VITE_ADMIN_DEMO_PASSWORD=admin123，然后执行 npm run dev -- --host 127.0.0.1 --port 5178 --strictPort。再运行上述浏览器测试。重跑完整验收前重启临时后端，恢复测试初始数据。

演示顺序：首页逾期待办 → 案例 → 个人端提交材料 → 刷新案例看到资料变化 → 前往 Agent 重新研判 → 返回案例提示已更新。测试同时覆盖取消未保存修改、刷新保留案例和返回列表。

## 范围与后续

本轮没有新增个人端复查任务收件箱、自动通知或新模型推断；待办复用已有 Agent 任务。原始语音和图片不通过新接口开放 URL，当前展示登记说明/文件名；媒体播放仍需另外完成文件鉴权。未进行线上 Worker/D1 验收；上线前需先核对已有案例字段及之前的数据库迁移。变更报告含资料版本，不等同于经过专业人员确认的结论。
