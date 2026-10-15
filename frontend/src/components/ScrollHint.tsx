import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * 只在**确有必要**的页面出现 —— 用户明确要求：
 *   "不要每个页面都加，加在我刚刚说的那三个页面就好了。"
 * 也就是：登录、填写表格、补充记录这三类"下面还要用户填东西"的界面。
 *
 * 其余页面不加：列表页/结果页/首页这类，用户本来就知道能滚，
 * 每页都弹一个提醒反而变成噪音。
 *
 * 要新增页面，在这里加一条即可（支持前缀匹配，子路由会一起命中）。
 */
const HINT_PATHS = [
  '/login',                       /* 登录：表单在下方，一屏装不下 */
  '/personal/first/questionnaire',/* 首次引导的量表填写 */
  '/personal/first/supplement',   /* 表后的"想补充些什么"记录页 */
];

const shouldHint = (pathname: string) =>
  HINT_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));

/**
 * 「下面还有内容」的下拉提醒（仅手机端）。
 *
 * 用户要求：
 *   "这些登录界面填写表格的界面还有补充之类的界面，我们下面是要让用户去填的。
 *    所以我们应该考一个类似于下拉的提醒吧，在手机屏幕的偏下面。"
 *
 * 解决的问题：手机屏幕短，登录页/首次引导/量表填写这类页面一屏装不下，
 * 但**用户看不出下面还有内容** —— 以为页面就这些，直接放弃。
 * 桌面上不存在这个问题（屏幕高，一屏基本能看到全部）。
 *
 * 设计取舍：
 *   · 只在**确实还有内容可滚**且**没滚到底**时出现 —— 到底了还提示就是噪音；
 *   · 位置在底部安全区之上、水平居中，用胶囊形而不是整条横幅，
 *     不遮挡表单控件、也不像广告条；
 *   · 动效是缓慢的上下浮动（1.6s 一次），幅度很小，是"提示"不是"闪烁"；
 *     尊重 prefers-reduced-motion，用户关掉动效时静态显示；
 *   · 一滚到底就淡出，不再抢注意力。
 */
export default function ScrollHint() {
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(false);
  const enabled = shouldHint(pathname);

  useEffect(() => {
    /* 不在白名单里就什么都不做 —— 不要在 effect 体里同步 setState
       （会触发级联渲染，eslint 报 react-hooks 错误）。
       渲染处已有 `!enabled` 兜底，这里直接 return 即可。 */
    if (!enabled) return;
    const check = () => {
      const doc = document.documentElement;
      const remaining = doc.scrollHeight - window.scrollY - window.innerHeight;
      /* 还有 120px 以上没露出来才提示；快到底（不足 120px）就收起来 */
      setVisible(remaining > 120);
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    /* 路由切换后内容高度会变，延迟再测一次 */
    const t = window.setTimeout(check, 400);
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
      window.clearTimeout(t);
    };
  }, [enabled]);

  if (!enabled || !visible) return null;

  return (
    <div
      aria-hidden="true"
      className="scroll-hint pointer-events-none fixed inset-x-0 z-30 flex justify-center lg:hidden"
      style={{ bottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="scroll-hint-pill flex items-center gap-1.5 rounded-full bg-white/92 px-3.5 py-2 text-[12px] font-medium text-primary-600 shadow-[0_6px_20px_-6px_rgba(16,24,40,0.28)] ring-1 ring-primary-100 backdrop-blur-sm">
        <span>下面还有内容</span>
        <svg
          className="scroll-hint-arrow h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
    </div>
  );
}
