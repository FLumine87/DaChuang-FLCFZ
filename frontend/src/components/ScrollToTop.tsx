import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * 路由切换时把页面滚回顶部。
 *
 * 解决的问题（用户真机截图 + 实测确认）：
 *   "我一点进去就看到的不是界面的最上方。但是很明显他上面是有字的，
 *    你没有展示出来，所以我觉得你所有的界面刚一打开的时候都应该是拉到顶的。"
 *
 * 原因：这是单页应用（HashRouter），路由切换只换 DOM、**浏览器不会重置滚动位置**，
 * 于是从「已经翻到中间的页面」点进登录页/首次引导/量表页时，新页面直接停在
 * 上一个页面的滚动高度上 —— 顶部的内容被"顶"到视口外面，看起来像被裁掉了。
 * 实测：落地页滚到 1400 后点「登录」，登录页进入时 scrollY = 464（应为 0）。
 *
 * 项目里此前只有 3 个页面各自调了 window.scrollTo(0, 0)
 * （AppShell / FirstRunQuestionnaire / Screening），其余页面全是漏的 ——
 * 逐个补容易再漏，所以在路由层统一处理。
 *
 * 用 useLayoutEffect 而不是 useEffect：要在浏览器绘制之前就复位，
 * 否则会先闪一下"中间位置"的旧画面再跳到顶部。
 */
export default function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    /* behavior: 'instant' —— 明确不要平滑滚动。
       否则从很长的页面切过来时，用户会看到一段从中间飞到顶部的动画。 */
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);

  return null;
}
