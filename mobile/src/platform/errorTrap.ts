/**
 * errorTrap.ts — 把「白屏」变成「可读的报错」。
 *
 * 背景：真机上采集页/检索页白屏，而桌面 Chrome 复现不出来 —— 典型的
 * WebView 环境特有崩溃：React 渲染出错后卸载整棵树，用户只看到一片白，
 * 拿不到任何线索。这里做三件事：
 *   1. 捕获未处理的 JS 错误与 Promise 拒绝；
 *   2. 直接画一个覆盖层把错误信息显示出来（含 UA、平台等环境信息）；
 *   3. 提供「复制」按钮，方便把现场原样发回来。
 */

const OVERLAY_ID = 'psych-fatal-overlay';

function envSummary(): string {
  const ua = navigator.userAgent;
  let cap = 'n/a';
  try {
    const c = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
    cap = c?.getPlatform?.() ?? 'n/a';
  } catch {
    /* 忽略 */
  }
  return [
    `平台: ${cap}`,
    `安全上下文: ${String(window.isSecureContext)}`,
    `MediaRecorder: ${typeof MediaRecorder}`,
    `mediaDevices: ${typeof navigator.mediaDevices}`,
    `视口: ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x`,
    `UA: ${ua}`,
  ].join('\n');
}

function show(title: string, detail: string): void {
  if (document.getElementById(OVERLAY_ID)) {
    const pre = document.querySelector<HTMLPreElement>(`#${OVERLAY_ID} pre`);
    if (pre) pre.textContent += `\n\n--- ${title} ---\n${detail}`;
    return;
  }

  const box = document.createElement('div');
  box.id = OVERLAY_ID;
  box.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647',
    'background:#0f172a', 'color:#e2e8f0', 'padding:16px',
    'padding-top:calc(16px + env(safe-area-inset-top))',
    'font:12px/1.6 ui-monospace,Menlo,Consolas,monospace',
    'overflow:auto', 'white-space:pre-wrap', 'word-break:break-all',
  ].join(';');

  const h = document.createElement('div');
  h.style.cssText = 'color:#f87171;font-weight:700;font-size:14px;margin-bottom:8px';
  h.textContent = '⚠ 应用发生错误（请把下面的内容截图或复制发给开发者）';

  const pre = document.createElement('pre');
  pre.style.cssText = 'margin:0;white-space:pre-wrap;word-break:break-all';
  pre.textContent = `--- ${title} ---\n${detail}\n\n--- 环境 ---\n${envSummary()}`;

  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:8px;margin-top:14px';

  const mk = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'flex:1;min-height:44px;border-radius:10px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-size:13px';
    b.onclick = fn;
    return b;
  };
  bar.appendChild(
    mk('复制全部', () => {
      void navigator.clipboard?.writeText(pre.textContent ?? '');
      alert('已复制');
    }),
  );
  bar.appendChild(
    mk('关闭浮层', () => {
      box.remove();
    }),
  );

  box.append(h, pre, bar);
  document.body.appendChild(box);
}

/** 安装全局错误捕获（在 React 挂载之前调用） */
export function installErrorTrap(): void {
  window.addEventListener('error', (e) => {
    const err = e.error as Error | undefined;
    show('window.onerror', `${err?.name ?? 'Error'}: ${err?.message ?? e.message}\n${err?.stack ?? ''}`);
  });

  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as Error | string;
    const detail = r instanceof Error ? `${r.name}: ${r.message}\n${r.stack ?? ''}` : String(r);
    show('unhandledrejection', detail);
  });
}

/** 供 React ErrorBoundary 复用 */
export function reportReactError(error: Error, info: string): void {
  show('React 渲染错误', `${error.name}: ${error.message}\n${error.stack ?? ''}\n\n组件栈:\n${info}`);
}
