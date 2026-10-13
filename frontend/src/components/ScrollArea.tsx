import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * ScrollArea · 卡片内的滚动容器（可见滚动条 + 底部渐隐 + 「向下滚动查看更多」提示）
 *
 * 为什么单独抽出来：用户 2026-10-14 反馈「这个导航栏有点太隐蔽，都不知道下面还有内容」——
 * 指的是报告卡里那根几乎看不见的细滚动条。与其在每个页面各写一遍"监听滚动 / 判断是否到底 /
 * 画一条渐隐"，不如统一成一个组件：03 报告卡的右栏、检索页右栏、对话页消息列表等
 * 任何内部滚动的地方都能直接用，样式与判定口径也保持一致。
 *
 * 判定：内容高于容器（可滚动）**且**还没滚到底 → 显示遮罩与提示；滚到底（或本来就放得下）
 * 立刻收起。滚动条样式见 index.css 的 .scroll-visible（8px、圆角、令牌取色、深浅色都适配）。
 */
export default function ScrollArea({
  children,
  className = '',
  innerClassName = '',
  hint = '向下滚动查看更多',
}: {
  children: ReactNode;
  /** 外层容器的类名（负责高度 / 定位） */
  className?: string;
  /** 滚动层的类名（负责内边距 / 背景 / 圆角等） */
  innerClassName?: string;
  /** 底部提示文案（不含箭头，箭头由组件加） */
  hint?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasMore, setHasMore] = useState(false);

  /** 还能往下滚才算"下面还有内容"：留 8px 容差，避免亚像素误差让提示抖 */
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    setHasMore(el.scrollHeight - el.clientHeight > 8 && remaining > 8);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    /* 首帧量一次放到 rAF 里：effect 体内同步 setState 会触发级联渲染
       （react-hooks/set-state-in-effect），而且这里本来就要等布局完成才量得准。
       ResizeObserver 在开始观察时也会回调一次，两处互为兜底。 */
    const raf = requestAnimationFrame(measure);
    /* 三处都要重量：容器尺寸变（窗口/分栏）、内容变（切左栏、报告异步返回）、窗口缩放 */
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    const mutation = new MutationObserver(measure);
    mutation.observe(el, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  return (
    <div className={`relative min-h-0 ${className}`}>
      <div
        ref={ref}
        onScroll={measure}
        className={`scroll-visible h-full overflow-y-auto ${innerClassName}`}
      >
        {children}
      </div>

      {hasMore && (
        <>
          {/* 渐隐遮罩：用当前表面色（bg-white 走 --color-white 令牌，深浅色自动适配）。
              高度给足 12（约两行），中段再实一点，避免最后一行文字与提示叠在一起看不清。 */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-white via-white/85 to-transparent"
          />
          <p className="pointer-events-none absolute inset-x-0 bottom-1.5 text-center text-[11px] text-slate-400">
            {hint} ↓
          </p>
        </>
      )}
    </div>
  );
}
