#!/usr/bin/env node
/**
 * shot-mobile.mjs · 手机视口截图（含抽屉打开态）
 * 用法：node scripts/shot-mobile.mjs
 * 产物：screenshots/mobile-*.png
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'screenshots');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9366;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const JOBS = [
  { name: 'mobile-bundle-closed', url: `file://${ROOT}/原型-单文件.html#/pages/personal-alerts.html`, drawer: false },
  { name: 'mobile-bundle-drawer', url: `file://${ROOT}/原型-单文件.html#/pages/personal-alerts.html`, drawer: true },
  { name: 'mobile-multifile-drawer', url: `file://${ROOT}/pages/admin-dashboard.html#light`, drawer: true },
];

mkdirSync(OUT, { recursive: true });

let chrome, profile, ws;
try {
  for (const job of JOBS) {
    profile = mkdtempSync(path.join(tmpdir(), 'shot-'));
    chrome = spawn(CHROME, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter',
      `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
      '--window-size=390,844', job.url,
    ], { stdio: 'ignore' });

    let wsUrl;
    for (let i = 0; i < 40; i++) {
      try {
        const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        const t = l.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
        if (t) { wsUrl = t.webSocketDebuggerUrl; break; }
      } catch { /* wait */ }
      await sleep(250);
    }
    ws = new WebSocket(wsUrl);
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));

    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    });
    const send = (method, params = {}) =>
      new Promise((res, rej) => {
        const i = ++id;
        pending.set(i, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
        ws.send(JSON.stringify({ id: i, method, params }));
      });

    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Runtime.enable');
    await sleep(1800);

    if (job.drawer) {
      await send('Runtime.evaluate', { expression: `document.querySelector('[data-menu]')?.click()` });
      await sleep(600);
    }
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = path.join(OUT, `${job.name}.png`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log('已写', path.relative(ROOT, file));

    ws.close(); chrome.kill();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
    chrome = null; ws = null;
  }
} catch (e) {
  console.error('截图失败:', e.message);
  process.exitCode = 1;
} finally {
  if (ws) try { ws.close(); } catch { /* ignore */ }
  if (chrome) chrome.kill();
  if (profile) try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}
