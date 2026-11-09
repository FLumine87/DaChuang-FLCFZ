/**
 * 补充验证「稍后回复」语义：
 *   · 点「稍后回复」→ 弹窗关闭；
 *   · 当天再刷新 → 不再弹（用户已明确说"待会"）；
 *   · 但服务端仍是 pending → 页内「待回复」横幅里还在，随时能回；
 *   · 清掉本机标记（模拟第二天 / 换设备）→ 又能弹出。
 *
 * 用法（仓库任意位置）：node personal-backend/scripts/verify_checkin_later.mjs
 *
 * 关于 playwright 的引入方式：本仓库的 playwright-core 装在 frontend/node_modules，
 * 从 personal-backend/scripts 直接 `import 'playwright'` 解析不到（ERR_MODULE_NOT_FOUND），
 * 必须用 createRequire 从 frontend 目录解析 —— 与其余脚本保持一致。
 */
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pwPath = require.resolve('playwright-core', { paths: [path.join(repoRoot, 'frontend')] });
const pwMod = await import(pathToFileURL(pwPath).href);
const chromium = (pwMod.default ?? pwMod).chromium;
const APP = process.env.BASE_URL || 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const log = (...a) => console.log(...a);
let failed = 0;
const check = (n, ok, extra = '') => {
  log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? `  ${extra}` : ''}`);
  if (!ok) failed += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => log('  [pageerror]', String(e)));

/** 脚本里的裸 fetch 不会自动带 Authorization —— 8001 自第十轮起统一要求它，
    少了会 401（表现成"重置无效 / 读不到待回复数"，像功能坏了）。
    用 addInitScript 注入助手：每次导航后都会自动重建，不会被刷新冲掉。
    ⚠ 必须在**任何导航之前**注册，否则首次加载的页面里还没有这个函数。 */
await page.addInitScript(() => {
  window.__authInit = (extra = {}) => ({
    ...extra,
    headers: {
      ...(extra.headers ?? {}),
      Authorization: `Bearer ${localStorage.getItem('psych_token_persistent') ?? ''}`,
    },
  });
});

await page.goto(`${APP}/#/login`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /演示账号/ }).click();
await page.getByRole('button', { name: '登录并进入系统' }).click();
await page.waitForURL('**/personal/**', { timeout: 20000 }).catch(() => {});
await sleep(1200);

const reset = async () => {
  await page.evaluate(() => {
    localStorage.removeItem('psych_checkin_dismissed::xiaoyu');
    localStorage.removeItem('psych_checkin_declined::xiaoyu');
  });
  const id = await page.evaluate(async () => {
    const r = await fetch('/api/v1/checkin/ensure?user_id=xiaoyu&force=1', window.__authInit({ method: 'POST' }));
    return (await r.json()).checkin?.id ?? null;
  });
  await page.evaluate(() => {
    localStorage.removeItem('psych_checkin_dismissed::xiaoyu');
    localStorage.removeItem('psych_checkin_declined::xiaoyu');
  });
  return id;
};

const dialog = () => page.getByRole('dialog', { name: '今日关怀问询' });

/** 先把页面落在对话页（弹窗挂在这里），再做重置并重载 */
const gotoChatAndReload = async () => {
  await page.goto(`${APP}/#/personal/me/chat`, { waitUntil: 'networkidle' });
  await sleep(600);
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(2500);
};

const id = await reset();
log('重置后问询 id =', id);
await gotoChatAndReload();
check('弹窗出现', await dialog().isVisible().catch(() => false));

await dialog().getByRole('button', { name: '稍后回复' }).click();
await sleep(800);
check('点「稍后回复」后弹窗关闭', !(await dialog().isVisible().catch(() => false)));

/* 当天再刷新：不该再弹 */
await gotoChatAndReload();
check('当天刷新不再弹', !(await dialog().isVisible().catch(() => false)));

/* 但服务端仍是 pending，横幅里还在 */
const st = await page.evaluate(async () => {
  const r = await fetch('/api/v1/checkin/pending?user_id=xiaoyu', window.__authInit());
  const d = await r.json();
  return d.count;
});
check('服务端仍保留 pending（稍后可回）', st === 1, `pending=${st}`);
const banner = await page.getByText(/待回复/).count();
check('页内横幅仍显示待回复', banner > 0);

/* 清掉本机标记（模拟第二天）：应恢复弹出 */
await page.evaluate(() => {
  localStorage.removeItem('psych_checkin_dismissed::xiaoyu');
  localStorage.removeItem('psych_checkin_declined::xiaoyu');
});
await gotoChatAndReload();
check('清掉本机标记后恢复弹出', await dialog().isVisible().catch(() => false));

log(`\n结果：${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项失败`}`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
