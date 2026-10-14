import { useEffect, useMemo, useState } from 'react';

/**
 * 演示用的「手机端 / 桌面端」视图切换。
 *
 * 为什么用 iframe：本项目的响应式全部建立在**视口宽度**上（Tailwind 的
 * sm/lg/2xl 断点、以及 index.css 里那几段 @media）。在桌面浏览器里想看到
 * 真正的手机版式，只有两条路 —— 要么把每条媒体查询再复制一份挂到某个类上，
 * 要么给内容一个真正 390px 宽的视口。前者要维护两套样式、必然漂移，
 * 后者一个 iframe 就够：**iframe 内部的媒体查询按 iframe 自己的宽度求值**，
 * 所以不需要改任何 CSS，渲染出来就是真·手机版。
 *
 * iframe 的源不是外部文件，而是**当前文档自己的 HTML**（由 main.tsx 在
 * React 挂载之前抓下来）。这样整个演示包仍然只有一个文件，离线可用。
 * iframe 内部通过 window.self !== window.top 判断自己在框里，从而不再渲染
 * 这个切换按钮（否则会无限套娃）。
 *
 * 切换时给容器加 width/height 的过渡，而不是直接换 DOM —— 用户要求
 * "切换过去的时候要平滑一点，不要一下就闪过去"。iframe 宽度连续变化时
 * 内部会跟着连续重排，观感是"页面自己缩成手机宽度"，不是硬切。
 */

type Mode = 'desktop' | 'mobile';

/* 手机取景框尺寸（接近 iPhone 14 Pro 的逻辑像素，也是各页面实测用的 390×844） */
const PHONE_W = 390;
const PHONE_H = 844;

export default function DemoViewToggle({ appHtml }: { appHtml: string }) {
  /* 默认桌面端：观看者本来就在电脑前，先看到完整版式，再切手机端对比 */
  const [mode, setMode] = useState<Mode>('desktop');

  /* 用 blob URL 承载"当前文档的 HTML"。用 useMemo 而不是 effect：
     要在首次渲染时就有 src，否则 iframe 会先白一下。 */
  const src = useMemo(
    () => URL.createObjectURL(new Blob([appHtml], { type: 'text/html' })),
    [appHtml],
  );
  useEffect(() => () => URL.revokeObjectURL(src), [src]);

  /* 视口不够高时整体等比缩小，别让取景框被裁掉 */
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => {
      const avail = window.innerHeight - 140; /* 留给顶部按钮与上下留白 */
      setScale(Math.min(1, avail / PHONE_H));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const mobile = mode === 'mobile';

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-950">
      {/* 顶栏：切换按钮 */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-3 px-4 py-3">
        <span className="hidden text-xs text-slate-400 sm:inline">演示视图</span>
        <div className="flex rounded-full bg-slate-800 p-1 shadow-lg ring-1 ring-white/10">
          {([['mobile', '手机端'], ['desktop', '桌面端']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              className={
                'rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-300 ' +
                (mode === value ? 'bg-primary-500 text-white' : 'text-slate-300 hover:text-white')
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 取景区：宽度/高度做过渡，切换时是"缩过去"而不是"闪过去" */}
      <div className="absolute inset-x-0 bottom-0 top-14 flex items-center justify-center overflow-hidden">
        <div
          className="relative overflow-hidden bg-white transition-[width,height,border-radius,box-shadow] duration-[520ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{
            width: mobile ? PHONE_W : '100%',
            height: mobile ? PHONE_H : '100%',
            borderRadius: mobile ? 40 : 0,
            boxShadow: mobile ? '0 0 0 10px #1e293b, 0 30px 80px -20px rgba(0,0,0,0.8)' : 'none',
            transform: mobile ? `scale(${scale})` : 'none',
            transformOrigin: 'center center',
            transitionProperty: 'width, height, border-radius, box-shadow, transform',
          }}
        >
          <iframe
            title="演示视图"
            src={src}
            className="h-full w-full border-0 bg-white"
            /* 手机取景框里不需要滚动条留白 */
            scrolling="yes"
          />
        </div>
      </div>
    </div>
  );
}
