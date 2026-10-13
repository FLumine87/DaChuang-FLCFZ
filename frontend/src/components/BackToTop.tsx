/* 回到顶部（左下角）
 *
 * 用户要求：落地页、管理端、个人端首页的左下角各放一个，
 * 图标用「横线 + 上箭头」（lucide 的 ArrowUpToLine）。
 *
 * 位置为什么是"内容区左下角"而不是"视口左下角"：
 *   应用页左侧有固定侧栏（--sidebar-width，展开 290px / 收起 90px），
 *   贴视口左边会压在侧栏底部那张「每一份关注，都有意义」卡片上。
 *   所以这里用 margin-left: var(--sidebar-width) 让开侧栏；
 *   落地页没有侧栏，传 `flush` 去掉这个偏移即可。
 *
 * 显现时机：滚动超过一屏的 60% 才浮出。一进页面就杵在那儿反而碍眼。
 *
 * 为什么用 createPortal 挂到 document.body：
 *   position: fixed 在**带 transform 的祖先**里会退化成"相对该祖先定位"。
 *   外壳的 page-enter 转场动画正好给页面容器留了 transform，
 *   于是按钮被钉在那个容器上、跟着内容一起滚走（实测 bottom 变成了 -2765px）。
 *   挂到 body 之下就没有这个祖先，fixed 才是真的相对视口。
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpToLine } from 'lucide-react';

export default function BackToTop() {
  const [visible, setVisible] = useState(false);

  /* 滚动检测：监听**捕获阶段**的 scroll 事件，从事件源读 scrollTop。
     试过两种更直觉的写法，都不行：
       · window.scrollY —— 应用页滚的是内部容器，它恒为 0；
       · body 上的哨兵 + IntersectionObserver —— 哨兵不在滚动容器里，永远不离开视口。
     捕获阶段能收到任意容器的 scroll（scroll 不冒泡，但会在捕获阶段经过 document），
     e.target 就是真正在滚的那个元素，整页滚和容器滚都能覆盖。 */
  useEffect(() => {
    const onScroll = (e: Event) => {
      const t = e.target as HTMLElement | Document | null;
      const top =
        t === document || t === document.documentElement || t === document.body
          ? Math.max(window.scrollY || 0, document.documentElement.scrollTop || 0)
          : ((t as HTMLElement)?.scrollTop ?? 0);
      setVisible(top > window.innerHeight * 0.6);
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, []);

  const node = (
    <button
      type="button"
      aria-label="回到顶部"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className={`fixed bottom-6 right-6 z-40 grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-[0_4px_16px_-6px_rgba(16,24,40,0.25)] transition-all duration-300 hover:-translate-y-0.5 hover:border-primary-300 hover:text-primary-600 ${
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
      }`}
    >
      <ArrowUpToLine className="h-5 w-5" />
    </button>
  );

  /* SSR/预渲染时没有 document，兜一下 */
  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
