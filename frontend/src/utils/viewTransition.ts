import { flushSync } from "react-dom";
import type { NavigateFunction } from "react-router-dom";

/**
 * 带页面转场的跳转。
 *
 * 为什么需要 flushSync：View Transitions 要求"快照旧画面 → 同步改 DOM → 快照新画面"，
 * 而 React 的 setState 是异步的；不 flushSync 的话新快照会拍在还没更新的 DOM 上，
 * 转场就会变成"旧页 → 旧页"的空动画。
 *
 * 浏览器不支持 startViewTransition 时直接普通跳转（此时仍有 CSS 的 .page-enter 兜底）。
 */
export function navigateWithTransition(navigate: NavigateFunction, to: string) {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { finished: Promise<void> };
  };

  if (!doc.startViewTransition) {
    navigate(to);
    return;
  }

  doc.startViewTransition(() => {
    flushSync(() => {
      navigate(to);
    });
  });
}
