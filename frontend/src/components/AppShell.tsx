import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  BrainCircuit,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Database,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Rss,
  Search,
  ShieldCheck,
  Sun,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { getCurrentSession, logout } from "../auth/session";
import Aurora from "./Aurora";
import BrandLogo from "./BrandLogo";
import BackToTop from './BackToTop';

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

type Theme = "light" | "dark";

/** 深色模式偏好存储键；index.html 的首屏脚本读取同一个键以避免闪白。 */
const THEME_KEY = "psych_theme";

/** 默认浅色：只有用户显式切到深色（存入 "dark"）时才用深色，
 *  换浏览器 / 新窗口 / 清过站点数据后一律回到浅色。 */
const readStoredTheme = (): Theme =>
  window.localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";


/* 悬停预取：鼠标移到侧栏项上就把对应页面的 chunk 拉下来。
   不预取的话，点下去才开始下载 —— 那一下就是"卡一下"。
   这里只在悬停/聚焦时发一次，且失败静默（网络不好不该弹错）。 */
const PREFETCH: Record<string, () => Promise<unknown>> = {
  '/me/chat': () => import('../pages/me/ChatPage'),
  '/me/kg': () => import('../pages/me/KgPage'),
  '/me/feed': () => import('../pages/me/FeedPage'),
};
const prefetched = new Set<string>();
function prefetch(path: string) {
  if (prefetched.has(path) || !PREFETCH[path]) return;
  prefetched.add(path);
  void PREFETCH[path]().catch(() => prefetched.delete(path));
}

/* ── 顶栏下拉的锚定定位（portal 渲染） ───────────────────────────────────────
   顶栏 .nav-blur 上有 mask-image（毛玻璃底部渐隐），mask 作用于整个子树，
   留在顶栏里的下拉会被裁得看不见也点不到（2026-10-14 实测）。
   因此下拉统一用 createPortal 挂到 document.body，按触发元素的实时位置定位。
   顶栏是 sticky 的，滚动 / 缩放时触发元素位置会变，这里持续重算，
   下拉 therefore 始终贴在按钮下方。 */
function useAnchorRect(
  open: boolean,
  anchorRef: React.RefObject<HTMLElement | null>,
) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    /* 关闭时不清空 rect：渲染本就受 open 门控，旧位置不会被看到；
       重开时 compute() 会在同一帧内刷新，避免 effect 内直接 setState。 */
    if (!open) return;
    const compute = () => {
      const el = anchorRef.current;
      if (el) setRect(el.getBoundingClientRect());
    };
    compute();
    /* capture: true —— 页面在任何容器里滚动都要能听到 */
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [open, anchorRef]);
  return rect;
}

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
  /* portal 下拉的容器引用：脱离顶栏 DOM 后，"点外面关闭"仍要认得它们 */
  const menuRef = useRef<HTMLDivElement>(null);
  const searchResultsRef = useRef<HTMLDivElement>(null);
  const menuRect = useAnchorRect(profileOpen, profileRef);
  const searchRect = useAnchorRect(searchOpen, searchContainerRef);
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const isDark = theme === "dark";
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
    /* 「智能心理助手」三件套**只属于个人端**：
       它们是"我的"视角（陪伴我 / 我的图谱 / 推给我），路径也只在
       /personal 下注册过路由。之前这三条没做侧栏过滤，管理端也会渲染出来，
       指向 /admin/me/* —— 全是坏链接。
       管理端对应的是另外三件事（AI 辅助研判 / 个案关系图谱 / 干预方案与推送管理），
       属于"研判 + 处置 + 留痕"，等实现后再挂到管理端的「智能研判」分组下。 */
    ...(isAdmin
      ? []
      : [
          {
            path: `${root}/me/chat`,
            label: "AI 陪伴对话",
            description: "随时说说此刻的感受，获得陪伴与回应。",
            icon: MessageCircle,
            group: "智能心理助手",
          },
          {
            path: `${root}/me/kg`,
            label: "我的知识图谱",
            description: "把记录里的线索连成图，看清状态之间的关系。",
            icon: Network,
            group: "智能心理助手",
          },
          {
            path: `${root}/me/feed`,
            label: "个性化推送",
            description: "按你的关注点，推送可执行的调适建议。",
            icon: Rss,
            group: "智能心理助手",
          },
        ]),
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
            path: `${root}/judgement`,
            label: "智能研判台",
            description: "以案为中心：结论、依据、处置与留痕在一页里走完。",
            icon: BrainCircuit,
            group: "智能分析",
          },
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
    /* 管理端的「案例管理」放**工作空间**分组。
       它原先只在右上角下拉里，藏在二级菜单里不好找；用户要求挪回侧栏。
       用户端的「我的档案」留在「健康管理」不动 —— 两者的定位不同：
       管理端是"看所有案例"，用户端是"回看自己的筛查记录"。 */
    ...(isAdmin
      ? [
          {
            path: `${root}/cases`,
            label: "案例管理",
            description: "汇集案例资料，持续跟踪干预与恢复进展。",
            icon: FolderOpen,
            group: "工作空间",
          },
        ]
      : []),
    /* 用户端保留「我的档案」——
       那是筛查记录的入口，首次引导落库后要靠它回看。 */
    ...(isAdmin
      ? []
      : [
          {
            path: `${root}/cases`,
            label: "我的档案",
            description: "把筛查、采集和行动记录，整理成你的健康档案。",
            icon: FolderOpen,
            group: "健康管理",
          },
        ]),
  ];
  const active =
    items.find(
      (item) =>
        location.pathname === item.path ||
        location.pathname.startsWith(`${item.path}/`),
    ) || items[0];
  const isDashboard =
    location.pathname === `${root}/dashboard` ||
    location.pathname === `${root}/dashboard-v2` ||
    /* 首页的另一版（对照用），同样自带 hero */
    location.pathname === `${root}/dashboard-alt`;
  /* 个人端首页自带整块 hero（眉标 + 场景标题 + 一句话），
     外壳这一层如果照旧渲染「个人端 · 工作空间 / 个人首页 / …」，
     页名就会在一屏里出现两遍 —— 这正是评审提过的重复。
     管理端首页没做改造，所以只管个人端。 */
  const hasOwnHero = isDashboard && !isAdmin;
  /* 手机端的返回。
     有站内历史就退一步；直接深链打开（location.key === "default"）时没有可退的
     历史，navigate(-1) 会把用户弹出应用，所以退回该端首页。 */
  const goBack = () => {
    if (location.key && location.key !== "default") navigate(-1);
    else navigate(`${root}/dashboard`);
  };
  const results = items.filter((item) =>
    `${item.label}${item.description}`.includes(query.trim()),
  );

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // 切换 <html> 上的 .dark：index.css 里覆盖的主题变量据此整体翻转
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
      /* 隐私模式下 localStorage 不可写时忽略，本次会话内仍然生效 */
    }
  }, [theme]);

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
      const target = event.target as Node;
      /* 下拉已 portal 到 body，判断"点外面"时要把下拉自身也算作内域 */
      if (
        !profileRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      )
        setProfileOpen(false);
      if (
        !searchContainerRef.current?.contains(target) &&
        !searchResultsRef.current?.contains(target)
      )
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
  const toggleTheme = () => {
    /* 切换的 ~260ms 内加过渡类：整页颜色渐变而非硬切（大面积浅↔深硬切会看着像闪一下） */
    const root = document.documentElement;
    root.classList.add("theme-switching");
    window.setTimeout(() => root.classList.remove("theme-switching"), 260);
    setTheme(isDark ? "light" : "dark");
  };

  return (
    <div
      className="app-shell min-h-screen bg-page text-slate-800"
      data-collapsed={collapsed}
      data-mobile-open={mobileOpen}
    >
      {/* 环境光背景：与主页内容屏同一层极光，固定铺在整个工作台之下。
          侧栏与顶栏都是毛玻璃，光斑会从玻璃后面透出来——这正是登录页/主页
          「同一张背景、模糊度不同」的分层方式。 */}
      <div className="app-ambient">
        <Aurora />
        {/* 与登录页同一层细网格纹理，压在极光之上，往下淡出 */}
        <div className="app-grid" />
      </div>
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
      {/* 只有导航区（.sidebar-nav）滚动：底部说明卡与页脚留在文档流里，
          短窗口下不会再被吸底的页脚盖住。 */}
      <aside
        className="app-sidebar"
        aria-label={isAdmin ? "管理端导航" : "个人端导航"}
        inert={isMobile && !mobileOpen}
      >
        {/* 品牌行高度与顶栏一致（都是 64px）：侧栏与顶栏的底边因此落在同一条
            水平线上，不再出现"侧栏头比顶栏高一截"的错位。 */}
        <div className="flex h-16 shrink-0 items-center justify-between px-5">
          <Link
            to={`${root}/dashboard`}
            onClick={closeNavigation}
            aria-label="系统首页"
          >
            <BrandLogo />
          </Link>
          <button
            className="text-slate-400 lg:hidden"
            aria-label="收起侧栏"
            onClick={() => setMobileOpen(false)}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        </div>
        <nav className="sidebar-nav app-scrollbar px-5 pb-5">
          {["工作空间", "智能分析", "智能心理助手", "健康管理"].map((group) => (
            <div className="sidebar-group mb-7" key={group}>
              <div className="sidebar-group-title mb-3 flex h-5 items-center px-3 text-[12px] font-medium tracking-widest text-slate-400">
                <span className="sidebar-label">{group}</span>
              </div>
              <div className="space-y-1.5">
                {items
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={closeNavigation}
                      onMouseEnter={() => prefetch(item.path.replace(root, ''))}
                      onFocus={() => prefetch(item.path.replace(root, ''))}
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
        {/* 底部说明卡：与卡片同一套圆角与"淡玻璃"底色，
            在毛玻璃侧栏上不再是一块突兀的实心浅灰块。 */}
        <div className="sidebar-label mx-5 mb-5 mt-auto shrink-0 rounded-2xl border border-slate-200/70 bg-white/70 p-5 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
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
        </div>
        <div className="sidebar-footer">
          <span className="sidebar-label">
            心理健康 · {isAdmin ? "管理工作空间" : "个人健康空间"}
          </span>
          {/* 只在收起态出现：展开态收起侧栏交给右缘的悬浮把手，
              页脚因此只剩左侧那句居中的版权文字 */}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
            aria-expanded={!collapsed}
            title={collapsed ? "展开侧栏" : "折叠侧栏"}
            className="sidebar-action sidebar-action-collapse"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-5 w-5" strokeWidth={1.7} />
            ) : (
              <PanelLeftClose className="h-5 w-5" strokeWidth={1.7} />
            )}
          </button>
        </div>
      </aside>
      <button
        type="button"
        className="sidebar-handle"
        aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
        aria-expanded={!collapsed}
        title={collapsed ? "展开侧栏" : "折叠侧栏"}
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? (
          <ChevronRight className="h-[18px] w-[18px]" strokeWidth={1.7} />
        ) : (
          <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={1.7} />
        )}
      </button>
      <div className="app-frame" inert={isMobile && mobileOpen}>
        {/* 顶栏：与登录页/主页同一套做法——不再有自己的底色，只做毛玻璃，
            高度同为 64px。原先的"白底 + 下边框"会横出一条色带，
            与页面底色割裂，正是登录页那版刻意去掉的做法。 */}
        <header className="nav-blur sticky top-0 z-20 flex h-16 items-center gap-3 px-4 sm:px-7">
          <div className="flex shrink-0 items-center gap-3">
            {/* 手机端左上角：首页给「打开导航」，二级页给「返回」。
                这是 Material 的标准做法 —— 二级页的导航图标换成"向上/返回"，
                抽屉从首页进入。用户反馈"手机端点开按钮跳转页面后，感觉没有做
                返回的快捷键，毕竟手机屏幕小"，而实测顶栏左 54px 到右 286px
                之间是一整片空白，本来就放得下。
                两个按钮共用 .ui-icon-button，尺寸/圆角/按下反馈与旁边完全一致，
                符合系统风格；返回用 ArrowLeft（不是 ChevronLeft）—— 前者是
                系统返回键的通用字形。 */}
            {isDashboard ? (
              <button
                className="ui-icon-button lg:hidden"
                aria-label="打开导航"
                aria-expanded={mobileOpen}
                onClick={() => setMobileOpen(!mobileOpen)}
              >
                <Menu className="h-5 w-5" />
              </button>
            ) : (
              <button
                className="ui-icon-button lg:hidden"
                aria-label="返回"
                title="返回"
                onClick={goBack}
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            {/* 品牌 ｜ 当前页名：与登录页/主页顶栏同一做法，让人一眼知道在哪一页。
                whitespace-nowrap 必须加，否则窄屏下 flex 会把中文逐字换行。 */}
            <span className="hidden whitespace-nowrap text-[15px] font-medium text-primary-600 sm:inline">
              {isAdmin ? "管理端" : "个人端"}
            </span>
            <span
              aria-hidden="true"
              className="hidden h-5 w-px bg-slate-300/80 sm:block"
            />
            {/* 顶栏第二段显示**分组名**（工作空间 / 智能分析 / 健康管理…），
                不是页名。页名下面的大标题已经写了，顶栏再说一遍是重复；
                而分组名放在这里，正好承担"我在哪一块"这个定位，
                页头那行眉标因此可以去掉（见下方 hasOwnHero 附近的说明）。 */}
            <span className="hidden whitespace-nowrap text-[15px] font-medium text-slate-700 sm:inline">
              {active.group}
            </span>
          </div>
          <div className="flex min-w-0 flex-1 justify-center px-1">
            <div className="relative w-full max-w-xs" ref={searchContainerRef}>
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
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
                className="h-10 w-full rounded-xl border border-slate-200/80 bg-white/70 pl-10 pr-3 text-sm backdrop-blur transition-colors hover:border-slate-300 sm:pr-16"
              />
              <kbd className="pointer-events-none absolute right-2.5 top-2.5 hidden rounded border border-slate-200/80 bg-white/60 px-1.5 py-0.5 text-[12px] text-slate-400 sm:block">
                ⌘ K
              </kbd>
              {/* 搜索结果下拉：portal 到 body 定位。
                  留在顶栏内会被 .nav-blur 的 mask 渐隐整块裁掉（2026-10-14 实测）。 */}
              {searchOpen &&
                searchRect &&
                createPortal(
                  <div
                    id="page-search-results"
                    ref={searchResultsRef}
                    className="fixed z-[100] overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_24px_70px_-36px_rgba(16,24,40,0.35)]"
                    style={{
                      top: searchRect.bottom + 8,
                      left: searchRect.left,
                      width: searchRect.width,
                    }}
                  >
                    <p className="px-3 py-2 text-xs text-slate-400">快速前往</p>
                    {results.length ? (
                      results.map((item) => (
                        <Link
                          className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-600 hover:bg-primary-50 hover:text-primary-600"
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
                  </div>,
                  document.body,
                )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                aria-label="用户菜单"
                aria-expanded={profileOpen}
                className="flex items-center gap-2.5 rounded-xl py-1 pl-1 pr-1.5 transition-colors duration-200 hover:bg-white/70 sm:pr-2.5"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-50 text-sm font-semibold text-primary-600">
                  {username.slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden text-left sm:block">
                  <span className="block max-w-28 truncate text-sm font-medium text-slate-700">
                    {username}
                  </span>
                  <span className="block text-[12px] text-slate-400">
                    {isAdmin ? "管理员" : "个人用户"}
                  </span>
                </span>
                <ChevronDown className="hidden h-4 w-4 text-slate-400 sm:block" />
              </button>
              {/* 用户菜单（退出登录在这里）：同样 portal 到 body，逃离顶栏 mask */}
              {profileOpen &&
                menuRect &&
                createPortal(
                  <div
                    ref={menuRef}
                    className="fixed z-[100] w-56 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_24px_70px_-36px_rgba(16,24,40,0.35)]"
                    style={{
                      top: menuRect.bottom + 12,
                      left: Math.max(8, menuRect.right - 224),
                    }}
                  >
                    <div className="border-b border-slate-100 px-2 pb-3">
                      <p className="truncate text-sm font-semibold text-slate-800">
                        {username}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {isAdmin ? "管理工作空间" : "个人健康空间"}
                      </p>
                    </div>
                    {/* 管理端的「案例管理」已挪到侧栏「工作空间」分组，
                        这里只保留用户端的「我的档案」。 */}
                    {!isAdmin && (
                      <Link
                        to={`${root}/cases`}
                        onClick={closeNavigation}
                        className="mt-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-600 transition-colors hover:bg-slate-50"
                      >
                        <UserRound className="h-4 w-4" />
                        我的档案
                      </Link>
                    )}
                    <button
                      disabled={signingOut}
                      onClick={handleLogout}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                    >
                      <LogOut className="h-4 w-4" />
                      {signingOut ? "正在退出…" : "退出登录"}
                    </button>
                  </div>,
                  document.body,
                )}
            </div>
            {/* 深浅色切换：与登录页/主页顶栏同一个按钮（无底框、36px 圆角方块、
                图标 hover 旋转），三处顶栏因此完全一致。 */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-pressed={isDark}
              aria-label={isDark ? "切换为浅色模式" : "切换为深色模式"}
              title={isDark ? "切换为浅色模式" : "切换为深色模式"}
              className="group grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 transition-all duration-200 hover:bg-white/80 hover:text-primary-700 active:scale-90 active:bg-white"
            >
              <span className="transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:rotate-[120deg] group-active:rotate-180">
                {isDark ? (
                  <Sun className="h-5 w-5" />
                ) : (
                  <Moon className="h-5 w-5" />
                )}
              </span>
            </button>
          </div>
        </header>
        <main className="app-content" id="main-content" tabIndex={-1}>
          {/* 页面头：与登录页卡片同一套层级——眉标（13px / 字距 .16em / 主色）
              + 标题 + 说明。原先只有 h1 + 说明，看起来是"后台模板"，
              加上眉标后两端页面与登录页的阅读节奏一致了。
              个人端首页自带 hero，这里整块让位（见 hasOwnHero）。 */}
          {!hasOwnHero && (
          <div className="mb-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="app-page-title text-slate-900">
                  {active.label}
                </h1>
                <p className="mt-2.5 max-w-[760px] text-[15px] leading-7 text-slate-600">
                  {active.description}
                </p>
              </div>
              {/* 面包屑只在二级页出现。首页上「个人首页 > 个人首页」是同一句话
                  说两遍，标题区已经有了，这里就不必再重复一遍。 */}
              {!isDashboard && (
                <nav
                  aria-label="面包屑"
                  className="flex items-center gap-2 pt-1 text-sm"
                >
                  <Link
                    to={`${root}/dashboard`}
                    className="text-slate-500 transition-colors hover:text-primary-600"
                  >
                    {isAdmin ? "管理首页" : "个人首页"}
                  </Link>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                  <span className="text-slate-700">{active.label}</span>
                </nav>
              )}
            </div>
          </div>
          )}
          {/* key 跟着路由走：每次换页重放一次 260ms 的淡入上浮，
              与登录页 ↔ 主页的转场是同一段动画（.page-enter）。 */}
          {/* 管理端所有页面 + 个人端首页显示回到顶部（个人端其余页面内容短，不需要） */}
          {(isAdmin || isDashboard) && <BackToTop />}
          <div className="page-body page-enter" key={location.pathname}>
            <Outlet />
          </div>
          
        </main>
      </div>
    </div>
  );
}
