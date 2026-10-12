import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  ChevronDown,
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
import { apiLogin, apiRegister } from "../services/mockApi";
import { saveDisplayName, saveSessionToken } from "../auth/session";
import {
  AlertVisual,
  AssessVisual,
  PrivacyVisual,
  Section,
  TechVisual,
} from "./introSections";
import { navItems, screens } from "./introContent";

type AuthTab = "login" | "register";
type Theme = "light" | "dark";
type Panel = "user" | "admin";

const THEME_KEY = "psych_theme";

const readStoredTheme = (): Theme =>
  window.localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";

/* 一页到底：第 1 屏登录，往下依次是作品简介与四个章节（整屏翻页） */
export default function AuthPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<AuthTab>("login");
  const [panel, setPanel] = useState<Panel>("user");
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [active, setActive] = useState("login");
  const glideRef = useRef<((target: number) => void) | null>(null);

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

  /* 整屏吸附翻页 */
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("auth-snap");
    return () => root.classList.remove("auth-snap");
  }, []);

  /* 换页滑动：不拦截滚轮，手势走原生滚动，停下后用自定义缓动落到整屏 */
  useEffect(() => {
    const NAV_H = 64;
    const DURATION = 550;
    const SETTLE_DELAY = 180;
    const FAST_DURATION = 320;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const desktop = window.matchMedia("(min-width: 1024px) and (min-height: 720px)");

    let raf = 0;
    let settleTimer: number | undefined;
    let animating = false;
    let targetIdx = -1;

    const screensOf = () =>
      Array.from(document.querySelectorAll<HTMLElement>(".auth-screen"));

    const ease = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const posOf = (el: HTMLElement) => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      return Math.max(0, Math.min(max, el.offsetTop - NAV_H));
    };

    const actualIndex = () => {
      const els = screensOf();
      const y = window.scrollY + NAV_H + 4;
      let idx = 0;
      els.forEach((el, i) => {
        if (el.offsetTop <= y) idx = i;
      });
      return idx;
    };

    const cancelGlide = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      animating = false;
    };

    const glideTo = (target: number, msOverride?: number) => {
      cancelGlide();
      const els0 = screensOf();
      if (els0.length) {
        let best = 0;
        let bestGap = Infinity;
        els0.forEach((el, i) => {
          const gap = Math.abs(posOf(el) - target);
          if (gap < bestGap) {
            bestGap = gap;
            best = i;
          }
        });
        targetIdx = best;
      }
      const startY = window.scrollY;
      const delta = target - startY;
      const ms = reduced.matches ? 0 : (msOverride ?? DURATION);
      if (Math.abs(delta) < 2) return;
      if (ms === 0) {
        window.scrollTo(0, target);
        return;
      }
      const t0 = performance.now();
      animating = true;
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / ms);
        window.scrollTo(0, startY + delta * ease(p));
        if (p < 1) {
          raf = requestAnimationFrame(step);
        } else {
          animating = false;
          raf = 0;
        }
      };
      raf = requestAnimationFrame(step);
    };
    glideRef.current = glideTo;

    const nearestTop = () => {
      const els = screensOf();
      if (!els.length) return window.scrollY;
      const y = window.scrollY;
      let best = els[0];
      let bestGap = Infinity;
      els.forEach((el) => {
        const gap = Math.abs(el.offsetTop - NAV_H - y);
        if (gap < bestGap) {
          bestGap = gap;
          best = el;
        }
      });
      const max = document.documentElement.scrollHeight - window.innerHeight;
      return Math.max(0, Math.min(max, best.offsetTop - NAV_H));
    };

    const scheduleSettle = () => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        if (animating) return;
        glideTo(nearestTop());
      }, SETTLE_DELAY);
    };

    const contentFits = () => {
      const avail = window.innerHeight - NAV_H;
      return screensOf().every((el) => {
        const row = el.firstElementChild;
        if (!row) return true;
        /* 只统计参与布局的子元素：绝对定位的装饰层（如背景圆环）不算内容高度，
           否则它会被误判成"这一屏装不下"，从而把整屏翻页整个关掉。 */
        const kids = Array.from(row.children).filter((k) => {
          const pos = getComputedStyle(k).position;
          return pos !== "absolute" && pos !== "fixed";
        });
        const tallest = kids.length
          ? Math.max(...kids.map((k) => k.getBoundingClientRect().height))
          : row.getBoundingClientRect().height;
        const style = getComputedStyle(row);
        const padding =
          parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        return tallest + padding <= avail + 4;
      });
    };

    const onScroll = () => {
      if (!desktop.matches || animating || !contentFits()) return;
      scheduleSettle();
    };

    const goBy = (dir: 1 | -1) => {
      const els = screensOf();
      if (!els.length) return;
      const base = targetIdx >= 0 ? targetIdx : actualIndex();
      const to = Math.min(els.length - 1, Math.max(0, base + dir));
      if (to === base) return;
      glideTo(posOf(els[to]), animating ? FAST_DURATION : undefined);
    };

    /* 键盘翻页：↑ ↓ / PageUp PageDown / 空格；输入框内不抢键 */
    const onKeyNav = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      const isSpace = event.key === " " || event.key === "Spacebar";
      if (isSpace && (tag === "BUTTON" || tag === "A")) return;
      const down = event.key === "ArrowDown" || event.key === "PageDown" || isSpace;
      const up = event.key === "ArrowUp" || event.key === "PageUp";
      if (!down && !up) return;
      if (!desktop.matches || !contentFits()) return;
      event.preventDefault();
      goBy(down ? 1 : -1);
    };

    const onUserInput = () => {
      targetIdx = -1;
      cancelGlide();
      scheduleSettle();
    };

    window.addEventListener("wheel", onUserInput, { passive: true });
    window.addEventListener("touchstart", onUserInput, { passive: true });
    window.addEventListener("touchmove", onUserInput, { passive: true });
    window.addEventListener("keydown", onKeyNav);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("wheel", onUserInput);
      window.removeEventListener("touchstart", onUserInput);
      window.removeEventListener("touchmove", onUserInput);
      window.removeEventListener("keydown", onKeyNav);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.clearTimeout(settleTimer);
      cancelAnimationFrame(raf);
      glideRef.current = null;
    };
  }, []);

  /* 滚动到哪一屏，导航与页码点就高亮哪一个 */
  useEffect(() => {
    const targets = screens
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!targets.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px", threshold: [0, 0.2, 0.5, 1] },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const goToSection = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const target = Math.max(0, el.offsetTop - 64);
    if (glideRef.current) glideRef.current(target);
    else el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
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
  const toggleTheme = () => {
    const root = document.documentElement;
    root.classList.add("theme-switching");
    window.setTimeout(() => root.classList.remove("theme-switching"), 260);
    setTheme(theme === "dark" ? "light" : "dark");
  };

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
    if (next === "admin") {
      setUsername("adminer");
      setPassword("admin");
      setTab("login");
    } else {
      setUsername("");
      setPassword("");
    }
    goToSection("login");
  };

  const fillDemo = (next: Panel) => {
    if (next === "admin") {
      setUsername("adminer");
      setPassword("admin");
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
      setMessage("登录成功，正在进入系统…");
      setTimeout(() => {
        navigate(
          result.role === "admin" ? "/admin/dashboard" : "/personal/dashboard",
          { replace: true },
        );
      }, 500);
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
      setMessage("注册成功，请使用新账号登录");
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
    <div className="min-h-screen scroll-smooth bg-page text-slate-800">
      {/* ================= 顶部导航 ================= */}
      <header className="sticky top-0 z-40 bg-header px-6 sm:px-10 lg:px-12 xl:px-16">
        <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between gap-4">
          <BrandLogo />
          <nav className="hidden items-center gap-1 lg:flex" aria-label="页面章节">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => goToSection(item.id)}
                className={`relative px-3.5 py-2 text-[15px] transition-colors duration-200 after:absolute after:inset-x-3.5 after:bottom-1 after:h-[2px] after:origin-center after:rounded-full after:bg-primary-600 after:transition-transform after:duration-200 after:ease-out ${
                  active === item.id
                    ? "font-bold text-primary-700 after:scale-x-100"
                    : "font-medium text-slate-500 after:scale-x-0 hover:text-primary-700 hover:after:scale-x-100 active:text-primary-800 active:after:scale-x-100"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => switchPanel(isAdmin ? "user" : "admin")}
              aria-pressed={isAdmin}
              title={isAdmin ? "返回用户登录" : "切换到管理员登录"}
              className={`relative inline-flex items-center gap-1.5 px-2 py-2 text-sm transition-colors duration-200 after:absolute after:inset-x-2 after:bottom-1 after:h-[2px] after:origin-center after:rounded-full after:bg-primary-600 after:transition-transform after:duration-200 after:ease-out ${
                isAdmin
                  ? "font-bold text-primary-700 after:scale-x-100"
                  : "font-medium text-slate-500 after:scale-x-0 hover:text-primary-700 hover:after:scale-x-100 active:text-primary-800 active:after:scale-x-100"
              }`}
            >
              <ShieldCheck className="h-4 w-4" />
              {isAdmin ? "返回用户登录" : "管理员登录"}
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
        className="auth-screen relative flex items-center px-6 py-8 sm:px-10 lg:px-12 xl:px-16 lg:min-h-[calc(100svh-4rem)]"
      >
        <div className="auth-art mx-auto grid w-full max-w-[1440px] items-center gap-12 lg:grid-cols-[minmax(0,620px)_minmax(0,450px)] lg:justify-center lg:gap-[72px] 2xl:grid-cols-[minmax(0,720px)_minmax(0,500px)] 2xl:gap-[96px]">
          <div className="auth-orbit" />
          <div className="auth-orbit scale-[1.35]" />
          <div className="auth-orbit scale-[1.7]" />

          {/* 左：与作品简介屏同一套文字格式（眉标 + 大标题 + 正文 + 要点） */}
          <div className="relative z-10">
            <p className="text-base font-semibold tracking-[0.2em] text-primary-500">
              关注状态 · 看见变化
            </p>
            <h2 className="auth-section-title mt-6 max-w-[720px] text-balance tracking-tight text-slate-900">
              从了解自己开始，照顾好每一天。
            </h2>
            <p className="mt-8 max-w-[600px] text-[18px] leading-9 text-slate-500 sm:text-[20px] sm:leading-[2.1]">
              连接筛查、记录与分析，让每一份关注都能得到回应；
              <br />
              登录后可查看筛查记录、状态趋势与评估报告。
            </p>

            <ul className="mt-6 grid gap-1.5 border-t border-dashed border-slate-200 pt-5">
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
            <div className="mx-auto w-full max-w-[450px] rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_24px_70px_-36px_rgba(16,24,40,0.35)] sm:p-7 2xl:max-w-[500px]">
              <div className="mb-5">
                <p
                  className={`text-xs font-medium tracking-[0.16em] ${
                    isAdmin ? "text-success-600" : "text-primary-500"
                  }`}
                >
                  {isAdmin ? "STAFF ACCESS" : tab === "login" ? "WELCOME BACK" : "CREATE ACCOUNT"}
                </p>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
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
                      className="absolute right-4 top-3.5 text-slate-400 transition-colors hover:text-slate-700"
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
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>密码强度</span>
                        <span className={password ? strength.color : "text-slate-400"}>
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
                  <span className="inline-flex items-center gap-1 text-xs text-slate-400">
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
                className="mt-4 flex w-full items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-500 transition-colors hover:border-primary-200 hover:text-slate-700"
              >
                <span>{isAdmin ? "管理端 · 咨询师" : "演示账号"}</span>
                <code className="font-mono text-slate-800">
                  {isAdmin ? "adminer / admin" : "xiaoyu / 123456"}
                </code>
              </button>

              <p className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4 text-[11px] leading-5 text-slate-400">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                {isAdmin
                  ? "仅限授权人员使用，研判与处置操作均留痕"
                  : "记录仅用于心理健康评估与服务支持，高风险进入人工复核"}
              </p>
            </div>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-5 hidden justify-center lg:flex">
          <button
            type="button"
            onClick={() => goToSection("top")}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/85 px-4 py-2 text-xs text-slate-500 shadow-sm transition-colors hover:border-primary-200 hover:text-primary-600"
          >
            继续了解作品
            <ChevronDown className="h-4 w-4 animate-bounce" />
          </button>
        </div>
      </section>

      {/* ============ 第 2 屏：作品简介 ============ */}
      <section
        id="top"
        className="auth-screen flex items-center px-6 py-16 sm:px-10 lg:px-12 xl:px-16 lg:min-h-[calc(100svh-4rem)] lg:py-20"
      >
        <div className="mx-auto grid w-full max-w-[1440px] items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
          <div>
            <p className="text-base font-semibold tracking-[0.2em] text-primary-500">
              作品概览
            </p>
            <h2 className="auth-section-title mt-6 max-w-[720px] text-balance tracking-tight text-slate-900">
              多模态心理筛查与分级预警系统
            </h2>
            <p className="mt-8 max-w-[640px] text-[18px] leading-9 text-slate-500 sm:text-[20px] sm:leading-[2.1]">
              以
              <strong className="font-medium text-slate-800">动态跨模态哈希检索</strong>
              为核心，融合 RAG、知识图谱与联邦学习，支持文本、语音、图像三模态采集与特征编码，
              输出可追溯的筛查报告，并按四级阈值触发预警与人工复核，形成从状态采集到干预处置的闭环。
            </p>

            <ul className="mt-6 grid gap-1.5 border-t border-dashed border-slate-200 pt-5">
              {[
                "适用于校园、企业等批量筛查场景",
                "量表仅作辅助校准，不作独立判据",
                "高风险个案进入人工研判",
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

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-white px-3 py-1.5 text-xs font-medium text-primary-600">
                <span className="h-1.5 w-1.5 rounded-full bg-primary-500" />
                心理筛查与健康管理平台
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500">
                国家级大创立项 · 2026-06
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500">
                金种子重点课题
              </span>
            </div>
          </div>

          <div className="rounded-[30px] border border-slate-200 bg-white p-7 shadow-[0_26px_64px_-44px_rgba(16,24,40,0.5)] sm:p-9">
            <p className="text-xs font-medium tracking-[0.18em] text-slate-400">评估链路</p>

            <div className="relative mt-6 h-6">
              {["三模态采集", "哈希检索", "RAG 报告", "分级预警"].map((step, index) => (
                <span
                  key={step}
                  className="absolute top-0 whitespace-nowrap text-[13px] font-semibold text-slate-800 sm:text-[14px]"
                  style={{ right: `${(1 - (index + 0.5) / 4) * 100}%` }}
                >
                  {step}
                  {index < 3 && (
                    <span className="ml-2 align-middle text-xs text-slate-300">→</span>
                  )}
                </span>
              ))}
            </div>

            <svg
              viewBox="0 0 900 240"
              preserveAspectRatio="none"
              className="mt-3 aspect-[4.4/1] w-full"
              role="img"
              aria-label="三模态采集、哈希检索、RAG 报告、分级预警四个环节的状态演进示意"
            >
              <defs>
                <linearGradient id="introChartFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary-500)" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="var(--color-primary-500)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0 70H900M0 135H900M0 200H900" className="chart-grid" />
              <g className="chart-guide" strokeWidth="1" strokeDasharray="4 6">
                <line x1="112.5" y1="10" x2="112.5" y2="216" />
                <line x1="337.5" y1="10" x2="337.5" y2="216" />
                <line x1="562.5" y1="10" x2="562.5" y2="216" />
                <line x1="787.5" y1="10" x2="787.5" y2="216" />
              </g>
              <path
                d="M0 172C37.5 172 75 156 112.5 156C150 156 262.5 118 337.5 118C412.5 118 487.5 92 562.5 92C637.5 92 712.5 58 787.5 58C830 58 870 40 900 40V240H0Z"
                fill="url(#introChartFill)"
              />
              <path
                d="M0 172C37.5 172 75 156 112.5 156C150 156 262.5 118 337.5 118C412.5 118 487.5 92 562.5 92C637.5 92 712.5 58 787.5 58C830 58 870 40 900 40"
                fill="none"
                className="stroke-primary-500"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <g className="fill-white stroke-primary-500" strokeWidth="3">
                <circle cx="112.5" cy="156" r="5" />
                <circle cx="337.5" cy="118" r="5" />
                <circle cx="562.5" cy="92" r="5" />
                <circle cx="787.5" cy="58" r="5" />
              </g>
            </svg>

            <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-dashed border-slate-200 pt-5">
              {[
                { value: "3", label: "模态 · 9 类特征" },
                { value: "毫秒级", label: "相似样例检索" },
                { value: "4", label: "级预警阈值" },
              ].map((item) => (
                <span key={item.label} className="flex items-baseline gap-2">
                  <b className="text-[22px] font-extrabold leading-none tabular-nums text-primary-600">
                    {item.value}
                  </b>
                  <span className="text-[13px] text-slate-500">{item.label}</span>
                </span>
              ))}
            </div>

            <div className="mt-6 grid gap-2.5 border-t border-dashed border-slate-200 pt-5 sm:grid-cols-3">
              {[
                { title: "文本记录", note: "认知模式与语言逻辑" },
                { title: "语音采样", note: "语音语调与情绪波动" },
                { title: "图像采集", note: "面部表情与绘画笔迹" },
              ].map((item) => (
                <div key={item.title} className="min-w-0">
                  <p className="text-[13px] font-semibold text-slate-800">{item.title}</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{item.note}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ============ 第 3–6 屏：四个章节 ============ */}
      <Section
        id="tech"
        eyebrow="关键技术与方法"
        title="动态跨模态哈希检索与 RAG 生成"
        desc="针对动态心理数据环境下的概念漂移、哈希映射冲突与二值量化信息损失，系统采用多哈希表增量更新、查询自适应重排序与非对称距离度量，并在在线监督集体矩阵分解框架下引入半监督伪标签、类别敏感稀疏正则化与决策级融合，实现三模态联合检索。报告生成以检索命中的相似样例与心理知识库为依据，大语言模型仅承担语言组织，以降低事实性错误。"
        visual={<TechVisual />}
      />

      <Section
        id="assess"
        eyebrow="评估维度"
        title="三模态线索与多维评估指标"
        desc="文本通道提取认知模式与语言逻辑，音频通道提取语音语调、情绪波动与情感强度，视觉通道提取面部表情、绘画笔迹与情绪外露；在此基础上结合压力水平、睡眠时长、情绪趋势与标准化量表，形成可纵向比较的个体状态画像。量表用于辅助校准，不作为独立判据。"
        visual={<AssessVisual />}
      />

      <Section
        id="alert"
        eyebrow="预警机制"
        title="四级预警与人工复核闭环"
        desc="多模态信号持续偏离个体基线时，系统按四级阈值自动生成预警；达到高风险阈值的个案自动进入人工研判队列，由咨询师确认后转入个案跟踪与处置留痕。算法仅提供提示与风险排序，最终结论由专业人员确认，并可输出转介建议。"
        visual={<AlertVisual />}
      />

      <Section
        id="privacy"
        eyebrow="数据安全"
        title="联邦学习与「数据不出域」"
        desc="心理数据属于敏感个人信息。系统采用联邦学习实现跨机构协同训练：各参与机构在本地完成模型训练，仅上行加密后的模型更新，原始数据不离开本地，在保持模型精度的同时满足隐私合规要求。"
        visual={<PrivacyVisual />}
        footnote="心理筛查预警 · 健康管理平台　|　科学评估 · 隐私保护 · 人工复核"
      />

      {/* 右侧页码点 */}
      <nav
        className="fixed right-4 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-center gap-2.5 lg:flex"
        aria-label="页面进度"
      >
        {screens.map((screen) => (
          <button
            key={screen.id}
            type="button"
            onClick={() => goToSection(screen.id)}
            title={screen.label}
            aria-label={screen.label}
            aria-current={active === screen.id}
            className={`h-2.5 rounded-full transition-all ${
              active === screen.id
                ? "h-6 w-2 bg-primary-500"
                : "w-2 bg-slate-300 hover:bg-slate-400"
            }`}
          />
        ))}
      </nav>
    </div>
  );
}
