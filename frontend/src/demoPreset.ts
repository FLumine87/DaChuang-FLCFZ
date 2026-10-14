/**
 * 演示包的启动预设。
 *
 * 单文件演示包会打成两份（见 frontend/scripts/make-demo-variants.mjs）：
 *   · 桌面演示：从落地页进入，给人看完整的产品介绍；
 *   · 手机演示：直接进登录页并预填演示账号 —— 手机上打两遍账号密码很烦，
 *     而且演示现场经常是"把手机递给别人看"。
 *
 * 两份产物是同一个 index.html，只在末尾多注入一段
 *   <script>window.__DEMO_PRESET__ = {...}</script>
 * 应用启动时读它。**不注入时（开发服务器、正式构建）这里全是 undefined，
 * 行为与原来完全一致**，不会影响正常使用。
 */

export interface DemoPreset {
  /** 启动后要落的 hash 路由，例如 '#/login' */
  route?: string;
  /** 登录页预填的演示账号 */
  prefill?: { username?: string; password?: string };
  /**
   * 是否显示「手机端 / 桌面端」切换按钮（见 components/ViewModeSwitcher.tsx）。
   * 默认显示；手机演示包会显式设为 false —— 那个包本来就是在手机本体上打开的，
   * 再放一个「切到桌面端」的按钮既没用又挡内容。
   */
  viewSwitcher?: boolean;
}

export function readDemoPreset(): DemoPreset {
  if (typeof window === "undefined") return {};
  const preset = (window as Window & { __DEMO_PRESET__?: DemoPreset }).__DEMO_PRESET__;
  return preset && typeof preset === "object" ? preset : {};
}

/**
 * 把预设路由写进地址栏。
 *
 * 只在**地址栏还没有路由**（空 hash 或只有 "#/"）时生效：
 * 用户在演示过程中点进了别的页面再刷新，不该被硬拽回登录页。
 */
export function applyDemoRoute(): void {
  const { route } = readDemoPreset();
  if (!route) return;
  const current = window.location.hash;
  if (current && current !== "#" && current !== "#/") return;
  window.location.hash = route;
}
