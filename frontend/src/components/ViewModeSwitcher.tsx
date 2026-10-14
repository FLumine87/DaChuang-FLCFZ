import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Monitor, Smartphone } from 'lucide-react';

/**
 * 手机端 / 桌面端 视图切换。固定在**最右上角**，常驻显示（不按设备隐藏）。
 *
 * 为什么手机模式要用 iframe：本项目的响应式**全部建立在视口宽度上**
 * （Tailwind 的 sm/lg/2xl 断点，以及 index.css 里那几段 @media）。
 * 在一台宽屏电脑上想看到真正的手机版式，只有两条路 ——
 *   ① 把每条媒体查询再复制一份挂到某个 class 上（两套样式必然漂移）；
 *   ② 给内容一个真正 390px 宽的视口。
 * iframe 就是 ②：**iframe 内部的媒体查询按 iframe 自己的宽度求值**，
 * 所以一行 CSS 都不用改，渲染出来就是货真价实的手机版式。
 *
 * 桌面模式下**不套 iframe**，应用照常直接渲染 —— 日常使用完全不受影响。
 *
 * 按钮曾经按 (窄视口 + 粗指针) 自动隐藏，现已改回常驻：那个判断在触屏笔记本、
 * 带键盘的平板上都可能给出用户不想要的结论，而"我到底在哪个视图"应该由
 * 使用者自己说了算，不该让浏览器替他决定。
 *
 * 位置冲突：最右上角原本是各页顶栏的「登录 / 主题切换 / 用户菜单」。
 * 所以这里在 <html> 上挂 view-switcher-on，由 CSS 给所有 .nav-blur 顶栏
 * 补一段右内边距，把顶栏内容整体左移让位 —— 比逐个改 5 个页面的顶栏可靠。
 */

const PHONE_W = 390;
const PHONE_H = 844;
const STORE_KEY = 'psych_view_mode';

type Mode = 'desktop' | 'mobile';

/**
 * 是不是"真的在手机/平板上"打开的。
 * 窄视口 + 粗指针（手指）→ 真机。只看宽度不行：桌面用户把窗口拉窄也会命中。
 */
function isHandheld(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(max-width: 767px) and (pointer: coarse)').matches;
}

/** 是不是被嵌在 iframe 里（手机视图的取景框内部）—— 那里不再重复渲染按钮 */
function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; /* 跨域取不到 top 就当作在框里，宁可不显示 */
  }
}

function initialMode(): Mode {
  try {
    return window.localStorage.getItem(STORE_KEY) === 'mobile' ? 'mobile' : 'desktop';
  } catch {
    return 'desktop';
  }
}

export default function ViewModeSwitcher({
  appHtml,
  children,
}: {
  appHtml: string;
  children: ReactNode;
}) {
  /* 以桌面端为中心：默认就是桌面，记忆里只有明确选过手机端才进手机模式 */
  const [mode, setMode] = useState<Mode>(initialMode);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORE_KEY, mode);
    } catch {
      /* 隐私模式不可写就退化成"不记忆"，不影响使用 */
    }
  }, [mode]);

  const [handheld, setHandheld] = useState(isHandheld);
  const [framed] = useState(isFramed);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 767px) and (pointer: coarse)');
    const onChange = () => setHandheld(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /* 给顶栏让位的开关（见文件头说明） */
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('view-switcher-on');
    return () => root.classList.remove('view-switcher-on');
  }, []);

  /* 手机模式的 iframe 源。useMemo 而不是 effect —— 首次渲染就要有 src，
     否则取景框会先白一下。 */
  const src = useMemo(
    () => (mode === 'mobile' ? URL.createObjectURL(new Blob([appHtml], { type: 'text/html' })) : ''),
    [appHtml, mode],
  );
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);

  /* 视口不够高时把取景框整体等比缩小，别被裁掉 */
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (mode !== 'mobile') return;
    const fit = () => setScale(Math.min(1, (window.innerHeight - 96) / PHONE_H));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [mode]);

  const mobile = mode === 'mobile';

  return (
    <>
      {/* 桌面模式：应用原样渲染，不套任何容器 */}
      {!mobile && children}

      {/* 手机模式：深色底 + 取景框 */}
      {mobile && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-slate-950">
          <div
            className="relative overflow-hidden bg-white"
            style={{
              width: PHONE_W,
              height: PHONE_H,
              borderRadius: 40,
              boxShadow: '0 0 0 10px #1e293b, 0 30px 80px -20px rgba(0,0,0,0.8)',
              transform: `scale(${scale})`,
              transformOrigin: 'center center',
            }}
          >
            <iframe title="手机端视图" src={src} className="h-full w-full border-0 bg-white" />
          </div>
        </div>
      )}

      {/* 切换按钮：最右上角、常驻、只有一个。
         先前是两个图标（桌面 / 手机），其中"当前所在的那一个"其实是多余的 ——
         你已经在桌面端了，"桌面端"这个按钮没有任何可做的事。
         现在只留"点一下会去哪边"的那一个：
           桌面模式 → 显示手机图标（点了进手机视图）
           手机模式 → 显示桌面图标（点了回桌面视图）
         真机（窄视口 + 手指）不显示：手机上本来就是手机版式，没有可切换的对象，
         而且 390px 顶栏实测没有空隙容纳它。
         iframe 内部（手机取景框里）也不显示，否则框里会再冒出一个按钮。 */}
      {!framed && !handheld && (
        <button
          type="button"
          onClick={() => setMode(mobile ? 'desktop' : 'mobile')}
          aria-pressed={mobile}
          title={mobile ? '切换到桌面端视图' : '切换到手机端视图'}
          className="fixed right-10 top-3.5 z-[9999] grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition-all duration-200 hover:bg-white/80 hover:text-primary-700 active:scale-90 active:bg-white lg:right-12 xl:right-16"
        >
          {mobile ? <Monitor className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
        </button>
      )}
    </>
  );
}
