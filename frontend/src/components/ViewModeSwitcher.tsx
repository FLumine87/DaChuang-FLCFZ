import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Monitor, Smartphone } from 'lucide-react';

/**
 * 手机端 / 桌面端 视图切换（集成在应用内部，按钮固定在右上角）。
 *
 * 为什么手机模式要用 iframe：本项目的响应式**全部建立在视口宽度上**
 * （Tailwind 的 sm/lg/2xl 断点，以及 index.css 里那几段 @media）。
 * 在一台宽屏电脑上想看到真正的手机版式，只有两条路 ——
 *   ① 把每条媒体查询再复制一份挂到某个 class 上（两套样式必然漂移）；
 *   ② 给内容一个真正 390px 宽的视口。
 * iframe 就是 ②：**iframe 内部的媒体查询按 iframe 自己的宽度求值**，
 * 所以一行 CSS 都不用改，渲染出来就是货真价实的手机版式。
 *
 * 桌面模式下**不套 iframe**，应用照常直接渲染 —— 日常使用完全不受这个开关影响，
 * 只有主动切到手机模式时才会进框。
 *
 * iframe 的源是"当前文档自己的 HTML"（main.tsx 在 React 挂载前抓下来），
 * 所以在单文件离线包里也能用，不需要额外的文件。
 *
 * 用 VITE_VIEW_SWITCHER=false 可以整个关掉（默认开）。
 */

const PHONE_W = 390;
const PHONE_H = 844;
const STORE_KEY = 'psych_view_mode';

/**
 * 是不是"真的在手机/平板上"打开的。
 *
 * 为什么不能构建时决定：文件在打包那一刻**根本不知道**自己将来会在什么设备上
 * 被打开 —— 同一个 HTML 既可能被拷到手机里点开，也可能在电脑上双击预览。
 * 之前我按"手机包 = 在手机上开"写死了开关，纯属假设（用户直接指出来了）。
 * 改为运行时判断，同一个文件在哪儿打开都对：
 *   · 窄视口 + 粗指针（触摸） → 真机 → 藏掉按钮（在那儿没意义，还挡内容）
 *   · 其余（桌面、带鼠标的窄窗口） → 显示按钮
 */
function isHandheld(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(max-width: 767px) and (pointer: coarse)').matches;
}

type Mode = 'desktop' | 'mobile';

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
  const [mode, setMode] = useState<Mode>(initialMode);
  /* 真机上整个按钮不渲染。旋转屏幕/插拔鼠标都要能跟着变，所以监听媒体查询。 */
  const [handheld, setHandheld] = useState(isHandheld);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 767px) and (pointer: coarse)');
    const onChange = () => setHandheld(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /* 记住选择：演示时来回切，刷新后不用重选 */
  useEffect(() => {
    try {
      window.localStorage.setItem(STORE_KEY, mode);
    } catch {
      /* 隐私模式不可写就退化成"不记忆"，不影响使用 */
    }
  }, [mode]);

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

      {/* 手机模式：深色底 + 取景框。宽度/高度走过渡，切换时是"缩过去"不是硬切。 */}
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

      {/* 切换按钮：右上方，但**压在顶栏下方**。真机上不渲染。
         顶栏（落地页/登录页/个人端/管理端）高度 64px，右上角已经有「登录」
         和主题切换按钮；一开始放在 top-4 直接把这两个盖住了（截图确认）。
         下移到 72px 仍然在"右上方"，又不挡任何原有控件。 */}
      {!handheld && <div className="fixed right-4 top-[72px] z-[9999] flex items-center gap-1 rounded-full bg-slate-900/90 p-1 shadow-lg ring-1 ring-white/15 backdrop-blur">
        {([['desktop', '桌面端', Monitor], ['mobile', '手机端', Smartphone]] as const).map(
          ([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              title={label}
              className={
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors duration-200 ' +
                (mode === value
                  ? 'bg-primary-500 text-white'
                  : 'text-slate-300 hover:bg-white/10 hover:text-white')
              }
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ),
        )}
      </div>}
    </>
  );
}
