import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Bell,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Database,
  Ellipsis,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { getCurrentSession, logout } from "../auth/session";
import BrandLogo from "./BrandLogo";

interface NavigationItem {
  path: string;
  label: string;
  description: string;
  icon: LucideIcon;
  group: string;
}

const mobileQuery = "(max-width: 1023px)";
const subscribeToViewport = (callback: () => void) => {
  const media = window.matchMedia(mobileQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
};
const getMobileSnapshot = () => window.matchMedia(mobileQuery).matches;

export default function AppShell({ mode }: { mode: "admin" | "personal" }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useSyncExternalStore(
    subscribeToViewport,
    getMobileSnapshot,
    () => false,
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const isAdmin = mode === "admin";
  const username =
    getCurrentSession()?.username || (isAdmin ? "管理员" : "个人用户");
  const root = `/${mode}`;
  const items: NavigationItem[] = [
    {
      path: `${root}/dashboard`,
      label: isAdmin ? "数据概览" : "个人首页",
      description: isAdmin
        ? "筛查、预警与处置情况，一目了然。"
        : "关注每一天的状态，记录属于你的积极变化。",
      icon: LayoutDashboard,
      group: "工作空间",
    },
    {
      path: `${root}/screening`,
      label: isAdmin ? "筛查管理" : "心理筛查",
      description: isAdmin
        ? "管理筛查记录，及时了解心理健康状态。"
        : "从一次简单的自我了解开始。",
      icon: ClipboardList,
      group: "工作空间",
    },
    {
      path: `${root}/data-collection`,
      label: "多模态采集",
      description: "通过文字、语音与图像，记录更完整的状态。",
      icon: Database,
      group: "工作空间",
    },
    {
      path: `${root}/retrieval`,
      label: "检索与分析",
      description: "查找相似案例，获取有据可循的分析与建议。",
      icon: Search,
      group: "智能分析",
    },
    ...(isAdmin
      ? [
          {
            path: `${root}/agent-workbench`,
            label: "预警处置工作台",
            description: "汇总筛查证据与规则，辅助人工研判和处置。",
            icon: BrainCircuit,
            group: "智能分析",
          },
        ]
      : []),
    {
      path: `${root}/alerts`,
      label: isAdmin ? "预警管理" : "预警中心",
      description: "查看风险变化，跟进每一条需要关注的提醒。",
      icon: TriangleAlert,
      group: "健康管理",
    },
    {
      path: `${root}/cases`,
      label: isAdmin ? "案例管理" : "我的档案",
      description: isAdmin
        ? "汇集案例资料，持续跟踪干预与恢复进展。"
        : "把筛查、采集和行动记录，整理成你的健康档案。",
      icon: FolderOpen,
      group: "健康管理",
    },
  ];
  const active =
    items.find(
      (item) =>
        location.pathname === item.path ||
        location.pathname.startsWith(`${item.path}/`),
    ) || items[0];
  const isDashboard = location.pathname === `${root}/dashboard`;
  const results = items.filter((item) =>
    `${item.label}${item.description}`.includes(query.trim()),
  );

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    if (!isMobile || !mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobile, mobileOpen]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setProfileOpen(false);
        setMobileOpen(false);
      }
    };
    const handleOutside = (event: PointerEvent) => {
      if (!profileRef.current?.contains(event.target as Node))
        setProfileOpen(false);
      if (!searchContainerRef.current?.contains(event.target as Node))
        setSearchOpen(false);
    };
    window.addEventListener("keydown", handleKey);
    window.addEventListener("pointerdown", handleOutside);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("pointerdown", handleOutside);
    };
  }, []);

  const closeNavigation = () => {
    setMobileOpen(false);
    setSearchOpen(false);
    setQuery("");
    setProfileOpen(false);
  };
  const handleLogout = async () => {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      navigate("/auth", { replace: true });
    }
  };

  return (
    <div
      className="app-shell min-h-screen bg-slate-50"
      data-collapsed={collapsed}
      data-mobile-open={mobileOpen}
    >
      <a
        href="#main-content"
        className="sr-only fixed left-4 top-4 z-[60] rounded-lg bg-primary-500 p-3 text-white focus:not-sr-only"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        跳转到主要内容
      </a>
      {mobileOpen && (
        <button
          className="fixed inset-0 z-30 bg-slate-900/35 backdrop-blur-sm lg:hidden"
          aria-label="关闭导航遮罩"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className="app-sidebar app-scrollbar overflow-y-auto"
        aria-label={isAdmin ? "管理端导航" : "个人端导航"}
        inert={isMobile && !mobileOpen}
      >
        <div className="flex h-24 shrink-0 items-center justify-between px-6">
          <Link
            to={`${root}/dashboard`}
            onClick={closeNavigation}
            aria-label="系统首页"
          >
            <BrandLogo />
          </Link>
          <button
            className="text-slate-400 lg:hidden"
            aria-label="关闭导航"
            onClick={() => setMobileOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="shrink-0 px-5 pb-5">
          {["工作空间", "智能分析", "健康管理"].map((group) => (
            <div className="mb-7" key={group}>
              <div className="mb-3 flex h-5 items-center px-3 text-[11px] font-medium tracking-widest text-slate-400">
                <span className="sidebar-label">{group}</span>
                {collapsed && (
                  <Ellipsis
                    className="hidden h-4 w-4 lg:block"
                    aria-hidden="true"
                  />
                )}
              </div>
              <div className="space-y-1.5">
                {items
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={closeNavigation}
                      className="sidebar-link"
                      aria-current={
                        active.path === item.path ? "page" : undefined
                      }
                      title={item.label}
                    >
                      <item.icon
                        className="h-5 w-5 shrink-0"
                        strokeWidth={1.7}
                      />
                      <span className="sidebar-label flex-1">{item.label}</span>
                      {active.path === item.path && (
                        <ChevronRight className="sidebar-label h-4 w-4" />
                      )}
                    </Link>
                  ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="sidebar-label mx-5 mb-5 mt-auto shrink-0 rounded-2xl bg-slate-50 p-5 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white text-primary-500">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <p className="text-sm font-semibold text-slate-800">
            每一份关注，都有意义
          </p>
          <p className="mt-2 whitespace-normal text-xs leading-5 text-slate-500">
            {isAdmin
              ? "从筛查到跟进，让关怀及时抵达。"
              : "从了解自己开始，照顾好每一天。"}
          </p>
          <Link
            to={`${root}/screening`}
            onClick={closeNavigation}
            className="ui-button ui-button-primary mt-4 w-full text-xs"
          >
            {isAdmin ? "查看筛查记录" : "开始心理筛查"}
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="sidebar-label shrink-0 border-t border-slate-100 px-7 py-4 text-[11px] text-slate-400">
          心理健康 · {isAdmin ? "管理工作空间" : "个人健康空间"}
        </div>
      </aside>
      <div className="app-frame" inert={isMobile && mobileOpen}>
        <header className="sticky top-0 z-20 flex h-[82px] items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 sm:px-7">
          <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-5">
            <button
              className="ui-icon-button hidden lg:flex"
              aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <button
              className="ui-icon-button lg:hidden"
              aria-label="打开导航"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="relative w-full max-w-sm" ref={searchContainerRef}>
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && results[0]) {
                    navigate(results[0].path);
                    closeNavigation();
                  }
                }}
                aria-label="搜索页面"
                aria-expanded={searchOpen}
                aria-controls="page-search-results"
                placeholder="搜索页面…"
                className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm sm:pr-16"
              />
              <kbd className="pointer-events-none absolute right-2.5 top-2.5 hidden rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-400 sm:block">
                ⌘ K
              </kbd>
              {searchOpen && (
                <div
                  id="page-search-results"
                  className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
                >
                  <p className="px-3 py-2 text-xs text-slate-400">快速前往</p>
                  {results.length ? (
                    results.map((item) => (
                      <Link
                        className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-slate-600 hover:bg-primary-50 hover:text-primary-500"
                        key={item.path}
                        to={item.path}
                        onClick={closeNavigation}
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                        <ArrowUpRight className="ml-auto h-3.5 w-3.5" />
                      </Link>
                    ))
                  ) : (
                    <p className="px-3 py-4 text-sm text-slate-500">
                      没有找到相关页面
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            <Link
              to={`${root}/screening`}
              className="ui-icon-button hidden rounded-full sm:flex"
              title="前往心理筛查"
              aria-label="前往心理筛查"
            >
              <CircleHelp className="h-5 w-5" strokeWidth={1.7} />
            </Link>
            <Link
              to={`${root}/alerts`}
              className="ui-icon-button rounded-full"
              title="查看预警"
              aria-label="查看预警"
            >
              <Bell className="h-5 w-5" strokeWidth={1.7} />
            </Link>
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                aria-label="用户菜单"
                aria-expanded={profileOpen}
                className="flex items-center gap-2.5 rounded-lg py-1 sm:pl-1"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-50 text-sm font-semibold text-primary-500">
                  {username.slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden text-left sm:block">
                  <span className="block max-w-28 truncate text-sm font-medium text-slate-700">
                    {username}
                  </span>
                  <span className="block text-[11px] text-slate-400">
                    {isAdmin ? "管理员" : "个人用户"}
                  </span>
                </span>
                <ChevronDown className="hidden h-4 w-4 text-slate-400 sm:block" />
              </button>
              {profileOpen && (
                <div className="absolute right-0 top-full mt-3 w-56 rounded-2xl border border-slate-200 bg-white p-3 shadow-lg">
                  <div className="border-b border-slate-100 px-2 pb-3">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {username}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {isAdmin ? "管理工作空间" : "个人健康空间"}
                    </p>
                  </div>
                  <Link
                    to={`${root}/cases`}
                    onClick={closeNavigation}
                    className="mt-2 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    <UserRound className="h-4 w-4" />
                    {isAdmin ? "案例管理" : "我的档案"}
                  </Link>
                  <button
                    disabled={signingOut}
                    onClick={handleLogout}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <LogOut className="h-4 w-4" />
                    {signingOut ? "正在退出…" : "退出登录"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="app-content" id="main-content" tabIndex={-1}>
          <div className="mb-7 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-800">
                {active.label}
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {active.description}
              </p>
            </div>
            <nav
              aria-label="面包屑"
              className="flex items-center gap-2 pt-1 text-sm"
            >
              {!isDashboard && (
                <>
                  <Link
                    to={`${root}/dashboard`}
                    className="text-slate-500 hover:text-primary-500"
                  >
                    {isAdmin ? "管理首页" : "个人首页"}
                  </Link>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </>
              )}
              <span className="text-slate-800">{active.label}</span>
            </nav>
          </div>
          <div className="page-body">
            <Outlet />
          </div>
          <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-5 text-xs text-slate-400">
            <span>心理筛查与健康管理</span>
            <span>让每一次关怀，都有所回应</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
