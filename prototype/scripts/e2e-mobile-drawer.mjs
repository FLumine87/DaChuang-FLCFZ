#!/usr/bin/env node
/**
 * e2e-mobile-drawer.mjs · 手机端抽屉回归测试
 * -----------------------------------------------------------------------------
 * 覆盖的是一个真实出现过的 bug：抽屉只能打开、没有任何关闭方式，
 * 而且 data-mobile-open 跨页面不重置 —— 手机上表现为「侧边栏展不开」。
 *
 * 用 CDP 模拟 iPhone 视口，检查：
 *   1. 窄屏下汉堡按钮可见、侧栏默认在屏幕外
 *   2. 点汉堡 → 侧栏滑入 + 遮罩出现
 *   3. 点遮罩 → 收起
 *   4. 打开状态下点导航项 → 页面切换且抽屉自动收起
 *   5. Esc → 收起
 *   6. 横向不溢出（390 宽下 body 不产生横向滚动）
 *
 * 前置：本机 Chrome 可用。
 * 用法：node prototype/scripts/e2e-mobile-drawer.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9344;
const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['原型-单文件.html', 'pages/admin-dashboard.html'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

let chrome;
let profile;
let ws;

try {
  for (const rel of targets) {
    const isBundle = rel.endsWith('原型-单文件.html');
    const url = isBundle
      ? `file://${path.join(ROOT, rel)}#/pages/admin-dashboard.html`
      : `file://${path.join(ROOT, rel)}#light`;

    profile = mkdtempSync(path.join(tmpdir(), 'drawer-'));
    chrome = spawn(CHROME, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter',
      `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
      '--window-size=390,844', url,
    ], { stdio: 'ignore' });

    let wsUrl;
    for (let i = 0; i < 40; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        const t = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
        if (t) { wsUrl = t.webSocketDebuggerUrl; break; }
      } catch { /* 等 */ }
      await sleep(250);
    }
    if (!wsUrl) throw new Error('拿不到 CDP target: ' + rel);

    ws = new WebSocket(wsUrl);
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));

    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    });
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const myId = ++id;
        pending.set(myId, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
        ws.send(JSON.stringify({ id: myId, method, params }));
      });

    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
    });
    await send('Runtime.enable');
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      return r.result?.value;
    };

    console.log(`\n=== ${rel} ===`);
    for (let i = 0; i < 40; i++) {
      if (await ev(`!!document.querySelector('.app[data-shell] .nav-link')`)) break;
      await sleep(250);
    }

    const geom = () => ev(`(() => {
      const app = document.querySelector('.app');
      const sb = document.querySelector('.sidebar');
      const mn = document.querySelector('[data-menu]');
      const sc = document.querySelector('.scrim');
      const r = sb ? sb.getBoundingClientRect() : null;
      return {
        open: app && app.getAttribute('data-mobile-open') === 'true',
        menuVisible: !!(mn && getComputedStyle(mn).display !== 'none' && mn.offsetWidth > 0),
        sbRight: r ? Math.round(r.right) : null,
        sbWidth: r ? Math.round(r.width) : null,
        scrimShown: !!(sc && !sc.hidden && getComputedStyle(sc).display !== 'none'),
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
      };
    })()`);

    // 1) 初始状态
    let g = await geom();
    check('窄屏下汉堡按钮可见', g.menuVisible, JSON.stringify(g));
    check('侧栏默认在屏幕外', g.sbRight !== null && g.sbRight <= 1, `right=${g.sbRight}`);
    check('初始无遮罩', !g.scrimShown);

    // 2) 打开
    await ev(`document.querySelector('[data-menu]').click()`);
    await sleep(450);
    g = await geom();
    check('点汉堡 → 抽屉滑入', g.open && g.sbRight > 100, `open=${g.open} right=${g.sbRight}`);
    check('抽屉打开时出现遮罩', g.scrimShown);

    // 3) Esc 关闭
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(400);
    g = await geom();
    check('Esc → 收起', !g.open && g.sbRight <= 1, `open=${g.open} right=${g.sbRight}`);

    // 4) 打开后点导航项：换页 + 自动收起
    await ev(`document.querySelector('[data-menu]').click()`);
    await sleep(400);
    // 用「当前页标识」判断换页，而不是 hash：
    // 单文件版不带 hash 时路由渲染的是目录页，起始 hash 本来就是空的；
    // 多文件版点导航是真实加载新文档，hash 也可能被清空 —— 两种都会造成假失败。
    const pageMark = () => ev(isBundle
      ? `(document.getElementById('bb-page') || {}).textContent || ''`
      : `document.title`);
    const beforeMark = await pageMark();
    await ev(`document.querySelector('.nav-link:not([aria-current])').click()`);
    await sleep(1600);
    const afterMark = await pageMark();
    const alive = await ev(`!!document.querySelector('.app, .selector, .auth, #root, .content')`);
    check('点导航项后页面仍然可用', alive, alive ? '页面有内容' : '页面空白');
    console.log(`   [信息] 页面标识 ${beforeMark || '(空)'} → ${afterMark || '(空)'}`);
    g = await geom();
    // 导航目标可能落到目录页（本身没有侧栏），所以这里断言「新页面没有处于展开态」
    const drawerOpenAfterNav = await ev(`(() => {
      const a = document.querySelector('.app');
      return a ? a.getAttribute('data-mobile-open') === 'true' : false;
    })()`);
    check('换页后抽屉自动收起', !drawerOpenAfterNav, `open=${drawerOpenAfterNav}`);

    // 5) 遮罩点击关闭
    //    上一步的导航可能落到目录页（本身没有侧栏），先确保停在有外壳的内页，
    //    否则 .scrim / .app 都不存在，测出来的是假失败。
    if (!(await ev(`!!document.querySelector('.app')`))) {
      await ev(isBundle
        ? `location.hash = '#/pages/personal-alerts.html'`
        : `location.reload()`);
      await sleep(1600);
    }
    await ev(`document.querySelector('[data-menu]').click()`);
    await sleep(450);
    g = await geom();
    check('遮罩场景下能再次打开', g.open && g.sbRight > 100, `open=${g.open} right=${g.sbRight}`);
    await ev(`document.querySelector('.scrim').click()`);
    await sleep(400);
    g = await geom();
    check('点遮罩 → 收起', !g.open && g.sbRight <= 1, `open=${g.open} right=${g.sbRight}`);
    check('窄屏无横向溢出', g.overflowX <= 0, `溢出 ${g.overflowX}px`);

    if (isBundle) {
      // 核心回归：翻到第二页后，抽屉是否仍能打开（此前第二页绑定失效）
      await ev(`location.hash = '#/pages/personal-alerts.html'`);
      await sleep(1600);
      await ev(`location.hash = '#/pages/admin-alerts.html'`); // 第二跳，验的正是「翻页后仍可用」
      await sleep(1600);
      await ev(`document.querySelector('[data-menu]').click()`);
      await sleep(450);
      const g2 = await geom();
      check('单文件版翻页后抽屉仍可用', g2.open && g2.sbRight > 100, `open=${g2.open} right=${g2.sbRight}`);
      await ev(`document.querySelector('.scrim').click()`);
      await sleep(350);
    }

    ws.close();
    chrome.kill();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
    chrome = null; ws = null;
  }
} catch (e) {
  console.error('测试异常:', e.message);
  process.exitCode = 1;
} finally {
  if (ws) try { ws.close(); } catch { /* ignore */ }
  if (chrome) chrome.kill();
  if (profile) try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) process.exitCode = 1;
}
