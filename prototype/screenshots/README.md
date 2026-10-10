# 原型截图

命名规则：`<端>-<页面>[-<状态>][-<模式>].png`，未标模式的一律为浅色模式。
分辨率 2x（`--force-device-scale-factor=2`），窗口宽 1440。

| 文件 | 页面 / 状态 |
|---|---|
| `login-light.png` | 登录页 |
| `personal-home-light.png` / `-top` / `-full` | 个人首页 |
| `personal-retrieval-light.png` / `-top` / `-full` | 检索与分析 |
| `personal-screening.png` | 量表作答 · 第 3 题（作答中） |
| `personal-screening-safety.png` | 量表作答 · 第 9 题（安全题，答「好几天」后就地展开支持信息） |
| `personal-screening-result.png` | 量表作答 · 提交后的结果态（总分 15，橙色段） |
| `personal-collect.png` | 多模态采集 · 语音片段（录音台） |
| `personal-collect-image.png` | 多模态采集 · 绘画 / 图像 |
| `personal-alerts.png` | 预警中心（个人端） |

重跑方式（本机 Chrome，无需起服务）：

```bash
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMPDIR="$PWD/.chrome-tmp" "$CH" --headless=new --no-sandbox --disable-gpu \
  --hide-scrollbars --disable-crash-reporter --user-data-dir="$PWD/.chrome-tmp/shot" \
  --force-device-scale-factor=2 --window-size=1440,1050 \
  --screenshot="$PWD/screenshots/personal-alerts.png" \
  "file://$PWD/pages/personal-alerts.html#light"
```

页面支持 `#light` / `#dark` 强制模式（否则跟随本机存储或系统偏好），
以及 `#safety` / `#result` / `#image` 等状态直达，用于截图与评审。
