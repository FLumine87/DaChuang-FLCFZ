import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Lock,
  ClipboardCheck,
  BrainCircuit,
  AudioLines,
  UserPlus,
  Loader2,
  Eye,
  EyeOff,
} from "lucide-react";
import BrandLogo from "../components/BrandLogo";
import { apiLogin, apiRegister } from "../services/mockApi";
import { saveSessionToken, saveDisplayName } from "../auth/session";

type AuthTab = "login" | "register";

export default function AuthPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<AuthTab>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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

  const resetTips = () => {
    setMessage("");
    setError("");
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
      // 后端登录返回的显示名（users.name）不在 JWT 里，单独存一份给档案页用
      saveDisplayName(result.name);
      setMessage("登录成功，正在跳转...");
      // 后端返回的role可能是'admin'或'counselor'，前端统一处理
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
      setMessage("注册成功，请使用新账号登录（新账号默认进入个人端）");
      setTab("login");
      setPassword("");
      setConfirmPassword("");
      setName("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-2">
      <div className="flex min-h-screen flex-col px-6 py-7 sm:px-12 xl:px-20">
        <BrandLogo />
        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-12">
          <span className="mb-3 text-xs font-medium tracking-widest text-primary-500">
            欢迎来到心理健康空间
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            {tab === "login" ? "登录账号" : "创建账号"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            {tab === "login"
              ? "输入你的账号信息，开启今天的健康管理。"
              : "建立个人健康档案，开始更好地了解自己。"}
          </p>
          <div
            className="my-7 flex rounded-lg bg-slate-100 p-1"
            role="tablist"
            aria-label="登录或注册"
          >
            {(["login", "register"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => {
                  setTab(value);
                  resetTips();
                }}
                className={`flex-1 rounded-md py-2.5 text-sm font-medium transition-colors ${tab === value ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}
              >
                {value === "login" ? "登录" : "注册"}
              </button>
            ))}
          </div>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!loading)
                void (tab === "login" ? handleLogin() : handleRegister());
            }}
          >
            <div>
              <label
                htmlFor="username"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
                用户名 <span className="text-danger-500">*</span>
              </label>
              <input
                id="username"
                autoComplete="username"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="请输入用户名"
                className="h-12 w-full rounded-lg border border-slate-300 px-4 text-sm"
              />
            </div>
            {tab === "register" && (
              <div>
                <label
                  htmlFor="name"
                  className="mb-2 block text-sm font-medium text-slate-700"
                >
                  姓名 <span className="text-danger-500">*</span>
                </label>
                <input
                  id="name"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="请输入姓名"
                  className="h-12 w-full rounded-lg border border-slate-300 px-4 text-sm"
                />
              </div>
            )}
            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
                密码 <span className="text-danger-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={
                    tab === "login" ? "current-password" : "new-password"
                  }
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="请输入密码"
                  className="h-12 w-full rounded-lg border border-slate-300 px-4 pr-12 text-sm"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-4 text-slate-400 hover:text-slate-700"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            {tab === "register" && (
              <>
                <div>
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>密码强度</span>
                    <span
                      className={password ? strength.color : "text-slate-400"}
                    >
                      {password ? strength.label : "未输入"}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all ${!password ? "w-0" : strength.score === 1 ? "w-1/3 bg-danger-500" : strength.score === 2 ? "w-2/3 bg-warning-500" : "w-full bg-success-500"}`}
                    />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-400">
                    建议使用 8 位以上，包含大小写字母、数字和特殊符号。
                  </p>
                </div>
                <div>
                  <label
                    htmlFor="confirm-password"
                    className="mb-2 block text-sm font-medium text-slate-700"
                  >
                    确认密码 <span className="text-danger-500">*</span>
                  </label>
                  <input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="请再次输入密码"
                    className="h-12 w-full rounded-lg border border-slate-300 px-4 text-sm"
                  />
                </div>
              </>
            )}
            {tab === "login" && (
              <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                记住我，下次自动登录
              </label>
            )}
            {error && (
              <p
                role="alert"
                className="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-600"
              >
                {error}
              </p>
            )}
            {message && (
              <p
                role="status"
                className="rounded-lg bg-success-50 px-4 py-3 text-sm text-success-600"
              >
                {message}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="ui-button ui-button-primary h-12 w-full disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : tab === "login" ? (
                <Lock className="h-4 w-4" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              {loading ? "处理中…" : tab === "login" ? "登录" : "创建个人账号"}
            </button>
          </form>
          <p className="mt-6 text-center text-xs leading-6 text-slate-400">
            登录后将根据账号身份进入管理端或个人端。
          </p>
        </div>
        <p className="text-xs text-slate-400">
          心理筛查与健康管理 · 让关怀持续发生
        </p>
      </div>
      <div className="auth-art hidden min-h-screen items-center justify-center p-12 lg:flex">
        <div className="auth-orbit" />
        <div className="auth-orbit scale-[1.35]" />
        <div className="auth-orbit scale-[1.7]" />
        <div className="relative z-10 w-full max-w-[390px]">
          <div className="mb-9 flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary-100 bg-white/80 px-4 py-2 text-xs font-medium text-primary-500">
              <span className="h-1.5 w-1.5 rounded-full bg-primary-500" />
              关注状态 · 看见变化
            </span>
          </div>
          <div className="rounded-2xl border border-white bg-white/90 p-7 shadow-[0_16px_48px_-16px_#465fff26]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">每一次记录，都有意义</p>
                <p className="mt-2 text-lg font-semibold text-slate-800">
                  让健康管理更有温度
                </p>
              </div>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-500">
                <BrainCircuit className="h-5 w-5" />
              </span>
            </div>
            <svg
              viewBox="0 0 320 135"
              className="my-6 w-full"
              aria-hidden="true"
            >
              <defs>
                <linearGradient
                  id="auth-chart-fill"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor="#465fff" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#465fff" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0 30 H320 M0 70 H320 M0 110 H320" stroke="#f2f4f7" />
              <path
                d="M0 105 C25 105 25 60 55 70 S95 95 125 62 S165 90 195 48 S235 65 265 35 S295 40 320 15 L320 135 L0 135Z"
                fill="url(#auth-chart-fill)"
              />
              <path
                d="M0 105 C25 105 25 60 55 70 S95 95 125 62 S165 90 195 48 S235 65 265 35 S295 40 320 15"
                fill="none"
                stroke="#465fff"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            <div className="grid grid-cols-3 gap-3 border-t border-slate-100 pt-5 text-center">
              {[
                { icon: ClipboardCheck, text: "科学筛查" },
                { icon: AudioLines, text: "多模态记录" },
                { icon: BrainCircuit, text: "智能分析" },
              ].map((item) => (
                <div key={item.text}>
                  <item.icon className="mx-auto mb-2 h-5 w-5 text-primary-400" />
                  <span className="text-xs text-slate-500">{item.text}</span>
                </div>
              ))}
            </div>
          </div>
          <h2 className="mt-10 text-center text-2xl font-semibold tracking-tight text-slate-800">
            从了解自己开始，
            <br />
            <span className="leading-[1.8]">照顾好每一天。</span>
          </h2>
          <p className="mx-auto mt-3 max-w-xs text-center text-sm leading-7 text-slate-500">
            连接筛查、记录与分析，
            <br />
            让每一份关注，都能得到回应。
          </p>
        </div>
      </div>
    </div>
  );
}
