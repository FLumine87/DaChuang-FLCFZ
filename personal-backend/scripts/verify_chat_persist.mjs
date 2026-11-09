/**
 * 浏览器端到端验证：AI 陪伴对话的「聊天记录持久化 + 清空」。
 *
 * 验证目标（用户 2026-11-07 提的问题）：
 *   原来离开页面再进来，聊天记录会清空。改造后应满足：
 *     1. 发消息后刷新 / 路由往返，记录仍在；
 *     2. 清空记录 → 只清对话，知识图谱条目不受影响；
 *     3. 清空后刷新，确认真的删了；
 *     4. 换用户登录，看不到他人聊天记录（键按用户隔离）。
 *
 * 用法：
 *   node personal-backend/scripts/verify_chat_persist.mjs
 *
 * 依赖解析说明（2026-11-08）：原来直接 `import { chromium } from 'playwright'`，
 * 但 playwright 只装在 frontend/node_modules 下，而 ESM 的裸包名解析是相对
 * **脚本文件所在目录**（personal-backend/scripts/）往上找 node_modules，
 * 于是从仓库根或 frontend 目录运行都会 ERR_MODULE_NOT_FOUND。
 * 改成与 verify_roaming_bot_v3.mjs 一致的写法：用 createRequire 从 frontend
 * 目录解析 playwright-core，再动态 import —— 从任意位置运行都能找到。
 */
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const frontendDir = process.env.FRONTEND_DIR || path.join(repoRoot, 'frontend');
const pwPath = require.resolve('playwright-core', { paths: [frontendDir] });
const pwMod = await import(pathToFileURL(pwPath).href);
const chromium = (pwMod.default ?? pwMod).chromium;

const APP = 'http://localhost:5173';
const CHROME = process.env.CHROME_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.join(frontendDir, '.verify-tmp', '_shots');
mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log(...a);
let failed = 0;
const check = (name, ok, extra = '') => {
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
  if (!ok) failed += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

/** 登录：普通入口用「演示账号」预填 xiaoyu/123456；admin 走 ?panel=admin */
async function login(which) {
  const isAdmin = which === 'admin';
  const url = isAdmin ? `${APP}/#/login?panel=admin` : `${APP}/#/login`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: isAdmin ? /管理端 · 咨询师/ : /演示账号/ }).click();
  await page.getByRole('button', { name: isAdmin ? '进入管理端' : '登录并进入系统' }).click();
  await page.waitForURL('**/personal/**', { timeout: 25000 }).catch(() => {});
  await sleep(1200);
}

const gotoChat = async () => {
  await page.goto(`${APP}/#/personal/me/chat`, { waitUntil: 'networkidle' });
  await sleep(1800);
  /* 每日问询弹窗可能盖在页面上（z-[70]）：先关掉再操作聊天区 */
  const later = page.getByRole('button', { name: '稍后再答' });
  if (await later.isVisible().catch(() => false)) {
    await later.click();
    await sleep(500);
  }
};

/**
 * 预置「今天已触发过问询」标记，让 DailyCheckinGate 不再弹窗。
 * 本脚本验证的是聊天记录持久化，不该被问询弹窗干扰。
 */
const suppressCheckinDialog = async (user) => {
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate(
    ([u, d]) => {
      localStorage.setItem(`psych_checkin_declined::${u}`, d);
      localStorage.setItem(`psych_checkin_dismissed::${u}`, d);
    },
    [user, today],
  );
};

const bubbles = () => page.locator('.chat-fullheight p.whitespace-pre-wrap');
const MSG = '我最近在准备考试，压力挺大的，晚上老是失眠。';
const MSG_KEY = MSG.slice(0, 10);

try {
  await login('user');
  log('[1] 登录成功，落在', page.url());

  /* 从已知状态开始：清掉本机聊天记录后重载 */
  await page.evaluate(() => localStorage.removeItem('psych_chat:v1:xiaoyu'));
  await suppressCheckinDialog('xiaoyu');
  await gotoChat();
  const before = await bubbles().count();
  log(`[2] 清空后初始气泡数 = ${before}`);

  /* 发一条消息 */
  await page.locator('textarea').fill(MSG);
  await page.getByRole('button', { name: '发送' }).click();
  await sleep(10000);
  const afterSend = await bubbles().count();
  const hasUser = await page.getByText(MSG_KEY).count();
  check('发送后消息数增加', afterSend > before, `before=${before} after=${afterSend}`);
  check('用户消息已在页面', hasUser > 0);
  const lsLen = await page.evaluate(() => {
    const raw = localStorage.getItem('psych_chat:v1:xiaoyu');
    return raw ? JSON.parse(raw).messages.length : 0;
  });
  check('已写入 localStorage(psych_chat:v1:xiaoyu)', lsLen >= 2, `${lsLen} 条`);
  await page.screenshot({ path: `${OUT}/chat-01-sent.png` });

  /* 核心：刷新（等价离开页面后重进系统） */
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(2200);
  const hasAfterReload = await page.getByText(MSG_KEY).count();
  check('刷新后记录仍在（本次修复的核心）', hasAfterReload > 0);
  await page.screenshot({ path: `${OUT}/chat-02-after-reload.png` });

  /* 路由往返：切到图谱页再回来 */
  await page.goto(`${APP}/#/personal/kg`, { waitUntil: 'networkidle' });
  await sleep(1500);
  await gotoChat();
  check('路由往返后记录仍在', (await page.getByText(MSG_KEY).count()) > 0);

  /* 清空前后的图谱条数对比 */
  const kgBefore = await page.evaluate(() => {
    const raw = localStorage.getItem('psych_kg:v1:xiaoyu');
    return raw ? JSON.parse(raw).triples.length : 0;
  });
  log(`[3] 清空前本机图谱条数 = ${kgBefore}`);

  /* 清空记录 */
  const clearBtn = page.getByRole('button', { name: /清空记录/ });
  check('清空按钮可见', (await clearBtn.count()) > 0);
  await clearBtn.click();
  await sleep(700);
  await page.screenshot({ path: `${OUT}/chat-03-confirm.png` });
  await page.getByRole('button', { name: '确认清空' }).click();
  await sleep(1200);

  const afterClear = await bubbles().count();
  const stillHas = await page.getByText(MSG_KEY).count();
  check('清空后回到欢迎语', afterClear === 1 && stillHas === 0, `气泡数 ${afterClear}`);
  const lsAfter = await page.evaluate(() => {
    const raw = localStorage.getItem('psych_chat:v1:xiaoyu');
    return raw ? JSON.parse(raw).messages.length : -1;
  });
  check('localStorage 中已删除', lsAfter <= 1, `length=${lsAfter}`);
  const kgAfter = await page.evaluate(() => {
    const raw = localStorage.getItem('psych_kg:v1:xiaoyu');
    return raw ? JSON.parse(raw).triples.length : 0;
  });
  check('清空对话不影响知识图谱', kgAfter === kgBefore, `前 ${kgBefore} → 后 ${kgAfter}`);

  /* 清空后刷新 */
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(2200);
  check('清空刷新后不再出现', (await page.getByText(MSG_KEY).count()) === 0);
  await page.screenshot({ path: `${OUT}/chat-04-cleared.png` });

  /* 用户隔离 */
  await page.evaluate(() => localStorage.removeItem('psych_chat:v1:adminer'));
  await login('admin');
  await suppressCheckinDialog('adminer');
  await gotoChat();
  check('换用户后看不到他人聊天记录', (await page.getByText(MSG_KEY).count()) === 0);

  log('\n页面错误：', errors.length ? errors.slice(0, 4) : '无');
  log(`\n结果：${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项失败`}`);
} catch (e) {
  log('[!] 验证中断：', e.message);
  await page.screenshot({ path: `${OUT}/99-failure.png` }).catch(() => {});
  failed += 1;
} finally {
  await browser.close();
  process.exit(failed === 0 ? 0 : 1);
}
