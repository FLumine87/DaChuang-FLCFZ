#!/usr/bin/env node
/**
 * e2e-profile-name.mjs · 端到端验证「档案页显示名」
 * -----------------------------------------------------------------------------
 * 为什么用 CDP 而不是 dump-dom：localStorage 按源隔离，从 file:// 预置登录态
 * 在 http://localhost 下读不到；必须真的走一遍登录，才能验证
 * 「登录 → 存名字 → 档案页显示」这条链路。
 *
 * 前置：dev server 已在 5180 运行、后端在 8000 运行。
 * 用法：node scripts/e2e-profile-name.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP = 'http://localhost:5180';
const PORT = 9333;

const profile = mkdtempSync(path.join(tmpdir(), 'e2e-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1440,900', `${APP}/`,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('拿不到 CDP target');
}

let id = 0;
function makeSend(ws) {
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const myId = ++id;
      pending.set(myId, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

try {
  const wsUrl = await targetWs();
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  const send = makeSend(ws);
  await send('Runtime.enable');

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return r.result?.value;
  };

  // 等 React 挂载
  for (let i = 0; i < 40; i++) {
    if (await evaluate(`!!document.querySelector('input')`)) break;
    await sleep(250);
  }

  // 1) 用真实表单登录（按 id 定位，避免猜选择器；直接 submit 触发 onSubmit）
  const loggedIn = await evaluate(`(async () => {
    const setVal = (el, v) => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const user = document.getElementById('username');
    const pass = document.getElementById('password');
    if (!user || !pass) return 'no-inputs:' + [...document.querySelectorAll('input')].map(i => i.id || i.type).join(',');
    setVal(user, 'xiaoyu');
    setVal(pass, '123456');
    await new Promise(r => setTimeout(r, 200));
    const form = user.closest('form');
    if (!form) return 'no-form';
    form.requestSubmit();
    await new Promise(r => setTimeout(r, 3000));
    const alert = document.querySelector('[role=alert], .text-danger-600, .text-danger-500');
    return 'submitted' + (alert ? '|err=' + alert.textContent.trim().slice(0, 60) : '');
  })()`);
  check('走完登录表单', String(loggedIn).startsWith('submitted'), loggedIn);

  // 2) 登录是否真的拿到会话
  const token = await evaluate(`localStorage.getItem('psych_token_persistent') || sessionStorage.getItem('psych_token_temp')`);
  check('拿到会话 token', !!token, token ? token.slice(0, 24) + '…' : '(空)');

  // 3) 关键：显示名有没有被存下来
  const storedName = await evaluate(`localStorage.getItem('psych_user_name')`);
  check('登录后存下显示名', !!storedName, JSON.stringify(storedName));

  // 4) 档案接口返回什么（判断后端是否已重载）
  const apiName = await evaluate(`(async () => {
    const t = localStorage.getItem('psych_token_persistent');
    const r = await fetch('/api/personal/profile', { headers: { Authorization: 'Bearer ' + t } });
    const j = await r.json();
    return j?.data?.userProfile?.name ?? null;
  })()`);
  check('档案接口返回 name', apiName !== null, JSON.stringify(apiName));

  // 5) 档案页实际渲染出来的名字
  await evaluate(`location.hash = '#/personal/cases'`);
  await sleep(2500);
  // 用结构定位而不是文本特征：标题「我的心理档案」的下一个 p 就是副标题
  const shown = await evaluate(`(() => {
    const h = [...document.querySelectorAll('h2')].find(x => (x.textContent || '').includes('我的心理档案'));
    const p = h && h.nextElementSibling;
    return p ? p.textContent.trim() : null;
  })()`);
  check('档案页渲染出显示名', !!shown, shown);

  const good = shown && !shown.startsWith('用户 ·') && shown.includes(storedName || '\u0000');
  check('显示名不是占位符「用户」', !!good, good ? '' : `实际: ${shown}`);

  // 空字段不应留下连续的「· ·」，年龄未知时也不该显示「0 岁」
  check('副标题没有空字段残留', !!shown && !/·\s*·/.test(shown) && !/0 岁/.test(shown), shown);

  ws.close();
} catch (e) {
  console.error('测试异常:', e.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) process.exitCode = 1;
}
