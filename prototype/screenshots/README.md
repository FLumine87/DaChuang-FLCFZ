# 原型截图

命名规则：`<端>-<页面>[-<状态>][-<模式>].png`，未标模式的一律为**浅色模式**（深色只抽查 4 张，文件名带 `-dark`）。
统一 2x（`--force-device-scale-factor=2`），窗口宽 1440，高度按各页内容底部 + 90px 单独定。

## 浅色（21 张）

| 文件 | 页面 / 状态 |
|---|---|
| `index-light.png` | 原型门面（入口 + 演示动线 + 16 页清单） |
| `system-selector.png` | 选择系统 |
| `login-light.png` | 登录页 |
| `personal-home-light.png` | 个人首页 |
| `personal-screening.png` | 心理筛查 · 第 3 题（作答中） |
| `personal-screening-safety.png` | 心理筛查 · 第 9 题（安全题，答「好几天」后就地展开支持信息） |
| `personal-screening-result.png` | 心理筛查 · 提交后的分段结果（15/27，中重度段） |
| `personal-collect.png` | 多模态采集 · 语音（录音台与波形） |
| `personal-collect-image.png` | 多模态采集 · 绘画 / 图像 |
| `personal-retrieval-light.png` | 检索与分析 · 跨模态命中与相关性悬崖 |
| `personal-rag.png` | RAG 分析结果 |
| `personal-alerts.png` | 预警中心（个人端） |
| `personal-profile.png` | 我的档案 |
| `admin-dashboard.png` | 管理端 · 数据概览 |
| `admin-screenings.png` | 管理端 · 筛查管理 |
| `admin-collect.png` | 管理端 · 采集审阅（文本页签） |
| `admin-collect-image.png` | 管理端 · 采集审阅（图像页签） |
| `admin-retrieval.png` | 管理端 · 检索与分析 |
| `admin-alerts.png` | 管理端 · 预警管理 |
| `admin-cases.png` | 管理端 · 案例管理 |
| `admin-agent.png` | 管理端 · 预警研判台 |

## 深色（4 张抽查）

`admin-dashboard-dark.png` · `personal-home-dark.png` · `personal-rag-dark.png` · `admin-agent-dark.png`

深色模式靠变量翻转实现（`tokens.css` 里 `.dark` 段整体重映射），全站不需要写 `dark:` 变体。

## 重跑方式

本机 Chrome 直接出图，不需要起服务、不需要构建：

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

两个必须注意的点：

1. **每次截图换一个 `--user-data-dir`**。深浅色偏好存在 `localStorage` 里，复用同一个 profile 会让模式串档。
2. **必须带 `--no-sandbox`**，否则 Chrome 在当前环境下会崩。

页面支持 `#light` / `#dark` 强制模式（否则跟随本机存储或系统偏好），
以及 `#safety` / `#result` / `#image` / `#audio` 等状态直达，用于截图与评审。
