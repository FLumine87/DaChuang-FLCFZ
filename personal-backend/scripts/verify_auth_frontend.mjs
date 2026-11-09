/**
 * 前端凭证注入回归验证（第 1/2 步的前端那一半）
 * ────────────────────────────────────────────────────────────────────────────
 * 后端侧（personal-backend/scripts/verify_auth.py）已经证明：
 *   无凭证 401 / 他人 403 / 本人 200，鉴权确实生效。
 *
 * 本脚本回答另一个必须单独验证的问题：**前端到底有没有把这枚凭证带上？**
 * 后端的鉴权做得再好，只要 api.ts 忘了注入 Authorization 头，
 * 用户看到的就是「所有个性化功能全部 401」。这两件事必须分别证明。
 *
 * 做法（不靠肉眼看页面）：
 *   1. 用真实账号登录，拿到真 token（走 8000 的登录接口）；
 *   2. 把 token 写进 localStorage（与 http.ts 的存储键一致）；
 *   3. 打开知识图谱页，**拦截 /api/v1/* 请求**，逐条检查请求头里
 *      有没有 `Authorization: Bearer <token>`；
 *   4. 同时确认这些请求的状态码不是 401/403 —— 即凭证真的被后端接受了。
 *
 * 反证：脚本额外发一次**不带** header 的同款请求，必须 401。
 * 若它也 200，说明后端鉴权没生效，前面的"通过"是假的。
 */
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pwPath = require.resolve('playwright-core', { paths: [path.join(repoRoot, 'frontend')] });
const pwMod = await import(pathToFileURL(pwPath).href);
const { chromium } = pwMod.default ?? pwMod;

const FRONT = process.env.FRONT_BASE || 'http://127.0.0.1:5173';
const API = process.env.MAIN_API || 'http://127.0.0.1:8000';
const PERSONAL = process.env.PERSONAL_API || 'http://127.0.0.1:8001';
const USER = 'xiaoyu';
const PASS = '123456';

let pass = 0;
const fails = [];
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  [OK]   ${name}${detail ? '  ' + detail : ''}`); }
  else { fails.push(name); console.log(`  [FAIL] ${name}  ${detail}`); }
}

const isDemo = process.argv.includes('--demo-guard');
if (isDemo) {
  console.log(`[demo-guard] 判定 ${FRONT}`);
  const r = await fetch(`${FRONT}/`).catch(() => null);
  const text = r ? await r.text() : '';
  const hasEntry = text.includes('id="root"') || text.includes('type="module"');
  console.log(hasEntry ? `[demo-guard] ${FRONT}` : `[demo-guard] ${FRONT}`);
  process.exit(hasEntry ? 0 : 1);
}

console.log(`前端凭证注入验证 → ${FRONT}\n`);

// 1) 拿真 token
const loginResp = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASS }),
});
const loginBody = await loginResp.json();
const token = loginBody?.data?.token;
check('登录取得真实 token', Boolean(token), token ? `len=${token.length}` : '');
if (!token) { console.log('\n无法登录，终止'); process.exit(1); }

// 反证：不带 header 直接打个人端，必须 401
const naked = await fetch(`${PERSONAL}/api/v1/kg/graph/${USER}`);
check('反证：无凭证直连个人端 → 401', naked.status === 401, `实际 ${naked.status}`);
check('反证：带 token 直连个人端 → 200',
  (await fetch(`${PERSONAL}/api/v1/kg/graph/${USER}`, {
    headers: { Authorization: `Bearer ${token}` },
  })).status === 200);

// 2) 打开页面，注入 token，拦截请求
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const seen = [];
await page.route('**/api/v1/**', async (route) => {
  const req = route.request();
  seen.push({ url: req.url(), auth: req.headers()['authorization'] || '' });
  await route.continue();
});

await page.goto(FRONT, { waitUntil: 'domcontentloaded' });
await page.evaluate((t) => {
  localStorage.setItem('psych_token_persistent', t);
}, token);

const statuses = [];
page.on('response', (r) => {
  if (r.url().includes('/api/v1/')) statuses.push({ url: r.url(), status: r.status() });
});

// 进图谱页（它一定会拉 /api/v1/kg/graph/<user>）
// 完整路由是 /personal/me/kg —— App.tsx 里 <Route path="/personal"> 下再挂 "me/kg"。
// 写错会被 catch-all 重定向回 /personal/dashboard，于是「一条请求都没发」，
// 看起来像"前端没带凭证"，其实是脚本进错了页面。
await page.goto(`${FRONT}/#/personal/me/kg`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);

const authCalls = seen.filter((s) => s.url.includes('/api/v1/'));
check('图谱页确实发起了 /api/v1 请求', authCalls.length > 0, `${authCalls.length} 条`);

const withoutAuth = authCalls.filter((s) => !s.auth.startsWith('Bearer '));
check('所有 /api/v1 请求都带了 Authorization 头',
  authCalls.length > 0 && withoutAuth.length === 0,
  withoutAuth.length ? `缺头 ${withoutAuth.length} 条：${withoutAuth[0].url}` : '');

const withToken = authCalls.filter((s) => s.auth === `Bearer ${token}`);
check('Authorization 里就是登录拿到的那枚 token', withToken.length > 0,
  `${withToken.length}/${authCalls.length}`);

const rejected = statuses.filter((s) => s.status === 401 || s.status === 403);
check('没有任何请求被 401/403 拒绝', rejected.length === 0,
  rejected.length ? `${rejected[0].status} ${rejected[0].url}` : '');

const okCount = statuses.filter((s) => s.status === 200).length;
check('存在 200 响应（凭证被后端接受）', okCount > 0, `${okCount} 条 200`);

console.log('\n  请求明细：');
for (const s of authCalls.slice(0, 8)) {
  const st = statuses.find((x) => x.url === s.url)?.status;
  console.log(`    ${st ?? '?'}  auth=${s.auth ? 'Bearer …' + s.auth.slice(-8) : '(无)'}  ${s.url.replace(FRONT, '')}`);
}

await browser.close();

const total = pass + fails.length;
console.log(`\n${'='.repeat(60)}`);
if (fails.length) {
  console.log(`结果：${pass}/${total} 通过，${fails.length} 条失败`);
  for (const f of fails) console.log(`  · ${f}`);
  process.exit(1);
}
console.log(`结果：${pass}/${total} 全部通过`);
