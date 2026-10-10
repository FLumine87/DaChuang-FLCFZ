# React 界面案例与迁移调研

调研日期：2026-10-09。对象：DaChuang-FLCFZ 心理筛查预警系统。

## 结论

优先选择 **Shadcn Admin 的页面组织 + 官方 shadcn/ui 的组件与图表**。这条路线与项目已有 React、Tailwind、Lucide、Recharts 接近，适合逐页迁移。若偏好更丰富、圆润的卡片式界面，第二选择是 **TailAdmin Free**。

Tremor 适合作为数据可视化参考；Mantine UI 适合作为个人端卡片、表单与上传交互参考。Ant Design Pro、Mantis 是成熟的另一套设计体系，适合在明确选择其风格后采用，接入成本高于前两项。

这里的迁移成本是结合源码依赖作出的工程判断，尚未在本项目安装和构建验证。视觉评价属于设计判断；组件成熟度与业务系统完整度分别评估。

## 1. 本项目实际情况

依据 [package.json](../frontend/package.json)、[App.tsx](../frontend/src/App.tsx)、[index.css](../frontend/src/index.css) 与页面源码：

| 项目项 | 当前情况 | 对选型的影响 |
| --- | --- | --- |
| 应用 | React 19.2 + TypeScript 5.9 + Vite 7.3 | 优先 React/Vite 组件与案例 |
| 样式 | Tailwind CSS 4.2，已有 primary/success/warning/danger 色板 | Tailwind 4 案例容易局部迁入 |
| 路由 | React Router DOM 7.13，个人端与管理端分开 | 抽取模板 UI 时要保留并适配现有导航 |
| 图表 | Recharts 3.8 | 官方 shadcn Chart 当前采用 Recharts 3，适配较少 |
| 图标 | Lucide React | shadcn 系案例接近；新图标需核对当前版本导出 |
| 组件 | 手写 Tailwind JSX，尚未接入完整 UI 库 | 可逐步抽出公共组件，不需要先迁移业务架构 |
| 主题 | 管理端深色导航与浅色内容；个人端另有布局 | 需要统一间距、排版、边框、阴影和状态语义 |
| 路径别名 | Vite 与 tsconfig.app.json 尚未配置 @/* | 复制使用 @/ 导入的案例前需补齐配置 |

核心页面是统计仪表盘、筛查记录、问卷、多模态上传、相似案例检索、预警处置、案例详情和 Agent 工作台。因此调研重点是应用界面、数据表格与表单，而非营销首页。

## 2. 推荐案例一览

“低”表示可以沿用现有技术栈抽取组件；“中”表示增加 UI 依赖或调整组件体系；“高”表示若整套采用，会涉及应用框架与布局体系迁移。

| 优先级 | 案例 | 类型与视觉风格 | 适合本项目 | 局部迁移成本 | 免费范围与许可 |
| --- | --- | --- | --- | --- | --- |
| 1 | Shadcn Admin | 完整后台 UI 案例；黑白灰、细边框、克制留白 | 管理端布局、筛查/案例列表、设置 | 低至中，需适配 TanStack Router | 开源，MIT |
| 2 | TailAdmin Free | 后台模板；蓝紫重点色、圆角卡片、丰富图表 | 仪表盘、采集表单、登录 | 低至中，需处理图表与路由版本差异 | 免费仓库 MIT；Pro 页面另计 |
| 3 | shadcn/ui 官方 Dashboard / Blocks / Charts | 官方页面与组件示例；统一、精简、可定制 | 公共组件底座、统计图、对话框、侧栏 | 低；需先配置组件基础设施 | MIT |
| 4 | Tremor Raw | 分析界面组件；数据优先、清晰层级、微型图表 | 趋势、风险分布、相似度、检索指标 | 外观参考低；复制图表源码为中 | Raw 开源 Apache-2.0；Premium Blocks 另计 |
| 5 | Mantine UI | 官方维护者与社区组件案例；柔和、轻盈、亲切 | 个人端、问卷、上传、进度反馈 | 中，需 Provider、CSS 与主题适配 | MIT，免费组件 |
| 6 | Ant Design Pro | 企业后台案例；中文管理场景、信息密度高 | 管理端复杂表格、筛选、分步表单 | 组件局部接入中；整套迁移高 | MIT |
| 7 | Mantis Free | MUI 后台模板；整洁、稳重、浅色蓝系 | 仪表盘、机构管理端视觉参考 | 中，需引入 MUI/Emotion 并统一样式 | 免费版 MIT；高级功能与 TS 版本见 Pro 范围 |

## 3. 逐项调研

### 3.1 Shadcn Admin：最适合作为管理端的主要参考

- [在线演示](https://shadcn-admin.netlify.app/)
- [源码、功能与许可](https://github.com/satnaing/shadcn-admin)
- [当前依赖](https://github.com/satnaing/shadcn-admin/blob/main/package.json)

视觉特点是白底、浅灰导航选中态、细边框、紧凑且有层次的排版。Dashboard、Tasks、Users 和设置页面提供了可对照的后台结构，适合把现有筛查和案例页面升级成统一的工作界面。

成熟度依据：仓库页面本次读取约 15.7k stars；包含 10+ 页面、响应式、明暗模式、侧栏与全局搜索。当前依赖包含 React 19、Tailwind 4、Recharts 3，与本项目接近。作者明确将其定位为后台 UI 集合，而非完整业务 starter。

迁入重点：侧栏、页头、筛选工具栏、数据表、行操作菜单、详情抽屉和状态徽章。保留项目 React Router、RequireRole 与服务接口；把模板里的 TanStack Link、导航及搜索参数处理改为现有路由方式。Clerk、Query、Zustand 等依赖按实际使用决定，不随模板整包搬入。

### 3.2 TailAdmin Free：适合增强仪表盘的展示效果

- [免费版演示](https://free-react-demo.tailadmin.com/)
- [Pro 演示](https://react-demo.tailadmin.com/)
- [免费版源码、版本记录与功能比较](https://github.com/TailAdmin/free-react-tailwind-admin-dashboard)
- [当前依赖](https://github.com/TailAdmin/free-react-tailwind-admin-dashboard/blob/main/package.json)

视觉特点是蓝紫重点色、宽松留白、较大的圆角和组合式统计卡片。首页的指标卡、趋势图、完成度图和记录表适合映射为筛查覆盖率、待处理预警、风险趋势和最新筛查记录。

成熟度依据：React + TypeScript + Vite + Tailwind；仓库有持续版本记录，列出 2026-09-13 的 2.4.0 更新。免费版包含一个 Dashboard 及基础组件。实际浏览确认免费版与 Pro 导航范围不同，高级 Data Tables 等在 Pro 演示标注为付费。

迁入重点：布局、统计卡、表单容器、上传区域和登录页。当前仓库使用 ApexCharts，建议在本项目用已有 Recharts 重做对应图形；当前依赖中的 React Router 为 8，与本项目 7 不同，抽取页面时适配现有导航接口即可，不因换外观升级整套依赖。注意只按免费仓库实际文件评估可复制范围。

### 3.3 shadcn/ui 官方示例：最适合作为落地组件底座

- [Dashboard 示例](https://ui.shadcn.com/examples/dashboard)
- [Blocks](https://ui.shadcn.com/blocks)
- [Charts](https://ui.shadcn.com/charts)
- [Vite 安装说明](https://ui.shadcn.com/docs/installation/vite)
- [React 19 / Tailwind 4 说明](https://ui.shadcn.com/docs/tailwind-v4)
- [Chart 与 Recharts 3 说明](https://ui.shadcn.com/docs/components/chart)
- [MIT 许可](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md)

这是一组官方页面、布局块与组件示例，并非包含后端的管理系统。它的价值是把按钮、输入框、卡片、弹层和图表统一起来，同时保留修改源码的自由。

官方明确支持 React 19 与 Tailwind 4；当前 Chart 文档明确采用 Recharts 3。对本项目而言，这是图表迁入成本较低的路线。优先使用 Card、Button、Badge、Input、Dialog、Sheet、Tabs、Sidebar 与 Chart；复杂数据表再按需接入 TanStack Table。

初次接入需要配置 @/*、components.json、cn() 工具函数，以及 background、foreground、border、muted、ring、chart 等语义变量。已有 primary-* 与四级风险色应保留并作语义映射。

### 3.4 Tremor Raw：优秀的数据分析视觉参考

- [交互示例与产品介绍](https://www.tremor.so/)
- [Raw 开源源码与 Apache-2.0 许可](https://github.com/tremorlabs/tremor)
- [安装要求](https://www.tremor.so/docs/getting-started/installation)
- [当前依赖](https://github.com/tremorlabs/tremor/blob/main/package.json)

特点是对数据大小、单位、比较关系和视觉层级的处理细致。Bar List、Category Bar、Spark Chart、Tracker 等形式适合表达相似案例得分、模态占比、风险变化和采集完成状态。

官方说明 Raw 需要 React 18.2+ 与 Tailwind 4+，采用可复制源码方式，包含 35+ 组件。但当前仓库开发依赖仍是 React 18、Recharts 2.15，不能据此认定所有图表可以直接迁入本项目的 Recharts 3。官网 Vite 指南也标注 Updating Soon。

建议主要借鉴排版和图表构图，以现有 Recharts 3 或官方 shadcn Chart 实现。若复制 Raw 源码，需要核对图表属性和 TypeScript 类型。Premium Blocks 与 Raw 免费组件不是同一授权范围。

### 3.5 Mantine UI：适合个人端与采集流程

- [官方组件案例库](https://ui.mantine.dev/)
- [统计卡片](https://ui.mantine.dev/category/stats/)
- [应用卡片](https://ui.mantine.dev/category/app-cards/)
- [上传组件](https://ui.mantine.dev/category/dropzones/)
- [登录案例](https://ui.mantine.dev/category/authentication/)
- [源码与许可](https://github.com/mantinedev/ui.mantine.dev)
- [Vite 接入](https://mantine.dev/guides/vite/)

视觉观感柔和、简洁，适合个人端情绪记录、睡眠概览、问卷进度和文件上传。案例库本次显示 123 个响应式组件，网站明确为 MIT；Mantine 本身还有完整组件文档与主题体系。

若直接复制案例，需要引入对应 Mantine 包、MantineProvider 与样式文件；一些案例还带 CSS Modules 和图标依赖。因此虽然支持 Vite，迁移成本仍高于当前 Tailwind 体系内的 shadcn 方案。

建议先参考卡片、进度反馈和表单节奏，再用统一组件底座实现。若选择直接采用 Mantine，应在个人端统一使用其主题，避免每页一套控件视觉。

### 3.6 Ant Design Pro：管理能力优先时的成熟选择

- [在线演示](https://preview.pro.ant.design/)
- [源码、功能与 MIT 许可](https://github.com/ant-design/ant-design-pro)
- [当前依赖](https://github.com/ant-design/ant-design-pro/blob/master/package.json)
- [ProTable 文档](https://procomponents.ant.design/components/table/)

适合需要大量筛选、排序、分页、批量操作和分步表单的中文管理界面。官方仓库本次显示约 38.8k stars，包含 Dashboard、表单、列表、详情、结果页、异常页和国际化等应用案例。

当前主线采用 React 19、Umi Max、Ant Design 与 ProComponents。若整套搬入，会涉及构建、路由、应用配置与主题体系变更。若只需要增强筛查/案例表格，可以评估独立接入 antd 与 ProComponents，转换现有数据、分页和筛选接口；UI 库本身并不要求将项目改为 Umi。

对本项目，选它应主要出于复杂管理交互的需求。若重点是尽快统一美观度，前面的 Tailwind 方案更直接。

### 3.7 Mantis Free：稳重的 MUI 风格备选

- [免费版演示](https://mantisdashboard.com/free/dashboard/default)
- [源码、免费/Pro 比较与 MIT 许可](https://github.com/codedthemes/mantis-free-react-admin-template)
- [Vite 版本依赖](https://github.com/codedthemes/mantis-free-react-admin-template/blob/master/vite/package.json)

视觉是浅色蓝系、紧凑的指标卡和稳重的管理后台排版。免费仪表盘可参考图表、表格和数据层级，适合偏机构管理的风格。

当前免费仓库有 Vite 目录，依赖 React 19 与 React Router 7，因此并非构建框架不兼容。主要迁移工作来自 MUI、Emotion、主题和现有 Tailwind 界面的统一。

官方免费/Pro 比较列出免费版约 7 个演示页，TypeScript 版本、深浅主题和更多高级功能列在 Pro。不能把 Pro 演示的全部能力计入免费源码可用范围。

## 4. 对 AI 工作台的补充参考

[assistant-ui 演示与示例](https://www.assistant-ui.com/)、[源码与 MIT 许可](https://github.com/assistant-ui/assistant-ui)适合后续增加对话入口时参考，包括消息流、引用和工具结果的组织。其托管服务是独立可选项。

本项目当前 `assessWarning` 是获取结构化研判结果的 POST 请求，工作台包含证据、规则、建议与人工确认。近期升级可直接使用统一的 Card、Accordion、Badge、Dialog 组织这些内容；如果以后接入聊天，再单独设计消息与后端接口适配。聊天组件不会自动理解现有研判响应。

## 5. 推荐落地方案

推荐视觉方向：**浅色内容区 + 低饱和蓝/青色重点色 + 清晰的数据层级**。管理端侧重紧凑、可扫描；个人端增加留白、较柔和的卡片与进度反馈。红、橙、黄、绿继续专用于风险语义，避免普通装饰与告警状态混淆。

| 现有页面或文件 | 优先参考 | 具体可迁入内容 |
| --- | --- | --- |
| frontend/src/admin/components/AdminLayout.tsx | Shadcn Admin / 官方 Sidebar | 导航分组、折叠态、页头、移动端抽屉 |
| frontend/src/components/Layout.tsx | 相同组件底座，较轻的主题 | 个人端导航与间距 |
| frontend/src/admin/pages/AdminDashboard.tsx | TailAdmin 构图 / 官方 Chart | 指标层级、趋势图、风险分布、最新预警 |
| frontend/src/admin/pages/AdminScreening.tsx | Shadcn Admin Tasks/Users | 筛选栏、排序分页、状态、行操作 |
| frontend/src/admin/pages/AdminCases.tsx | Shadcn Admin 列表 / Mantine 卡片 | 列表与卡片视图、详情入口、标签 |
| frontend/src/admin/pages/AdminAlerts.tsx | 列表 + Sheet/Dialog | 预警详情、处置步骤、确认反馈 |
| frontend/src/admin/pages/AdminAgentWorkbench.tsx | shadcn Card/Accordion/Dialog | 证据分组、规则引用、建议确认与编辑 |
| frontend/src/pages/Dashboard.tsx | Mantine Stats / Tremor 排版 | 情绪与睡眠趋势、行动计划、记录摘要 |
| frontend/src/components/QuestionnaireForm.tsx | 官方表单组件 / Mantine 输入案例 | 题目层级、选项卡、进度、提交状态 |
| frontend/src/pages/DataCollection.tsx | TailAdmin 表单 / Mantine Dropzone | 上传态、预览、错误、采集步骤 |
| frontend/src/pages/Retrieval.tsx | Tremor Bar List + 统一卡片 | 相似度、模态标签、案例摘要、报告层级 |
| frontend/src/pages/AuthPage.tsx | 官方登录 Blocks / TailAdmin | 双栏结构、输入控件、校验与加载状态 |

### 建议实施顺序

1. **统一基础**：补齐别名与主题变量，加入实际需要的基础组件，统一按钮、卡片、表单和状态；选择与 Shadcn Admin 接近的 primitive 版本，避免不同来源组件混用后产生 API 差异。
2. **完成可比较样板**：先改管理端布局、仪表盘和一个筛查列表，确认中文内容、长标签、窄屏、空数据、错误与加载状态的实际表现。
3. **扩展其余页面**：复用通过验证的布局和控件，迁移预警、案例、检索、工作台与个人端；问卷评分、风险分级和服务调用沿用已有业务代码。

粗略工程估算：熟悉本项目与 React 的一名开发者，完成“基础组件 + 管理端框架 + 仪表盘 + 一个列表”的首轮样板约 **2–4 人日**。这是基于源码检查的估计，包含基础适配与自检，不包含全站迁移、新权限体系、后端改造或新增业务功能；实际耗时需在首个样板完成后校准。

## 6. 未列为快速迁移首选的案例

[Mosaic Lite](https://github.com/cruip/tailwind-dashboard-template) 的视觉完成度较好，也使用 Vite/Tailwind，但图表采用 Chart.js。其 README 同时写有 GPL 与额外模板再分发说明，授权表述需要进一步核实；本轮更适合作为视觉参考，不纳入优先复制源码的候选。

大量 Next.js 仪表盘也有良好外观，但对本项目而言还需替换框架专用导航、图片或服务端能力。已有接近现有栈的案例时，收益不足以优先承担这部分迁移。

## 7. 核验范围

- 读取了本项目依赖、路由、主题、布局、仪表盘、筛查列表、问卷与工作台相关源码。
- 查阅了候选项目的官方文档、仓库说明、许可和关键 package.json。
- 实际浏览了 Shadcn Admin 首页、TailAdmin Free/Pro 首页、Mantine UI 案例目录与 Mantis Free 仪表盘。
- Ant Design Pro、Tremor 与 assistant-ui 的判断依据为官方文档及源码，未声称完成全功能交互验证。
- 本轮只生成调研文档，没有安装候选依赖或修改业务页面。兼容性结论属于静态评估，正式接入仍需完成构建、类型检查与代表性页面验证。
