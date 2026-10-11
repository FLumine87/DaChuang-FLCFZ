# 交接说明（给下一个会话 / 下一个模型）

**这份文件的目的**：让任何新的 AI 会话或人，读完这一页就能接着改，不用重新考古。
建议在新会话里第一句话就把它发过去。

---

## 一、仓库里有两套完全不同的东西，别搞混

| 目录 | 是什么 | 能跑吗 | 动它的后果 |
|---|---|---|---|
| `prototype/` | **静态高保真原型**：16 个手写 HTML + 一份 CSS/JS 设计系统 | 双击 HTML 就能看，不需要构建 | 完全安全，不影响线上 |
| `frontend/` | **真实的 React 应用**（React 19 + Vite + Tailwind v4） | 需要 `npm install && npm run dev` | 会改到真正的产品代码 |

**2026-10-11 更新：原型的共享视觉规范与主要首页布局已迁入 `frontend/`，不再仅存在于原型中。**
后续修改登录后的应用请修改 `frontend/`；整合范围、演示启动和接口限制见 `frontend/INTEGRATION.md`。
本文件其余原型说明保留作设计参考，第五节为原始迁移建议，不代表全部尚未实施。

---

## 二、原型怎么组织的

```
prototype/
├── index.html              门面：两端入口 + 8 分钟演示动线 + 16 页清单
├── DEMO.md                 演示讲稿 +「如果被追问」对照表
├── CHANGELOG.md            改动清单（按类别，非时间线）
├── HANDOFF.md              本文件
├── 原型-单文件.html         打包产物：全部内联，发给别人就看这一个文件
├── assets/
│   ├── tokens.css          ★ 设计 token：颜色 / 字号 / 间距 / 圆角 / 布局尺度
│   ├── base.css             组件层：卡片 / 表格 / 按钮 / 标签 / 图表 / 表单
│   ├── shell.css            外壳：侧栏 + 顶栏 + 面包屑 + 页头
│   ├── shell.js             侧栏/顶栏渲染 + 图标表（导航只在这里维护一份）
│   ├── app.js               交互：深浅模式、侧栏折叠、分段控件
│   └── fonts/               内嵌 Manrope + JetBrains Mono（SIL OFL）
├── pages/*.html            16 个页面
├── screenshots/            27 张 2x 截图 + 命名规则 README
└── scripts/build-bundle.mjs  单文件打包脚本
```

**改样式的正确入口**：90% 的视觉调整只需要改 `assets/tokens.css`（颜色、字号、
间距、圆角都在那儿）。页面 HTML 里不写裸色值，一律引用 `var(--…)`。

---

## 三、页面清单与它们的真实出处

16 页全部对齐仓库真实路由（`frontend/src/App.tsx`），内容取自真实数据文件：

| 页面 | 内容出自 |
|---|---|
| `personal-screening` | `frontend/src/data/questionnaireData.ts`（PHQ-9 真实题面与分段） |
| `personal-home` / `personal-profile` | `frontend/src/data/mockData.ts`（trend / timeline / actionPlan / userProfile） |
| `personal-retrieval` / `personal-rag` | `mockData.ts` 的 `ragReport`、`retrievalResults` |
| `admin-dashboard` / `admin-alerts` / `admin-cases` | `frontend/src/admin/data/adminMockData.ts` |
| `admin-agent` | `frontend/src/services/agentApi.ts` 的字段结构 |
| 检索页的索引细节 | `backend/app/engines/hashing/multi_table_index.py`（8 位带 × probe_bits=2） |

每页底部脚注都写明了这一页的数据来源，改内容时照着脚注去找源文件。

---

## 四、约定（改之前先读，保持一致）

1. **不写裸色值**，一律 `var(--…)`；新增颜色先在 `tokens.css` 里定义
2. **图标用手写 SVG**，1.7 描边，线性、无 emoji（`shell.js` 的 `ICONS` 表里加）
3. **数字一律等宽**：加 `class="num"`（`tabular-nums`）或 `class="mono"`
4. **色只用于语义**：预警四级 = 绿/黄/橙/红，其余地方不用彩色装饰
5. **不做**：渐变主视觉、玻璃拟态、发光边框、大圆角浮动卡片、emoji 图标
6. **诚实优先**：接口没接通就写"未接通"并把按钮禁用，**不要伪造成功态**
7. 页面通过 `#light` / `#dark` 强制深浅模式，`#safety` / `#result` / `#image` / `#audio` 状态直达

---

## 五、常见任务的入口

**改视觉 / 配色 / 字号**
→ 改 `assets/tokens.css`，然后重跑截图（见第六节）

**加一个页面**
→ 在 `pages/` 新建 HTML，从任一现有页面复制 `<head>` 与 `.app` 外壳结构，
改 `data-shell` 里的 `active` 字段，再到 `assets/shell.js` 的 `NAV` 里加导航项，
最后在 `index.html` 的清单里加一行

**加一个组件样式**
→ 加到 `assets/base.css` 末尾，类名用 `.block__element` 驼峰式连字符

**重新打包单文件**
→ `node scripts/build-bundle.mjs`（需要 Node；`DSH_PYTHON` 环境变量可指定 Python 用于压图）

**把新设计落成 React（尚未做）**
→ `prototype/` 与 `frontend/` 解耦，设计 token 可直接对应
`frontend/src/index.css` 里的 Tailwind 主题变量；落地方式是按页面逐个替换组件

---

## 六、重新生成截图

本机 Chrome 出图，不需要起服务：

```bash
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
cd prototype
TMPDIR="$PWD/.chrome-tmp" "$CH" --headless=new --no-sandbox --disable-gpu \
  --hide-scrollbars --disable-crash-reporter \
  --user-data-dir="$PWD/.chrome-tmp/shot" \
  --force-device-scale-factor=2 --window-size=1440,1246 \
  --screenshot="$PWD/screenshots/admin-alerts.png" \
  "file://$PWD/pages/admin-alerts.html#light"
```

两个坑：**每次换一个 `--user-data-dir`**（深浅偏好存在 localStorage，复用会串档）；
**必须带 `--no-sandbox`**（否则当前环境下 Chrome 会崩）。完整文件名单见 `screenshots/README.md`。

---

## 七、当前状态（截至最后一次提交）

- 分支 `main`，**未 push**，领先 `origin/main` 33 个提交（其中 6 个是原型工作）
- 原型文件 32 个全部入库；截图（`*.png`）按仓库 `.gitignore` 不入库，但在磁盘上
- `原型-单文件.html`（3.2MB）是强制入库的，因为它是主要交付物
- 完整历史快照：`.bundles/` 目录下有 `git bundle`，可克隆出全部历史
- 已知未做：把新设计落成 React 组件；管理端「预警研判台」的后端确认接口
