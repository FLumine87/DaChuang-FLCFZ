import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { navigateWithTransition } from "../utils/viewTransition";
import { ArrowRight, Check, Moon, Sun } from "lucide-react";
import BrandLogo from "../components/BrandLogo";
import heroCalmLight from "../assets/hero-calm-light.webp";
import heroCalmDark from "../assets/hero-calm-dark.webp";
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

  /* 桌面端整屏翻页（一次手势只翻一屏，向上保持连续）：
     · 向下——滚轮一进来先给一小段跟手位移，累计到 32px（标准化后）就锁定
       「下一屏」为目标并接管动画；同一手势的惯性只做收尾，不再翻第二屏。
     · 动画——ease-out，从当前位置直接走，不做"从零加速"；时长 360–540ms。
     · 解锁——动画结束且滚轮静默 100ms 后，才允许下一次独立下滑。
     · 向上——不接管，继续原生滚动，停手后按 28% 门槛吸附；下滑动画中
       明确反向超过 10px 就取消动画、交还原生滚动。
     · 布局只在挂载 / resize / 内容尺寸变化时测量，滚动过程只读缓存。 */
  useEffect(() => {
    const NAV_H = 64;
    const DOWN_TRIGGER = 32;      // 标准化后的累计触发量（30–50 可调）
    const DOWN_MIN_FLIP = 8;      // 手势结束时至少走过这么多才翻，避免轻微抖动误触
    const DOWN_STEP_GAIN = 0.32;  // 触发前的跟手位移比例
    const DOWN_STEP_MAX = 16;     // 单次跟手位移上限
    const MAX_EVENT_PX = 60;      // 单次事件最多计 60px：鼠标滚轮一格约 100，触控板一格约 1–10
    const DOWN_MS_MIN = 360;
    const DOWN_MS_MAX = 540;
    const GESTURE_GAP = 140;      // 两段滚轮间隔超过它 → 算新手势
    const UNLOCK_QUIET = 100;     // 动画结束后滚轮静默这么久才解锁下一屏
    const REVERSE_PX = 10;        // 下滑动画中反向超过它 → 交还控制
    const UP_TRIGGER = 0.28;      // 触屏向上停手后的 28% 屏高阈值（滚轮向上已改为就近吸附）
    const END_QUIET = 110;        // 不足 32px 就停手时，用这个间隔做兜底判定
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const desktop = window.matchMedia("(min-width: 1024px) and (min-height: 600px)");

    /* —— 缓存的布局数据：滚动时只读这些，不再反复量 DOM —— */
    let screens: HTMLElement[] = [];
    let tops: number[] = [];
    let maxScroll = 0;
    let viewH = 0;
    let fits = false;

    let raf = 0;
    let animating = false;
    let animFrom = 0;
    let animDelta = 0;
    let animStart = 0;
    let animMs = 0;
    let animTarget = 0;
    let animEndAt = 0;

    /* 一次手势的状态机 */
    let lastWheelAt = 0;
    let gestureActive = false;
    let lastDir: 1 | -1 | 0 = 0;
    let gestureStartY = 0;
    let gestureTarget: number | null = null;
    let accDown = 0;
    let accUp = 0;
    let locked = false;        // 这次手势已经用掉一次翻页
    let endTimer = 0;
    let touchStartY = -1;
    let measureRaf = 0;
    let ro: ResizeObserver | null = null;

    const clampY = (y: number) => Math.max(0, Math.min(maxScroll, y));
    /* ease-out：接管时速度最大、后半程减速，避免"先停住再重新起步" */
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 2.6);

    /* 取"参与布局的那一层"：每屏的第一个子元素是绝对定位的极光背景，
       用它量高度会永远等于整屏，兜底判断形同失效。 */
    const contentRow = (el: HTMLElement) =>
      Array.from(el.children).find((child) => {
        const pos = getComputedStyle(child).position;
        return pos !== "absolute" && pos !== "fixed";
      }) as HTMLElement | undefined;

    const contentFits = (els: HTMLElement[]) => {
      const avail = viewH;
      return els.every((el) => {
        const row = contentRow(el);
        if (!row) return true;
        const kids = Array.from(row.children).filter((k) => {
          const pos = getComputedStyle(k).position;
          return pos !== "absolute" && pos !== "fixed";
        });
        /* 用 offsetHeight 而不是 getBoundingClientRect：
           入场动画的 transform 会改变 rect，但不会改变布局高度，
           用 rect 会在动画中途误判"这一屏装不下"而关掉整屏翻页。 */
        const tallest = kids.length
          ? Math.max(...kids.map((k) => (k as HTMLElement).offsetHeight))
          : row.offsetHeight;
        const style = getComputedStyle(row);
        const padding =
          parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        return tallest + padding <= avail + 4;
      });
    };

    const measure = () => {
      screens = Array.from(document.querySelectorAll<HTMLElement>(".auth-screen"));
      viewH = window.innerHeight - NAV_H;
      maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      tops = screens.map((el) => clampY(el.offsetTop - NAV_H));
      fits = desktop.matches && contentFits(screens);
    };

    const scheduleMeasure = () => {
      if (measureRaf) return;
      measureRaf = requestAnimationFrame(() => {
        measureRaf = 0;
        measure();
      });
    };

    const observeScreens = () => {
      if (typeof ResizeObserver === "undefined") return;
      ro?.disconnect();
      ro = new ResizeObserver(scheduleMeasure);
      screens.forEach((el) => {
        ro!.observe(el);
        const row = contentRow(el);
        if (row) ro!.observe(row);
      });
    };

    const cancelGlide = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (animating) animEndAt = performance.now();
      animating = false;
    };

    const glideToY = (target: number, msOverride?: number) => {
      cancelGlide();
      const from = window.scrollY;
      const to = clampY(target);
      const delta = to - from;
      /* 距离越短，动画越短：从 360ms 起，一屏约 500ms，不拖到 600 */
      const autoMs = Math.min(
        DOWN_MS_MAX,
        Math.max(DOWN_MS_MIN, 300 + Math.abs(delta) * 0.32),
      );
      const ms = reduced.matches ? 0 : (msOverride ?? autoMs);
      animTarget = to;
      if (Math.abs(delta) < 2) {
        animEndAt = performance.now();
        return;
      }
      if (!ms) {
        window.scrollTo(0, to);
        animEndAt = performance.now();
        return;
      }
      animFrom = from;
      animDelta = delta;
      animMs = ms;
      animStart = performance.now();
      animating = true;
      const step = (now: number) => {
        const p = Math.min(1, (now - animStart) / animMs);
        window.scrollTo(0, animFrom + animDelta * easeOut(p));
        if (p < 1) {
          raf = requestAnimationFrame(step);
        } else {
          animating = false;
          raf = 0;
          window.scrollTo(0, animTarget);
          animEndAt = performance.now();
        }
      };
      raf = requestAnimationFrame(step);
    };
    /* 导航/页码点走这里：先解锁，再动画，避免点完还被上一条手势锁住 */
    glideRef.current = (target: number) => {
      locked = false;
      gestureActive = false;
      glideToY(target);
    };

    const nearestIndex = (from: number) => {
      let best = 0;
      let bestGap = Infinity;
      tops.forEach((t, i) => {
        const gap = Math.abs(t - from);
        if (gap < bestGap) {
          bestGap = gap;
          best = i;
        }
      });
      return best;
    };

    const stepIndex = (from: number, dir: number) => {
      if (dir > 0) {
        for (let i = 0; i < tops.length; i++) if (tops[i] > from + 4) return i;
        return Math.max(0, tops.length - 1);
      }
      for (let i = tops.length - 1; i >= 0; i--) if (tops[i] < from - 4) return i;
      return 0;
    };

    const nextTop = (from: number) => {
      for (const t of tops) if (t > from + 4) return t;
      return null;
    };

    /* 新手势：记录起点与"本次最远只到下一屏"的目标 */
    const resetGesture = () => {
      gestureActive = true;
      lastDir = 1;
      gestureStartY = window.scrollY;
      gestureTarget = nextTop(gestureStartY);
      accDown = 0;
      accUp = 0;
      clearTimeout(endTimer);
    };

    /* 向下：达到触发值后立刻翻一屏，不再等滚轮停；目标在手势开始时已固定 */
    const triggerDown = () => {
      if (locked || animating || !tops.length) return;
      const target = gestureTarget ?? nextTop(window.scrollY);
      locked = true;
      accDown = 0;
      clearTimeout(endTimer);
      if (target == null) return;
      glideToY(target);
    };

    /* 不足 32px 就停手：走过 8px 就当一次轻扫，翻到下一屏；否则回最近一屏。
       这是"轻轻滑一下"和触控板噪声之间的兜底，不参与正常触发路径。 */
    const endGesture = () => {
      if (!gestureActive) return;
      gestureActive = false;
      if (animating || locked || !desktop.matches || !fits || !tops.length) return;
      if (accDown >= DOWN_MIN_FLIP && gestureTarget != null) {
        triggerDown();
        return;
      }
      if (accDown > 0) {
        const y = window.scrollY;
        const nearest = tops[nearestIndex(y)];
        if (Math.abs(nearest - y) > 2) glideToY(nearest, 320);
      }
      accDown = 0;
    };

    const onWheel = (event: WheelEvent) => {
      if (!desktop.matches || !fits || !tops.length) return;
      if (event.ctrlKey) return; // 触控板捏合缩放
      const unit =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
      const rawY = event.deltaY * unit;
      const rawX = event.deltaX * unit;
      if (Math.abs(rawY) < Math.abs(rawX)) return; // 横向手势不接管
      /* 鼠标滚轮一格 100、触控板一格 1–10：同时压到 60 以内，
         再用累计 32px 统一判断，避免"鼠标一碰就翻、触控板滑不动" */
      const px = Math.sign(rawY) * Math.min(Math.abs(rawY), MAX_EVENT_PX);
      if (!px) return;

      const now = performance.now();
      const quiet = now - lastWheelAt;
      const isNew = !gestureActive || quiet > GESTURE_GAP;
      lastWheelAt = now;

      if (px > 0) {
        /* 向下由脚本接管：既避免"原生滚一段 + 再吸附"的两段感，
           也顺手把这次手势的后续惯性全部吞掉。 */
        event.preventDefault();
        if (animating) return;
        if (locked) {
          /* 动画结束还不够：必须等滚轮真正静下来、且动画已经收尾，
             惯性尾巴才不会接着翻页 */
          if (quiet <= UNLOCK_QUIET || now - animEndAt <= UNLOCK_QUIET) return;
          locked = false;
          resetGesture();
        } else if (isNew || lastDir === -1) {
          resetGesture();
        } else if (!gestureActive) {
          resetGesture();
        }

        accDown += Math.abs(px);
        /* 触发前先跟手走一小步，别停在原处等判定 */
        if (gestureTarget != null) {
          const y = window.scrollY;
          const step = Math.min(Math.abs(px) * DOWN_STEP_GAIN, DOWN_STEP_MAX);
          const nextY = Math.min(gestureTarget, y + step);
          if (nextY > y) window.scrollTo(0, nextY);
        }
        clearTimeout(endTimer);
        endTimer = window.setTimeout(endGesture, END_QUIET);
        if (accDown >= DOWN_TRIGGER) triggerDown();
        return;
      }

      /* 向下动画中明确反向：立刻交还原生滚动（向上逻辑保持原样） */
      if (animating) {
        accUp += Math.abs(px);
        if (accUp < REVERSE_PX) {
          event.preventDefault();
          return;
        }
        cancelGlide();
        accUp = 0;
      } else if (locked && now - animEndAt <= UNLOCK_QUIET) {
        /* 动画刚结束的 100ms 内，向上先走 10px 死区：
           过滤触控板惯性尾巴的极小反向抖动，避免刚翻过去又被抖回来 */
        accUp += Math.abs(px);
        if (accUp < REVERSE_PX) {
          event.preventDefault();
          return;
        }
      }
      locked = false;
      accUp = 0;
      accDown = 0;
      lastDir = -1;
      clearTimeout(endTimer);
      gestureActive = true;
      /* 向上完全交还原生连续滚动，不再做任何自动吸附：
         之前"停手后按 28% 落屏"会在顶端小幅上滑时把页面判到上一屏，
         用户看到的就是"明明还在这一屏，却被强行拉走"。 */
    };

    /* 桌面触屏（一体机 / 触控笔记本）：沿用原来的"原生滚 + 停手吸附" */
    const onTouchStart = () => {
      if (!desktop.matches || !fits) return;
      cancelGlide();
      touchStartY = window.scrollY;
      locked = false;
      gestureActive = false;
      lastDir = 0;
      accDown = 0;
      accUp = 0;
      clearTimeout(endTimer);
    };

    const onTouchEnd = () => {
      if (!desktop.matches || !fits || touchStartY < 0 || !tops.length) return;
      const from = touchStartY;
      touchStartY = -1;
      const delta = window.scrollY - from;
      const target =
        Math.abs(delta) > viewH * UP_TRIGGER
          ? tops[stepIndex(from, delta > 0 ? 1 : -1)]
          : tops[nearestIndex(from)];
      glideToY(target);
    };

    const goBy = (dir: 1 | -1) => {
      if (!tops.length) return;
      const base = nearestIndex(window.scrollY);
      const to = Math.min(tops.length - 1, Math.max(0, base + dir));
      if (to === base) return;
      locked = false;
      gestureActive = false;
      lastDir = 0;
      glideToY(tops[to]);
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
      if (!desktop.matches || !fits || animating) return;
      event.preventDefault();
      goBy(down ? 1 : -1);
    };

    /* 初始测量 + 只在 resize / 字体加载 / 内容尺寸变化时重测 */
    measure();
    observeScreens();
    window.addEventListener("load", scheduleMeasure);
    window.addEventListener("resize", scheduleMeasure);
    void document.fonts?.ready.then(scheduleMeasure).catch(() => {});
    const onDesktopChange = () => {
      cancelGlide();
      measure();
      observeScreens();
    };
    desktop.addEventListener?.("change", onDesktopChange);

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("keydown", onKeyNav);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("keydown", onKeyNav);
      window.removeEventListener("load", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      desktop.removeEventListener?.("change", onDesktopChange);
      ro?.disconnect();
      cancelAnimationFrame(measureRaf);
      window.clearTimeout(endTimer);
      cancelGlide();
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
        <Aurora variant="minimal" />
        {/* 首屏右侧插画：人物和蓝紫弧面来自同一张参考图，只把背景的左侧、顶部做了
            渐隐（人物本身保持不透明），所以不用 CSS 遮罩也能直接贴在页面背景上。
            绝对定位到 section 右下角，向右、向下贴边出血，不占左栏的排版宽度；
            窄屏（<lg）隐藏，改在左栏内容下面出一张通栏图。 */}
        <div
          aria-hidden="true"
          data-reveal
          className="pointer-events-none absolute inset-y-0 right-0 z-[1] hidden items-end justify-end lg:flex"
        >
          <img
            src={heroCalmLight}
            alt=""
            className="block h-auto max-h-[calc(100%-64px)] w-[48vw] max-w-[760px] object-contain object-right-bottom dark:hidden"
          />
          <img
            src={heroCalmDark}
            alt=""
            className="hidden h-auto max-h-[calc(100%-64px)] w-[48vw] max-w-[760px] object-contain object-right-bottom dark:block"
          />
        </div>
        <div className="relative z-10 mx-auto grid w-full max-w-[1440px] items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
          <div data-reveal className="@container">
            <p className="text-base font-semibold tracking-[0.2em] text-primary-500">
              平台概览
            </p>
            <h2 className="auth-section-title mt-6 max-w-[720px] text-balance tracking-tight text-slate-900">
              多模态心理筛查与<span className="whitespace-nowrap">分级预警系统</span>
            </h2>
            {/* 首屏讲"这个产品能做什么"，技术路线留给「核心技术」屏。
                依据申报书「使用说明」：用户经三模态采集 → 自动生成预警报告 →
                管理端完成预警处置与个案跟踪。 */}
            <p className="hero-body mt-8 max-w-[640px] text-[18px] leading-9 text-slate-600 sm:text-[20px] sm:leading-[2.1]">
              面向校园、企业、社区的
                <strong className="font-medium text-slate-800">心理筛查预警平台</strong>
              。用户完成一次文本、语音、图像的三模态采集，系统即以
                <strong className="font-medium text-slate-800">动态跨模态哈希检索</strong>
              匹配相似案例，再由
                <strong className="font-medium text-slate-800">RAG</strong>
              结合心理知识库生成可追溯的筛查报告；管理端据此完成分级预警与个案跟踪。
            </p>
            <p className="mt-4 max-w-[640px] rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-[14px] leading-7 text-slate-600">
              实际使用分两种方式：只完成一份 2–4 分钟的标准化量表，就能得到量表分档与基础建议；如果愿意继续补充文本、语音或图像，系统才会启动跨模态检索与 RAG 报告。补充可以随时跳过，结果页会明确标明本次结论用了哪些依据。
            </p>

            {/* 特性列表 + 首屏「立即体验」：与右上角「登录」同一个入口（进登录页后再切换身份）。
                按钮与四条清单同处一行，垂直居中对齐（落在第二、三条之间），并在这行
                剩余的横向空间里居中 —— 不是整栏居中，仍保持左栏的左对齐关系。
                用容器查询按「左栏实际宽度」切两栏：只有宽度 ≥510px（清单 329 + 按钮 133
                + 两侧各留 24）时才并排，1024 那种窄左栏自动落回按钮在下的单栏。
                不要改成 justify-between：那会把按钮顶到右边缘，贴着右侧大卡片。 */}
            <div className="mt-5 grid grid-cols-1 items-center gap-y-4 border-t border-dashed border-slate-200 pt-4 @[510px]:grid-cols-[auto_minmax(0,1fr)]">
              <ul className="grid gap-1">
                {[
                  "动态跨模态哈希检索：毫秒级匹配相似案例",
                  "RAG 报告生成：以检索样例与心理知识库为依据",
                  "三模态互补：补充后文本、语音、图像一起参与分析（可跳过）",
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
                className="group inline-flex shrink-0 items-center justify-self-start gap-2 rounded-full bg-primary-600 px-6 py-3 text-[15px] font-medium text-white shadow-[0_12px_28px_-18px_rgba(70,95,255,0.5)] transition-all duration-200 hover:bg-primary-700 active:scale-[0.97] @[510px]:justify-self-center"
              >
                <span className="whitespace-nowrap">立即体验</span>
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
            </div>

            <div className="hero-badges mt-5 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[13px] text-slate-500">
                国家级大创立项 · 2026-06
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[13px] text-slate-500">
                金种子重点课题
              </span>
            </div>

            {/* 手机 / 平板：右侧插画改为通栏放在内容下面，底部做一点渐隐，
                避免图片下缘在页面中间切出一条硬边。桌面端由上面那张绝对定位图承担。 */}
            <div className="mt-10 -mx-6 sm:-mx-10 lg:hidden">
              <img
                src={heroCalmLight}
                alt=""
                className="block w-full [mask-image:linear-gradient(to_bottom,#000_86%,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,#000_86%,transparent)] dark:hidden"
              />
              <img
                src={heroCalmDark}
                alt=""
                className="hidden w-full [mask-image:linear-gradient(to_bottom,#000_86%,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,#000_86%,transparent)] dark:block"
              />
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
        desc="相比依赖人工访谈与单一量表的传统筛查，系统在同一时间轴上融合三条通道的线索，形成可纵向比较的个体状态画像。量表可以单独完成并给出分档与基础建议；补充三条线索后，量表分数会与跨模态证据一起用于更完整的分析。"
        points={[
          "文本通道：认知模式与语言逻辑",
          "音频通道：语音语调、情绪波动与情感强度",
          "视觉通道：面部表情、绘画笔迹与情绪外露",
          "标准化量表：PHQ-9 / GAD-7 / ISI / PSS-10 可单独完成，也可与线索合并解读",
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
