# Agent 工作台 V2：使用与交付说明

## 当前实现

这是**真实后端驱动、可持久化的规则工作流版本**，不是静态效果图，也不是已经接入大模型的自主 Agent。先不连接 DeepSeek，所有新接口都不调用外部模型；未使用或传输 API 密钥。

保留管理端原导航，工作台内区分为：

- 群体研判：选择数据空间、观察窗口、院系；统计对象与已有预警等级，输出重点复核名单。
- 个案研判：从名单或案例管理打开个人档案，一键读取历史、比较同量表、检查材料覆盖、生成处置草案并保存个案报告。
- 协作记录：展示后端实际执行的四步工具处理记录。不是模拟实时“思考过程”。
- 随访处置：确认分配、修改分配、拒绝草案、记录随访与下一次计划日期、完成任务；每次处理保留操作历史。

## 本地使用

前端地址：`http://127.0.0.1:5173/admin/agent-workbench`

后端健康检查：`http://127.0.0.1:8000/health`

用原管理账号登录。首次体验建议：

1. 保持“合成演示数据”，点击“启动群体研判”。
2. 在重点复核名单打开“演示案例 001”。
3. 点击“运行个案研判”，查看筛查时间线、工具记录、文本、可播放语音及图片。
4. 进入“随访处置”，确认一条草案，填写负责人。
5. 记录随访并调整下一次日期，刷新页面检查保存结果。
6. 切换“本地业务数据”查看自己的已完成筛查。两个空间的任务互不混用。

演示测试会留下少量“演示负责人”和“浏览器验收”记录，仅存在 demo 空间。

若服务已停止，在两个终端分别运行：

```powershell
cd D:\Dc-projct\DaChuang-FLCFZ\backend
python -c "from app.server import run_server; run_server(host='127.0.0.1',port=8000)"
```

```powershell
cd D:\Dc-projct\DaChuang-FLCFZ\frontend
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

仅面向本地开发，部署到公网前必须替换默认账号/密钥、复核权限与数据保护策略。

## 前后端实现位置

| 部分 | 文件 |
| --- | --- |
| 工作台与弹层 | `frontend/src/admin/pages/AgentWorkspaceV2.tsx` |
| 页面样式 | `frontend/src/admin/pages/agent-workspace.css` |
| 类型化接口 | `frontend/src/services/workspaceApi.ts` |
| 群体工作流与任务状态机 | `backend/app/services/agent_workspace.py` |
| 独立个案研判 | `backend/app/services/agent_individual.py` |
| 接口与管理权限注册 | `backend/app/handlers/agent_workspace.py`、`backend/app/handlers/__init__.py` |
| 原子更新并提交 | `backend/app/db/database.py` 中 `mutate_returning_a` |

新增的数据库表按需创建，不删除原业务表：

- `agent_workspace_runs`：群体报告及执行记录。
- `agent_workspace_case_runs`：独立个案报告，重跑个案不覆盖群体报告。
- `agent_workspace_tasks`：任务、版本号、负责人、日期及事件历史。

所有新增路由均要求管理员权限：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/agent-workspace?scope=demo或live` | 读取工作台 |
| POST | `/api/agent-workspace/runs` | 群体研判 |
| GET | `/api/agent-workspace/cases/{case_id}?scope=...` | 个人档案 |
| POST | `/api/agent-workspace/cases/{case_id}/runs` | 个案研判 |
| PUT | `/api/agent-workspace/tasks/{task_id}` | 处理任务 |

任务更新使用版本号检查和原子写入，阻止两位管理员静默覆盖同一版本。重复研判不会覆盖已审核、拒绝或完成的任务。

## 数据与结果边界

- 演示空间：24 个虚构案例、72 条合成筛查；固定观察基准日为 2026-10-13。
- 只有演示案例 001 配有三类原创材料。文本为虚构日记；语音为 Windows TTS；图片为原创日程 SVG，不是真人照片。
- 这些素材仅用于演示流程，不能用来证明模型准确率，也不是公开数据集中真实配对的受试者证据。
- 业务空间只读取已完成筛查，使用稳定 `case_id` 关联历史；缺少关联的记录单独计数，不按姓名猜测关联。
- 不同量表不直接计算分数差；群体样本变化不自动解释为改善或恶化。
- 预警等级沿用既有筛查记录。新工作流没有建立经过验证的心理诊断模型，也不从表情、声音、检索相似度或总分推断具体症状与环境成因。
- 业务资料目前只统计登记覆盖情况；未经安全鉴权与归属核查的文件不直接展示。
- 随访目前是管理端审核、计划调整和记录闭环；没有自动向个人发送短信、电话或消息。
- 完成/拒绝为当前任务的终态，重跑研判不会自动开启新一轮任务周期。
- Worker/D1 使用同一异步数据访问接口，但本次只完成本地 SQLite 联调，未进行线上部署验收。

后续真实数据可继续研究项目已有的 EATD / CSEMOTIONS 导入路径。下载前逐项核对授权、隐私限制、可用模态及配对关系；不能把不同人的文本、照片、声音拼成一个真实案例。

## 测试方式

后端隔离测试使用临时数据库，不改业务数据：

```powershell
cd D:\Dc-projct\DaChuang-FLCFZ\backend
python -m unittest discover -s tests -v
```

服务启动后的接口验收（仅写 demo 任务）：

```powershell
python scripts/smoke_agent_workspace.py
```

浏览器验收（服务需已启动）：

```powershell
cd D:\Dc-projct\DaChuang-FLCFZ\frontend
npx playwright test
```

测试默认使用本机 Edge；可用 `AGENT_TEST_CHROME` 指定浏览器。如果无 Edge 且未指定路径，先安装 Playwright Chromium。测试账户可用 `AGENT_TEST_USERNAME` 和 `AGENT_TEST_PASSWORD` 环境变量指定，不把密钥写入代码。

## 本次更新、备份与中断处理

- 源码基线：GitHub main 提交 `3167a5bf0e4633e4a12ff2a05da081a287a63b01`。
- `git clone` 网络连接失败，改为下载该提交的 GitHub 官方 ZIP，解压后替换源码目录。
- 原目录完整保留在 `D:\Dc-projct\DaChuang-FLCFZ-backup-20261013`。
- 原 `.env`、前端本地配置和本地业务数据库已复用；没有把演示材料冒充业务数据。
- ZIP 不带 Git 历史；原 `.git` 仍在备份目录中。当前源码不是新的 Git clone，没有推送或修改远程仓库。
- 按用户最新要求取消等待 Figma；交付代码和真实页面，不声称创建了 Figma 设计文件。
- 中途命令受沙箱启动异常及执行额度中断影响，恢复后逐项核对了文件落盘情况。
- 首个浏览器工具与打包 Chromium 创建页面超时；改用本机 Edge 后能够实际访问页面，并发现、修复了个案抽屉 Esc 关闭问题。
- 定向修复 `source-map-js` 开发依赖漏洞，没有使用强制大版本升级。

## 之后接入 DeepSeek

需要用户先确认页面及数据授权，再实施模型连接：

1. 模型只接收经筛选、去标识化且有授权的事实，不直接上传所有原始心理数据。
2. 返回结构化计划，工具只能从允许列表选择；计划与证据引用必须经过服务端验证。
3. 保留同量表比较、权限、任务去重和人工审批这些硬约束。
4. 配置超时、失败回退、调用审计和费用上限。
5. 单独确定语音转写与图片处理方案，不能默认文本 API 就能理解三类原始材料。
6. 外部发送、升级处置、通知个人等动作仍需明确授权，不由模型直接决定执行。
