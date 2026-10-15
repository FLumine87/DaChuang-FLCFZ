import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { navigateWithTransition } from "../utils/viewTransition";
import { ArrowRight, Check, Moon, Sun } from "lucide-react";
import BrandLogo from "../components/BrandLogo";
import {
  AlertVisual,
  AssessVisual,
  Aurora,
  PrivacyVisual,
  Section,
  TechVisual,
} from "./introSections";
import { navItems, screens } from "./introContent";
import BackToTop from '../components/BackToTop';

type Theme = "light" | "dark";

const THEME_KEY = "psych_theme";

const readStoredTheme = (): Theme =>
  window.localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";

/* 主页：平台简介 + 四个章节（共 5 屏），整屏吸附翻页。
   登录已剥离为独立页面（/login），主页左上角保留一个「登录」入口。 */
export default function LandingPage() {
  const navigate = useNavigate();
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const [active, setActive] = useState("top");
    /* 供观察器读取当前屏（观察器只建一次，不随 active 重建） */
    const activeRef = useRef(active);
  const glideRef = useRef<((target: number) => void) | null>(null);
  /* 滑动指示条：位置由目标按钮测量得出，悬停跟随、离开回到当前屏 */
  const navRef = useRef<HTMLElement>(null);
  /* 顶栏高度不再写死 64：手机上顶栏下面多一条可横滑的章节胶囊条，高度会变。
     跳屏偏移若还按 64 算，移动端点章节会正好被顶栏盖掉标题。 */
  const headerRef = useRef<HTMLElement>(null);
  /* activeBar：当前所在屏的指示条（常驻，切屏时滑过去）
     hoverPill：跟随鼠标的浅色药丸（悬停时出现并滑动，离开隐藏）
     两个元素分工：一个表示"我在哪"，一个表示"我要去哪"，都比单项变色更有动感 */
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false });
  const [pill, setPill] = useState({ left: 0, width: 0, visible: false });


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


  /* 把指示条移到某个导航项下方（宽度取文字宽度，两端各留 10px 呼吸感） */
  const moveIndicator = (target: HTMLElement | null) => {
    const nav = navRef.current;
    if (!nav || !target) return;
    const navBox = nav.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    setIndicator({
      left: box.left - navBox.left + 20,
      width: Math.max(0, box.width - 40),
      ready: true,
    });
  };

  /* 鼠标移到某一项：药丸滑过去（比只变文字色更有"跟手"的动感） */
  const hoverNav = (target: HTMLElement | null) => {
    const nav = navRef.current;
    if (!nav || !target) return;
    const navBox = nav.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    setPill({ left: box.left - navBox.left, width: box.width, visible: true });
  };

  /* 鼠标移出导航：指示条回到当前所在屏 */
  const resetIndicator = () => {
    const nav = navRef.current;
    setPill((prev) => ({ ...prev, visible: false }));
    if (!nav) return;
    const current = nav.querySelector<HTMLElement>(`button[data-nav="${active}"]`);
    moveIndicator(current ?? null);
  };

  /* 整屏吸附翻页 */
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("auth-snap");
    return () => root.classList.remove("auth-snap");
  }, []);

  /* 当前屏变化 / 窗口尺寸变化时，指示条跟随到对应导航项 */
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const sync = () => {
      const current = nav.querySelector<HTMLElement>(`button[data-nav="${active}"]`);
      if (current) moveIndicator(current);
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [active]);

  /* 换页滑动：不拦截滚轮，手势走原生滚动，停下后用自定义缓动落到整屏 */
  useEffect(() => {
    const NAV_H = 64;
    const DURATION = 550;
    const SETTLE_DELAY = 180;
    const FAST_DURATION = 320;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const desktop = window.matchMedia("(min-width: 1024px) and (min-height: 600px)");

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

    const nearestTop = (from?: number) => {
      const els = screensOf();
      if (!els.length) return window.scrollY;
      const y = from ?? window.scrollY;
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

    /* 滚轮/触摸手势的落点判断。
       原实现用 nearestTop()——"离哪屏近就落哪屏"，需要滚过半屏才会翻页，
       于是常规一次滚动（4 格 ≈ 480px）会原地回弹，观感就是"上下滑动没反应"。
       改为方向优先：本次手势累计滚过 28% 屏高就翻一屏，否则回到起点那一屏。 */
    const SCROLL_TRIGGER = 0.28;
    let gestureStartY = -1;

    const topOf = (el: HTMLElement) =>
      Math.max(
        0,
        Math.min(
          document.documentElement.scrollHeight - window.innerHeight,
          el.offsetTop - NAV_H,
        ),
      );

    /* 从 from 位置按方向取相邻一屏 */
    const stepFrom = (from: number, dir: number) => {
      const tops = screensOf().map(topOf);
      if (dir > 0) return tops.find((t) => t > from + 4) ?? tops[tops.length - 1];
      const back = tops.filter((t) => t < from - 4);
      return back.length ? back[back.length - 1] : tops[0];
    };

    const settleTarget = () => {
      if (gestureStartY < 0) return nearestTop();
      const delta = window.scrollY - gestureStartY;
      const avail = window.innerHeight - NAV_H;
      if (Math.abs(delta) > avail * SCROLL_TRIGGER) {
        return stepFrom(gestureStartY, delta > 0 ? 1 : -1);
      }
      return nearestTop(gestureStartY);
    };

    const scheduleSettle = () => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        /* 双保险：即便有别的路径调进来，非桌面也一律不平移 */
        if (animating || !desktop.matches || !contentFits()) return;
        const target = settleTarget();
        gestureStartY = -1;
        glideTo(target);
      }, SETTLE_DELAY);
    };

    /* 取"参与布局的那一层"：加入极光背景后，每屏的第一个子元素是绝对定位的
       背景层（Aurora），若仍用 firstElementChild 会量到背景层（高度恒等于整屏），
       兜底判断会永远为真、形同失效。这里改成取第一个非绝对定位的子元素。 */
    const contentRow = (el: HTMLElement) =>
      Array.from(el.children).find((child) => {
        const pos = getComputedStyle(child).position;
        return pos !== "absolute" && pos !== "fixed";
      }) as HTMLElement | undefined;

    const contentFits = () => {
      const avail = window.innerHeight - NAV_H;
      return screensOf().every((el) => {
        const row = contentRow(el);
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
      /* ★ 手机上必须是**普通滚动**，不进这套"落屏"。
         用户反馈："这两个界面的上下滑动逻辑应该是一样的，统一为登录界面的
         上下滑动逻辑……我在主页端都看不了下面的信息。"
         根因就是这里原先没有 desktop 判断：touchstart / touchmove 直接
         scheduleSettle()，而 settleTarget 的规则是"本次手势没滚过 28% 屏高
         就回到起点那一屏" —— 手机上一次短滑就当场被弹回原处，
         表现就是"滑下去又跳回顶部、看不到下面的内容"（录屏逐帧可见：
         下滑 → 回标题 → 再下滑 → 再回标题）。
         桌面端（≥1024 且 ≥600 高）保留原来的整屏落屏，观感不变。
         这也是本次第二次修同一个现象 —— 上一轮只去掉了 CSS 的 scroll-snap，
         而真正接管手势的是这段 JS。 */
      if (!desktop.matches || !contentFits()) return;
      /* 记下手势起点：落点按“滚过 28% 就翻页”判断（见 settleTarget） */
      if (gestureStartY < 0) gestureStartY = window.scrollY;
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

  /* 进入视口的入场动画：所在屏加/去 .is-inview（离开后再回来会重播）。
     依赖刻意留空：观察器只建一次。否则每次切屏都会 disconnect + 重建，
     连带把 html.reveal-ready 摘掉又加回，造成入场动画被截断。 */
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>(".auth-screen"));
    if (!targets.length) return;

    /* 入场编排**每个会话只播一次**。
       原先每次挂载都会 add("reveal-ready")，于是"登录页 ↔ 落地页"来回切时，
       整套编排每次重放：实测返回落地页后仍有 120 个动画在跑
       （分屏标题各 900ms），用户反馈"重复切换界面时出现卡卡的感觉"。
       首屏的第一印象要保住，所以第一次照旧播；之后直接进终态。 */
    const REVEAL_KEY = "psych_landing_revealed";
    const skipReveal = (() => {
      try {
        return sessionStorage.getItem(REVEAL_KEY) === "1";
      } catch {
        return false; /* 隐私模式不可写时按"首次"处理，不影响正确性 */
      }
    })();

    const mark = (el: HTMLElement, inView: boolean) => {
      el.classList.toggle("is-inview", inView);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const el = entry.target as HTMLElement;
          if (entry.isIntersecting) mark(el, true);
          else if (el.id !== activeRef.current) mark(el, false);
        });
      },
      { rootMargin: "-10% 0px -10% 0px", threshold: 0 },
    );
    targets.forEach((el) => observer.observe(el));

    /* 三重保险，避免"入场动画把内容藏住"：
       1) 隐藏态只在 html.reveal-ready 下生效，观察器就绪前内容照常可见；
       2) 观察器以很宽松的条件判定（任何相交即视为进入）；
       3) 当前屏（active）每次都强制标记，不依赖相交回调的时机。
       本会话已经播过一次时干脆不加 reveal-ready —— 没有隐藏态就没有动画，
       内容直接可见，来回切页不再重放。 */
    if (!skipReveal) {
      document.documentElement.classList.add("reveal-ready");
      try {
        sessionStorage.setItem(REVEAL_KEY, "1");
      } catch {
        /* 忽略：不可写就退化成"每次都播"，与改动前一致 */
      }
    }

    return () => {
      observer.disconnect();
      document.documentElement.classList.remove("reveal-ready");
    };
  }, []);

  /* 当前屏确保已标记为可见（切屏时立即生效，不等相交回调） */
  useEffect(() => {
    activeRef.current = active;
    const el = document.getElementById(active);
    if (el) el.classList.add("is-inview");
  }, [active]);

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
    const target = Math.max(0, el.offsetTop - (headerRef.current?.offsetHeight ?? 64));
    if (glideRef.current) glideRef.current(target);
    else el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  };

  const toggleTheme = () => {
    const root = document.documentElement;
    root.classList.add("theme-switching");
    window.setTimeout(() => root.classList.remove("theme-switching"), 260);
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <div className="page-enter min-h-screen scroll-smooth bg-page text-slate-800">
      <BackToTop />
      {/* ================= 顶部导航 ================= */}
      <header ref={headerRef} className="nav-blur sticky top-0 z-40 px-6 sm:px-10 lg:px-12 xl:px-16">
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
            <span className="whitespace-nowrap text-[15px] font-medium text-slate-700">{"主页"}</span>
          </div>

          {/* 导航：对齐腾讯云的做法——14px、字重恒为 500（激活不加粗）、近黑文字，
              高亮靠一条会滑动的指示条 + 变色，避免粗细跳变造成的"生硬"。 */}
          <nav
            ref={navRef}
            className="relative hidden items-center lg:flex"
            aria-label="页面章节"
            onMouseLeave={resetIndicator}
          >
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                data-nav={item.id}
                onClick={() => goToSection(item.id)}
                onMouseEnter={(event) => {
                  hoverNav(event.currentTarget);
                  moveIndicator(event.currentTarget);
                }}
                onFocus={(event) => {
                  hoverNav(event.currentTarget);
                  moveIndicator(event.currentTarget);
                }}
                className={`relative px-5 py-4 text-[16px] font-medium leading-none transition-all duration-200 active:scale-[0.96] ${
                  active === item.id ? "text-primary-600" : "text-slate-800 hover:text-primary-600"
                }`}
              >
                {item.label}
              </button>
            ))}
            {/* 悬停药丸：跟随鼠标滑动（浅色底块，进出有淡入淡出） */}
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute inset-y-2.5 -z-10 rounded-lg bg-primary-50 transition-all duration-200 ease-out ${
                pill.visible ? "opacity-100" : "opacity-0"
              }`}
              style={{ transform: `translateX(${pill.left}px)`, width: pill.width }}
            />
            {/* 当前屏指示条：切屏时滑过去，带一点缓动，避免"硬跳" */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 h-[3px] rounded-full bg-primary-600 shadow-[0_0_10px_rgba(70,95,255,0.45)] opacity-0 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                transform: `translateX(${indicator.left}px)`,
                width: indicator.width,
                opacity: indicator.ready ? 1 : 0,
              }}
            />
          </nav>

          <div className="flex items-center gap-2">
            {/* 登录入口：用户端与管理员端合并为这一个按钮，
                进登录页后再切换身份（登录页顶栏有「管理员登录」切换）。 */}
            {/* 登录入口：与登录页的「← 返回主页」同一套纯文字样式（原来那个浅蓝胶囊偏重） */}
            <button
              type="button"
              onClick={() => navigateWithTransition(navigate, "/login")}
              aria-label="登录"
              className="group mr-1 inline-flex items-center gap-1.5 px-2.5 py-2 text-sm font-medium text-slate-500 transition-colors duration-200 hover:text-primary-600"
            >
              <span className="whitespace-nowrap">登录</span>
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
            <button
              type="button"
              className="group grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition-all duration-200 hover:bg-white/80 hover:text-primary-700 active:scale-90 active:bg-white"
              aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
              title={theme === "dark" ? "浅色模式" : "深色模式"}
              onClick={toggleTheme}
            >
              {/* 切换时图标旋转 180°，给一点"换挡"的动感 */}
              <span className="transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:rotate-[120deg] group-active:rotate-180">
                {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </span>
            </button>
          </div>
        </div>

        {/* 移动端章节导航：顶栏在 lg 以下放不下 5 个章节（原来整条 nav 直接 hidden），
            手机上就完全没法跳屏 —— 只能一路滑到底。这里补一条胶囊条，常驻顶栏内吸顶。
            lg 以上隐藏，桌面端仍用原来的滑动指示条。

            曾经是 overflow-x-auto 横滑、胶囊 shrink-0 固定宽度：5 个 × 13px 字号
            在 390px 下需要约 364px，而可用宽度只有 342px（视口减去 px-6 两侧），
            于是两端被裁掉 —— 用户看到的是"简介"（少了"平台"）和"隐…"，
            反馈"跳转栏无法展示完全"。
            现在改成**五等分铺满**：flex-1 + min-w-0 + 居中，任何宽度都完整可见，
            不再需要横滑，也就没有"拖一下回弹"的横滑手感。
            字号收到 12px、内边距收到 px-1，保证 360px 窄屏下 4 个汉字也放得下。 */}
        <nav
          className="nav-chips mx-auto -mb-px flex w-full max-w-[1440px] gap-1 pb-2.5 lg:hidden"
          aria-label="页面章节"
        >
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => goToSection(item.id)}
              aria-current={active === item.id ? "true" : undefined}
              className={`min-w-0 flex-1 truncate rounded-full px-1 py-1.5 text-center text-[12px] font-medium transition-colors duration-200 active:scale-[0.96] ${
                active === item.id
                  ? "bg-primary-600 text-white"
                  : "bg-white/70 text-slate-600"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      {/* ============ 第 2 屏：平台简介 ============ */}
      <section
        id="top"
        className="auth-screen relative flex items-center overflow-hidden px-6 py-16 sm:px-10 lg:px-12 xl:px-16 lg:min-h-[calc(100svh-4rem)] lg:py-12"
      >
        <Aurora />
        <div className="relative z-10 mx-auto grid w-full max-w-[1440px] items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
          <div data-reveal>
            <p className="text-base font-semibold tracking-[0.2em] text-primary-500">
              平台概览
            </p>
            <h2 className="auth-section-title mt-6 max-w-[720px] text-balance tracking-tight text-slate-900">
              多模态心理筛查与<span className="whitespace-nowrap">分级预警系统</span>
            </h2>
            {/* 首屏讲"这个产品能做什么"，技术路线留给「核心技术」屏。
                依据申报书「使用说明」：用户经三模态采集 → 自动生成预警报告 →
                管理端完成预警处置与个案跟踪。 */}
            <p className="mt-8 max-w-[640px] text-[18px] leading-9 text-slate-600 sm:text-[20px] sm:leading-[2.1]">
              面向校园、企业、社区的
                <strong className="font-medium text-slate-800">心理筛查预警平台</strong>
              。用户完成一次文本、语音、图像的三模态采集，系统即以
                <strong className="font-medium text-slate-800">动态跨模态哈希检索</strong>
              匹配相似案例，再由
                <strong className="font-medium text-slate-800">RAG</strong>
              结合心理知识库生成可追溯的筛查报告；管理端据此完成分级预警与个案跟踪。
            </p>

            {/* 特性列表 + 首屏「立即体验」：与右上角「登录」同一个入口（进登录页后再切换身份）。
                按钮放在列表右侧的空白处并底对齐，不给首屏多添一行高度。 */}
            <div className="mt-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-t border-dashed border-slate-200 pt-4">
              <ul className="grid gap-1">
                {[
                  "动态跨模态哈希检索：毫秒级匹配相似案例",
                  "RAG 报告生成：以检索样例与心理知识库为依据",
                  "三模态互补：文本、语音、图像同时进入评估",
                  "处置闭环：高风险自动进入人工复核并留痕",
                ].map((point) => (
                  <li
                    key={point}
                    className="flex items-start gap-2 text-[14px] leading-5 text-slate-600"
                  >
                    <Check className="h-4 w-4 shrink-0 text-success-600" />
                    {point}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => navigateWithTransition(navigate, "/login")}
                className="group inline-flex shrink-0 items-center gap-2 rounded-full bg-primary-600 px-6 py-3 text-[15px] font-medium text-white shadow-[0_16px_34px_-18px_rgba(70,95,255,0.9)] transition-all duration-200 hover:bg-primary-700 active:scale-[0.97]"
              >
                <span className="whitespace-nowrap">立即体验</span>
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[13px] text-slate-500">
                国家级大创立项 · 2026-06
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[13px] text-slate-500">
                金种子重点课题
              </span>
            </div>
          </div>

          {/* 外层 data-reveal 负责"框"本身的渐入，内层才是内容：
              否则框会瞬间出现、内容再逐条浮现，看着像"空盒子先落地"。 */}
          <div data-reveal data-visual>
            <div className="rounded-[30px] border border-slate-200 bg-white p-7 shadow-[0_26px_64px_-44px_rgba(16,24,40,0.5)] sm:p-9">
            <p className="text-[13px] font-medium tracking-[0.18em] text-slate-500">评估链路</p>

            {/* 四步链路：每格居中，正好落在下方图表的里程碑与纵向网格线上。
                原来是绝对定位 + 右对齐，每个标签"右端贴线、左端参差"，看着就是没对齐。
                箭头不能跟着标签走：整格是居中的，箭头贴在文字右边就落在格子中间偏左，
                和下一格之间空出一大块（用户反馈"箭头太靠左"）。
                桌面改为绝对定位到**格子右边界**（= 两标签之间的空隙正中，
                也就是下方 25%/50%/75% 三条网格线的位置）。
                窄屏是两列，只有同一行内的相邻两步（0→1、2→3）才画内联箭头，
                否则 1→2 的箭头会指向下一行的左后方，属于误导。 */}
            <div className="mt-6 grid grid-cols-2 gap-y-2 sm:grid-cols-4">
              {["三模态采集", "哈希检索", "RAG 报告", "分级预警"].map((step, index) => (
                <span
                  key={step}
                  className="relative flex items-center justify-center whitespace-nowrap text-[14px] font-semibold text-slate-800 sm:text-[15px]"
                >
                  {step}
                  {index < 3 && (
                    <>
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute right-0 top-1/2 hidden -translate-y-1/2 translate-x-1/2 text-[13px] text-slate-300 sm:block"
                      >
                        →
                      </span>
                      {index % 2 === 0 && (
                        <span aria-hidden="true" className="ml-1.5 text-[13px] text-slate-300 sm:hidden">
                          →
                        </span>
                      )}
                    </>
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

            {/* 一句话说清这张图在表达什么。
                上一版写成了"横轴为上面四个环节，纵轴为累计可用的判断依据……"，
                在落地页上讲坐标轴太像规格说明书了（用户："太奇怪了，还是换掉吧"），
                这里改成人话；末尾原本还挂了个"（示意图）"，用户要求删掉，
                并且这句说明靠右排（text-right），与左侧的正文错开。 */}
            <p className="mt-3 text-right text-[13px] leading-5 text-slate-500">
              每走完一个环节，能用来判断的信息就多一层。
            </p>

            <div className="mt-6 grid gap-2.5 border-t border-dashed border-slate-200 pt-5 sm:grid-cols-3">
              {[
                { value: "3", label: "模态 · 9 类特征" },
                { value: "毫秒级", label: "相似样例检索" },
                { value: "4", label: "级预警阈值" },
              ].map((item) => (
                <span key={item.label} className="flex items-baseline gap-2">
                  <b className="text-[22px] font-medium leading-none tabular-nums text-primary-600">
                    {item.value}
                  </b>
                  <span className="text-[14px] text-slate-500">{item.label}</span>
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
                  <p className="text-[15px] font-semibold text-slate-800">{item.title}</p>
                  <p className="mt-1 text-[13px] leading-5 text-slate-500">{item.note}</p>
                </div>
              ))}
            </div>
          </div>
          </div>
        </div>
      </section>

      {/* ============ 第 2–5 屏：四个章节 ============ */}
      <Section
        id="tech"
        eyebrow="关键技术与方法"
        title={<>动态跨模态哈希<span className="whitespace-nowrap">检索</span>与 RAG 生成</>}
        desc="针对动态心理数据环境下的概念漂移与哈希映射冲突，系统采用多哈希表增量更新、查询自适应重排序、非对称距离度量与 Hadamard 矩阵，并在在线监督集体矩阵分解（OSCMFH）框架下引入半监督伪标签与决策级融合，实现图像、语音、文本的跨模态联合检索；报告由 RAG 以检索命中样例与心理知识库为依据生成，语言模型仅承担语言组织，以降低事实性错误。"
        points={[
          "基于多哈希表系统的增量式模态哈希",
          "动态跨模态哈希检索优化：应对模态异构与类别不均衡",
          "RAG 赋能大模型：输出有参考依据的结构化筛查报告",
          "知识图谱：提升结果可解释性与报告关联性",
        ]}
        visual={<TechVisual />}
      />

      <Section
        id="assess"
        eyebrow="评估维度"
        title={<>三模态线索与多维<span className="whitespace-nowrap">评估</span>指标</>}
        desc="相比依赖人工访谈与单一量表的传统筛查，系统在同一时间轴上融合三条通道的线索，形成可纵向比较的个体状态画像；量表结果仅用于辅助校准，不作为独立判据。"
        points={[
          "文本通道：认知模式与语言逻辑",
          "音频通道：语音语调、情绪波动与情感强度",
          "视觉通道：面部表情、绘画笔迹与情绪外露",
          "标准化量表：PHQ-9 / GAD-7 / ISI / PSS-10 辅助校准",
        ]}
        visual={<AssessVisual />}
      />

      <Section
        id="alert"
        eyebrow="预警机制"
        title={<>四级预警与人工<span className="whitespace-nowrap">复核闭环</span></>}
        desc="多模态信号持续偏离个体基线时，系统按四级阈值自动生成预警；达到高风险阈值的个案自动进入人工研判队列，由咨询师确认后转入个案跟踪与处置留痕。算法仅提供提示与风险排序，最终结论由专业人员确认，并可输出转介建议。"
        points={[
          "四级阈值：绿 / 黄 / 橙 / 红，按偏离基线程度自动分级",
          "人工研判：高风险个案进入咨询师复核队列",
          "个案跟踪：处置全过程留痕，可回溯",
          "两端协同：Web 端与移动端同步处置进度",
        ]}
        visual={<AlertVisual />}
      />

      <Section
        id="privacy"
        eyebrow="数据安全"
        title={<>联邦学习与「<span className="whitespace-nowrap">数据不出域</span>」</>}
        desc="心理数据属于敏感个人信息。系统采用联邦学习实现跨机构模型协同训练而不直接共享原始敏感数据：各参与机构在本地完成模型训练，仅上行加密后的模型更新，原始数据不离开本地，在保持模型精度的同时满足隐私合规要求。"
        points={[
          "数据不出域：原始敏感数据不离开机构本地",
          "加密上行：仅传输加密后的模型更新",
          "协同形式：覆盖横向、纵向与联邦迁移",
          "依据可溯：报告结论关联检索样例与知识库",
        ]}
        visual={<PrivacyVisual />}
        footnote="心理筛查预警 · 健康管理平台　|　科学评估 · 隐私保护 · 人工复核"
      />

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
