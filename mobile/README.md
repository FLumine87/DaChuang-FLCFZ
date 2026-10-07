# 心理守护 · 移动端（Project DC）

> 以 Web 端为基准构建的学生端安卓 App。技术栈：**Capacitor 7 + React 19 + Vite 7 + Tailwind 4**。
> 一个 APK 同时支持「离线演示」与「连接实机」两种模式，可在 App 内随时切换。

---

## 一、设计要点

| 事项 | 做法 |
|---|---|
| 代码复用 | **不复制前端代码**：通过 `@shared` 别名直接复用 `../frontend/src` 的数据层（`services/` `auth/` `data/`）与通用组件；移动端只自带一套为触屏重做的 UI |
| 范围 | 只做**学生端（个人端）**：首页 / 筛查 / 采集 / 检索 / 预警 / 档案 + 登录 + 设置；管理端留在 Web |
| 双模式 | `USE_MOCK` 由构建期常量改为**运行期开关**（`@shared/services/http` 的 `getAppMode()/isMockMode()`，读 localStorage 的 `psych_runtime_mode`）→ 首启「模式选择页」选完即生效，无需两个包 |
| 原生能力 | 相机（`@capacitor/camera`）、麦克风录音（复用 `useAudioRecorder` → 24414Hz 单声道 WAV）、Android 物理返回键、状态栏、启动图、轻震动 |
| 移动端适配 | 底部 TabBar、安全区 `env(safe-area-inset-*)`、触摸目标 ≥44px、禁橡皮筋回弹与点击高亮 |

---

## 二、目录结构

```
mobile/
├── src/
│   ├── main.tsx / App.tsx          入口与路由（HashRouter）
│   ├── index.css                   Tailwind 4 + 主题色 + 安全区工具类
│   ├── platform/
│   │   ├── mode.ts                 运行模式（mock/live）+ 后端地址 + 连通性测试
│   │   ├── native.ts               Capacitor 原生能力封装（含非原生降级）
│   │   └── useBackHandler.ts       Android 返回键 → 路由
│   ├── components/                 TabBar / MobileLayout / ui 积木
│   └── pages/                      10 个页面（见上）
├── capacitor.config.ts             appId com.dachuang.psychscreen，appName 心理守护
├── scripts-make-assets.py           生成图标/启动图源图（Pillow）
├── scripts-install-android-sdk.ps1  便携安装 Android SDK（无需管理员）
├── scripts-build-apk.bat            本地一键构建
└── android/                         Capacitor 生成的安卓工程（cap sync 维护）
```

> `@shared/*` → `../frontend/src/*`（见 `vite.config.ts` 与 `tsconfig.json`）。

---

## 三、本地开发

```bash
cd mobile
npm install
npm run dev          # 浏览器打开 http://localhost:5273
```

浏览器里也能跑全部功能（相机自动退回文件选择器，返回键逻辑自动忽略）；
`npm run dev` 时 `/api` 会代理到 `VITE_DEV_PROXY_TARGET`（默认 `http://localhost:8000`）。

### 连真机调试

```bash
npm run sync                 # build + cap sync android
cd android && gradlew.bat installDebug   # 需已连接手机并开启 USB 调试
```

---

## 四、构建 APK

### 方式 A：本地（Windows）

前置：**JDK 21**（Capacitor 7 用 `source release 21` 编译，JDK 17 会报`无效的源发行版：21`／`invalid source release: 21`）+ Android SDK（`platforms;android-35` + `build-tools;35.0.0`）。

> 本机当前：JDK 21 装在 `C:\aaa\JAVA\jdk-21`，Android SDK 在 `%LOCALAPPDATA%\Android\Sdk`（`scripts-build-apk.bat` 已写死这两个路径，换机请改脚本头部）。

```bat
:: 首次安装 SDK（无需管理员）
powershell -ExecutionPolicy Bypass -File scripts-install-android-sdk.ps1

:: 出 debug 包
scripts-build-apk.bat assembleDebug

:: 出 release 包（需先配签名，见下）
scripts-build-apk.bat assembleRelease
```

产物：`mobile/android/app/build/outputs/apk/debug/app-debug.apk`

### 方式 B：GitHub Actions

`.github/workflows/build-android.yml`（**手动触发**，不随 push 自动跑）：

```bash
gh workflow run build-android.yml -f variant=debug
```

> ⚠️ `workflow_dispatch` 的 workflow 需先存在于默认分支才能在页面出现；
> 合并到 `main` 后即可在 Actions 页面点按钮，也可用 `gh workflow run --ref <branch>`。

### 签名（release）

1. 生成 keystore（**绝不入库**，已在 `.gitignore` 中忽略 `*.keystore`）：

```bat
keytool -genkeypair -v -keystore psychscreen-release.keystore -alias psychscreen ^
  -keyalg RSA -keysize 2048 -validity 10000
```

2. 在 `mobile/android/keystore.properties`（同样被忽略）写：

```properties
storeFile=psychscreen-release.keystore
storePassword=***
keyAlias=psychscreen
keyPassword=***
```

3. CI 构建则改用仓库 Secrets：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、
   `ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。

> ⚠️ **keystore 一旦丢失就无法覆盖安装升级**，请离线备份。

---

## 五、关于「连接实机」模式

后端是 Cloudflare Worker（`*.workers.dev`），**在中国大陆无法直连**。
因此 App 默认走离线演示；选「连接实机」时需：

1. 手机网络能访问该域名（科学上网 / 自建代理）；
2. 在模式选择页或「设置」里填后端地址并**测试连接**通过（返回 401 也算通）。

---

## 六、已知限制

- 移动端**不含管理端**（表格密集，场景在电脑前），管理端请用 Web 版；
- iOS 未构建（Capacitor 同一份代码可出 iOS，但编译需 macOS + Xcode）；
- 未接入推送通知（预警目前靠 App 内查看）；
- 真实多模态检索依赖后端；离线演示模式下的检索结果与媒体均为内置示例。
