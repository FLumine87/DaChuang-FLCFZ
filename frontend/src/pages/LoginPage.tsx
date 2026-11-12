import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { navigateWithTransition } from "../utils/viewTransition";
import { readDemoPreset } from "../demoPreset";
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Moon,
  ShieldCheck,
  Sun,
  UserPlus,
} from "lucide-react";
import BrandLogo from "../components/BrandLogo";
import Aurora from "../components/Aurora";
import { apiLogin, apiRegister } from "../services/mockApi";
import { isOfflineDemo } from "../services/http";
import { adminDemo } from "../auth/demoCredentials";
import { saveDisplayName, saveSessionToken } from "../auth/session";
import { resolveEntryPath } from "../auth/entryPath";

type AuthTab = "login" | "register";
type Theme = "light" | "dark";
type Panel = "user" | "admin";

const THEME_KEY = "psych_theme";

const readStoredTheme = (): Theme =>
  window.localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";

/* HashRouter 下查询参数在 hash 里（#/login?panel=admin），
   必须用 router 的 location.search 读取，window.location.search 取不到。 */
const readPanel = (search: string): Panel =>
  new URLSearchParams(search).get("panel") === "admin" ? "admin" : "user";

/* 独立登录页：主页左上角「登录」按钮跳到这里；主页右上角「管理员登录」带 ?panel=admin。
   进来只做登录这一件事——平台介绍留给主页，不再一页两职。 */
export default function LoginPage() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const initialPanel = readPanel(search);
  const [tab, setTab] = useState<AuthTab>("login");
  const [panel, setPanel] = useState<Panel>(initialPanel);
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  /* 演示包（手机版）会预填演示账号：手机上打两遍账号密码很烦，
     而演示现场常是"把手机递给别人看"。没有预设时初值仍是空串。 */
  const preset = readDemoPreset().prefill ?? {};
  const [username, setUsername] = useState(preset.username ?? "");
  const [password, setPassword] = useState(preset.password ?? "");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);


  /* 这里刻意**不做**"已登录就直接放行"：打开登录页永远当作没登录过，
     输入框留空、正常走一次登录。否则点顶栏「登录」会被瞬间送进系统，
     连表单都看不到（用户明确要求过）。
     "记住我"仍然保留：勾了之后 token 存在 localStorage，直接访问工作台地址
     依旧是登录状态，不用重新输。 */

  useEffect(() => {
    const dark = theme === "dark";
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", dark ? "#0b1120" : "#465fff");
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* 隐私模式下 localStorage 不可写时忽略 */
    }
  }, [theme]);


  const toggleTheme = () => {
    const root = document.documentElement;
    root.classList.add("theme-switching");
    window.setTimeout(() => root.classList.remove("theme-switching"), 260);
    setTheme(theme === "dark" ? "light" : "dark");
  };

  const getPasswordStrength = (
    value: string,
  ): { label: "弱" | "中" | "强"; color: string; score: number } => {
    let score = 0;
    if (value.length >= 8) score += 1;
    if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
    if (/\d/.test(value)) score += 1;
    if (/[^A-Za-z0-9]/.test(value)) score += 1;
    if (score <= 1) return { label: "弱", color: "text-danger-600", score: 1 };
    if (score <= 3) return { label: "中", color: "text-warning-600", score: 2 };
    return { label: "强", color: "text-success-600", score: 3 };
  };

  const strength = getPasswordStrength(password);

  /* 切换主题：在切换的 ~240ms 内加过渡类，让整页颜色「渐变」而不是「硬切」。
     大面积浅↔深硬切时看着像闪一下，加了过渡就平滑了。 */
  const resetTips = () => {
    setMessage("");
    setError("");
  };

  const switchTab = (value: AuthTab) => {
    setTab(value);
    setShowPassword(false);
    resetTips();
  };

  const switchPanel = (next: Panel) => {
    setPanel(next);
    setShowPassword(false);
    resetTips();
    /* 两个身份之间切换时同样清空：不给任何预填 */
    setUsername("");
    setPassword("");
    if (next === "admin") setTab("login");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const fillDemo = (next: Panel) => {
    if (next === "admin") {
      setUsername(adminDemo.username);
      setPassword(adminDemo.password);
    } else {
      setUsername("xiaoyu");
      setPassword("123456");
    }
    resetTips();
  };

  const handleLogin = async () => {
    resetTips();
    setLoading(true);
    try {
      const result = await apiLogin(username, password);
      if (!result.ok || !result.token) {
        setError(result.message || "登录失败");
        return;
      }
      saveSessionToken(result.token, rememberMe);
      saveDisplayName(result.name);
      /* 连不上后端时 apiLogin 会自动用本机演示数据完成登录（result.offline）。
         这里不再把它说成"登录成功"，而是如实说明进入了离线演示；
         工作台顶栏也会挂着「离线演示」标记（AppShell）。 */
      setMessage(
        result.offline
          ? "后端暂时连不上，已进入离线演示模式…"
          : "登录成功，正在进入系统…",
      );
      /* 直接跳，不再 setTimeout 等 500ms：那句话是给"跳转前"看的，
         但真实体感就是登录后干等半秒（用户提过等待太久）。
         个人账号第一次登录先进欢迎页；判据是账号的引导状态，不是"有没有筛查记录"：
         跳过引导的人本来就没有记录，用记录判的话他每次登录都会被再拦一次。 */
      navigate(resolveEntryPath(result.role), { replace: true });
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    resetTips();
    if (password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    if (!name) {
      setError("请输入姓名");
      return;
    }
    setLoading(true);
    try {
      const result = await apiRegister(username, password, name);
      if (!result.ok) {
        setError(result.message || "注册失败");
        return;
      }
      setMessage(result.message || "注册成功，请使用新账号登录");
      setTab("login");
      setPassword("");
      setConfirmPassword("");
      setName("");
    } finally {
      setLoading(false);
    }
  };

  const isAdmin = panel === "admin";

  return (
    <div className="page-enter auth-snap min-h-screen bg-page text-slate-800">
      {/* 登录页顶栏：只留品牌与返回主页，不放章节导航（那些章节在主页上） */}
      <header className="nav-blur sticky top-0 z-40 px-6 sm:px-10 lg:px-12 xl:px-16">
        <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandLogo showSubtitle={false} />
            {/* 品牌 ｜ 当前页名：与腾讯云顶栏同一做法，让人一眼知道在哪一页 */}
            {/* whitespace-nowrap 必须加：否则窄屏下 flex 会把中文逐字换行，
                顶栏会出现"健/康/管/理/平/台"竖排的破版。产品线与页名在窄屏隐藏。 */}
            <span className="hidden whitespace-nowrap text-[15px] font-medium text-primary-600 sm:inline">
              健康管理平台
            </span>
            <span aria-hidden="true" className="hidden h-5 w-px bg-slate-300/80 sm:block" />
            <span className="whitespace-nowrap text-[15px] font-medium text-slate-700">{"登录"}</span>
          </div>
            <div className="flex items-center gap-1.5">
              {/* 返回主页：纯文字链接。原先那个白底描边按钮放在浅色顶栏上太抢眼 */}
              <button
                type="button"
                onClick={() => navigateWithTransition(navigate, "/")}
                className="group inline-flex items-center gap-1.5 px-2.5 py-2 text-sm font-medium text-slate-500 transition-colors duration-200 hover:text-primary-600"
              >
                <ArrowLeft className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
                <span className="whitespace-nowrap">返回主页</span>
              </button>
              <button
                type="button"
                className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition-all duration-200 hover:bg-white/80 hover:text-primary-700 active:scale-90 active:bg-white"
                aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
                title={theme === "dark" ? "浅色模式" : "深色模式"}
                onClick={toggleTheme}
              >
                {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>
            </div>
        </div>
      </header>

      {/* ============ 第 1 屏：登录（左宣传卡，右登录框） ============ */}
      <section
        id="login"
        className="auth-screen relative flex items-center overflow-hidden px-6 py-8 sm:px-10 lg:px-12 xl:px-16 lg:min-h-[calc(100svh-4rem)]"
      >
        <Aurora variant="calm" />
        <div className="relative z-10 mx-auto grid w-full max-w-[1440px] items-center gap-12 lg:grid-cols-[minmax(0,620px)_minmax(0,450px)] lg:justify-center lg:gap-[72px] 2xl:grid-cols-[minmax(0,720px)_minmax(0,500px)] 2xl:gap-[96px]">

          {/* 左：与平台简介屏同一套文字格式（眉标 + 大标题 + 正文 + 要点）。
              不再整体上提：那段偏移是为旧的短卡片调的，现在卡片更高、左栏内容更短，
              上提会把空白全堆到下方，深色模式下尤其显得空。
              改为几何居中，并把眉标/标题/正文/要点的间距各放大一档，
              让文字块在竖直方向铺开，与右侧卡片等高对齐。 */}
          <div className="relative z-10">
            <p className="text-base font-semibold tracking-[0.2em] text-primary-500">
              关注状态 · 看见变化
            </p>
            <h2 className="auth-section-title mt-8 max-w-[720px] text-balance tracking-tight text-slate-900">
              从了解自己开始，照顾好每一天。
            </h2>
            <p className="mt-10 max-w-[620px] text-[18px] leading-9 text-slate-600 sm:text-[20px] sm:leading-[2.15]">
              连接筛查、记录与分析，让每一份关注都能得到回应；
              <br />
              登录后可查看筛查记录、状态趋势与评估报告。
            </p>

            <ul className="mt-10 grid gap-2.5 border-t border-dashed border-slate-200 pt-7">
              {[
                "三模态采集：文本、语音、图像",
                "持续记录：状态趋势与量表同步归档",
                "分级预警：高风险进入人工复核",
              ].map((point) => (
                <li
                  key={point}
                  className="flex items-center gap-2.5 text-[15px] leading-6 text-slate-600"
                >
                  <Check className="h-4 w-4 shrink-0 text-success-600" />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          {/* 右：登录卡 */}
          <div className="relative z-10 w-full">
            <div className="mx-auto w-full max-w-[450px] rounded-3xl border border-slate-200 bg-white p-6 shadow-[var(--card-shadow)] sm:p-7 2xl:max-w-[500px]">
              <div className="mb-5">
                <p
                  className={`text-[13px] font-medium tracking-[0.16em] ${
                    isAdmin ? "text-success-600" : "text-primary-500"
                  }`}
                >
                  {isAdmin ? "STAFF ACCESS" : tab === "login" ? "WELCOME BACK" : "CREATE ACCOUNT"}
                </p>
                <h2 className="mt-3 text-2xl font-semibold text-slate-900">
                  {isAdmin ? "管理员登录" : tab === "login" ? "欢迎回来" : "创建个人账号"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {isAdmin
                    ? "咨询师与管理人员入口，用于预警研判、个案跟踪与数据维护。"
                    : tab === "login"
                      ? "登录后可查看筛查记录、状态趋势与评估报告。"
                      : "建立属于你的健康档案，开始持续记录。"}
                </p>
              </div>

              {/* 后端连不上时如实说明：当前看到的是本机演示数据，不是服务器数据。
                  放在表单上方而不是错误条，因为它描述的是整页的运行状态。 */}
              {isOfflineDemo() && (
                <p className="mb-4 rounded-xl border border-warning-500/40 bg-warning-50 px-4 py-3 text-sm leading-6 text-warning-600">
                  后端暂时连不上，当前使用<strong className="font-semibold">离线演示数据</strong>
                  （只保存在这台设备）。用下方演示账号可直接进入；退出登录后会重新尝试连接后端。
                </p>
              )}

              {!isAdmin && (
                <div
                  className="mb-4 flex rounded-xl bg-slate-100 p-1"
                  role="tablist"
                  aria-label="登录或注册"
                >
                  {(["login", "register"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={tab === value}
                      onClick={() => switchTab(value)}
                      className={`flex-1 rounded-lg py-2.5 text-sm font-medium transition-all ${
                        tab === value
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {value === "login" ? "登录" : "注册"}
                    </button>
                  ))}
                </div>
              )}

              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!loading)
                    void (isAdmin || tab === "login" ? handleLogin() : handleRegister());
                }}
              >
                <div>
                  <label
                    htmlFor="username"
                    className="mb-2 block text-sm font-medium text-slate-700"
                  >
                    {isAdmin ? "管理员账号" : "用户名"}
                  </label>
                  <input
                    id="username"
                    autoComplete="username"
                    required
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder={isAdmin ? "请输入管理员账号" : "请输入用户名"}
                    className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-800"
                  />
                </div>

                {!isAdmin && tab === "register" && (
                  <div>
                    <label
                      htmlFor="name"
                      className="mb-2 block text-sm font-medium text-slate-700"
                    >
                      姓名
                    </label>
                    <input
                      id="name"
                      autoComplete="name"
                      required
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="请输入姓名"
                      className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-800"
                    />
                  </div>
                )}

                <div>
                  <label
                    htmlFor="password"
                    className="mb-2 block text-sm font-medium text-slate-700"
                  >
                    密码
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete={
                        isAdmin || tab === "login" ? "current-password" : "new-password"
                      }
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="请输入密码"
                      className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 pr-12 text-sm text-slate-800"
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-3.5 text-slate-500 transition-colors hover:text-slate-700"
                    >
                      {showPassword ? (
                        <EyeOff className="h-5 w-5" />
                      ) : (
                        <Eye className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                </div>

                {!isAdmin && tab === "register" && (
                  <>
                    <div>
                      <div className="flex justify-between text-[13px] text-slate-500">
                        <span>密码强度</span>
                        <span className={password ? strength.color : "text-slate-500"}>
                          {password ? strength.label : "未输入"}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full transition-all ${
                            !password
                              ? "w-0"
                              : strength.score === 1
                                ? "w-1/3 bg-danger-500"
                                : strength.score === 2
                                  ? "w-2/3 bg-warning-500"
                                  : "w-full bg-success-500"
                          }`}
                        />
                      </div>
                    </div>
                    <div>
                      <label
                        htmlFor="confirm-password"
                        className="mb-2 block text-sm font-medium text-slate-700"
                      >
                        确认密码
                      </label>
                      <input
                        id="confirm-password"
                        type="password"
                        autoComplete="new-password"
                        required
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder="请再次输入密码"
                        className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-800"
                      />
                    </div>
                  </>
                )}

                <div className="flex items-center justify-between gap-4">
                  <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(event) => setRememberMe(event.target.checked)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {isAdmin ? "在本机保持登录" : "记住我"}
                  </label>
                  <span className="inline-flex items-center gap-1 text-[13px] text-slate-500">
                    <Check className="h-3.5 w-3.5 text-success-600" />
                    安全登录
                  </span>
                </div>

                {error && (
                  <p
                    role="alert"
                    className="rounded-xl border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-600"
                  >
                    {error}
                  </p>
                )}
                {message && (
                  <p
                    role="status"
                    className="rounded-xl border border-success-100 bg-success-50 px-4 py-3 text-sm text-success-600"
                  >
                    {message}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="ui-button ui-button-primary mt-1 h-12 w-full rounded-xl disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isAdmin ? (
                    <ShieldCheck className="h-4 w-4" />
                  ) : tab === "login" ? (
                    <Lock className="h-4 w-4" />
                  ) : (
                    <UserPlus className="h-4 w-4" />
                  )}
                  {loading
                    ? "处理中…"
                    : isAdmin
                      ? "进入管理端"
                      : tab === "login"
                        ? "登录并进入系统"
                        : "创建个人账号"}
                </button>
              </form>

              <button
                type="button"
                onClick={() => fillDemo(isAdmin ? "admin" : "user")}
                className="mt-4 flex w-full items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] text-slate-500 transition-colors hover:border-primary-200 hover:text-slate-700"
              >
                <span>{isAdmin ? "管理端 · 咨询师" : "演示账号"}</span>
                <code className="font-mono text-slate-800">
                  {isAdmin ? `${adminDemo.username} / ${adminDemo.password}` : "xiaoyu / 123456"}
                </code>
              </button>

              {/* 管理员入口：它是"登录"这件事的一部分，放进卡片比放顶栏自然 */}
              <button
                type="button"
                onClick={() => switchPanel(isAdmin ? "user" : "admin")}
                aria-pressed={isAdmin}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-[13px] font-medium text-slate-500 transition-colors duration-200 hover:bg-slate-50 hover:text-primary-600"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                {isAdmin ? "返回用户登录" : "管理员 / 咨询师入口"}
              </button>

              <p className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-4 text-[13px] leading-5 text-slate-500">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                {isAdmin
                  ? "仅限授权人员使用，研判与处置操作均留痕"
                  : "记录仅用于心理健康评估与服务支持，高风险进入人工复核"}
              </p>
            </div>
          </div>
        </div>

      </section>
    </div>
  );
}
