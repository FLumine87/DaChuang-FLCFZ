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

      {/* 切换按钮：最右上角、常驻。
         样式**照抄旁边那两个控件**（LandingPage 的「登录」与主题切换）：
         无底色、text-slate-500、hover 变主色、尺寸 h-9 w-9 圆角方块。
         之前是个深色胶囊 + 蓝色选中块，既比旁边的按钮宽一倍（119px vs 76px），
         风格也跟顶栏格格不入（用户："还是太宽了，而且要与旁边按键风格一致"）。
         窄屏只留一个按钮（图标表示"点一下会去哪边"），宽屏两个都显示。 */}
      {/* 与顶栏严格对齐 —— 这一排看起来"违和"，实测是两个原因叠加：
           ① 垂直：顶栏 h-16（64px），控件是 h-9（36px），正中应是 top 14px。
              原来写 top-2(8px)，中心落在 26px，比主题按钮的 32px 高了 6px；
           ② 水平：容器是 position:fixed，**脱离了顶栏的 flex 流**，顶栏那组
              的 gap-2 管不到它，于是"主题→桌面"是 0 间隙、"桌面→手机"是 8px，
              间距忽宽忽窄。
          现在：top-3.5(14px) 对齐垂直中线；gap-2 让三者中心距统一 44px；
          right-10/lg:right-12/xl:right-16 与顶栏自身的
          px-6/sm:px-10/lg:px-12/xl:px-16 逐档对应，右边距与页面左边距一致。 */}
      <div className="fixed right-10 top-3.5 z-[9999] hidden items-center gap-2 lg:right-12 xl:right-16 sm:flex">
        {([['desktop', '桌面端视图', Monitor], ['mobile', '手机端视图', Smartphone]] as const).map(
          ([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              title={label}
              className={
                'hidden h-9 w-9 place-items-center rounded-lg transition-all duration-200 hover:bg-white/80 hover:text-primary-700 active:scale-90 active:bg-white sm:grid ' +
                (mode === value ? 'text-primary-600' : 'text-slate-500')
              }
            >
              <Icon className="h-4 w-4" />
            </button>
          ),
        )}
      </div>
    </>
  );
}
