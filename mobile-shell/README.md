# mobile-shell —— 把 frontend 装进安卓 App

## 这是什么

一个 **Capacitor 外壳**：不写任何界面，只负责把 `frontend/` 的构建产物装进
安卓 WebView，打成一个 APK。

和团队 `feature/mobile-app` 分支上那套的区别：

| | `feature/mobile-app` 的 mobile/ | 这里的 mobile-shell/ |
|---|---|---|
| 界面 | **另写一套**：MobileLayout + TabBar + 9 个手机专用页面 | 不写，直接用 frontend |
| 与桌面端关系 | 只同步 10 个文件，界面会持续漂移 | **同一份代码**，改一次两边都变 |
| 为什么可行 | — | frontend 本身就是响应式的，手机宽度的 WebView 里渲染出来就是手机版式 |

## 怎么出 APK

本机要出包得装 JDK + Android SDK（2~3 GB），所以走 CI：

```
GitHub → Actions → Build Android APK → Run workflow
编完在 Artifacts 里下载 psych-screen-apk
```

本地只做到"同步"这一步（不需要 SDK）：

```bash
cd frontend && npm run build:app     # 产出 dist-app/（base=/）
cd ../mobile-shell && npm install && npx cap sync android
```

## 两个必须注意的点

1. **base 必须是 `/` 而不是 `/DaChuang-FLCFZ/`**
   Capacitor 把 `android/app/src/main/assets/public/` 挂在 `https://localhost`
   的**根**上。用 Pages 那套子路径，`/DaChuang-FLCFZ/assets/*.js` 会 404，
   App 打开就是白屏。所以单独有 `.env.capacitor` + `npm run build:app`，
   产物输出到 `dist-app/`，不覆盖给 Pages 用的 `dist/`。

2. **`androidScheme: 'https'` 不能改**
   它让 WebView 里的页面处于「安全上下文」，否则 `getUserMedia`
   （麦克风 / 摄像头）会被直接拒绝 —— 而语音、图像采集是本平台的核心功能。

## 数据模式

`.env.capacitor` 里 `VITE_USE_MOCK=true`：App 是离线演示用的，不依赖任何后端。
要连真实后端时改这个文件里的 `VITE_API_BASE_URL` 后重新构建。
