/**
 * 验证：危机信号在对话页真的会渲染出求助指引。
 *
 * 为什么必须用浏览器验：后端的 crisis_hits 只证明"接口返回了"，
 * 证明不了"用户看得见"。这条链路上的任何一环（类型没接上、条件写错、
 * 被别的分支遮住）都会让安全提示静默消失，而接口测试全绿。
 *
 * 可证伪：把 ChatPage 里 crisis_hits 那段 JSX 删掉，本脚本必须失败。
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..', '..');
const pwPath = require.resolve('playwright-core', { paths: [path.join(repoRoot, 'frontend')] });
const { chromium } = (await import(pathToFileURL(pwPath).href)).default;

const FRONT = 'http://127.0.0.1:5173';
const MAIN = 'http://127.0.0.1:8000';
const PERSONAL = 'http://127.0.0.1:8001';
const USER = 'xiaoyu';
const PASSWORD = '123456';

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  [OK] ${name}${detail ? '  ' + detail : ''}`); }
  else { failed++; console.log(`  [FAIL] ${name}  ${detail}`); }
}

/** 清理本脚本写入图谱的测试节点。
 *
 * 为什么必须清理：这条用例是**真实**走了一遍危机链路 —— 用户消息会被
 * /kg/extract 写进生产图谱。若不删，xiaoyu 的图谱里就永久留着一个
 * "自杀意念"节点，之后每次推理都会报 crisis，把真实数据污染成假警报。 */
async function cleanup(token) {
  try {
    const res = await fetch(`${PERSONAL}/api/v1/kg/node/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ user_id: USER, node_id: 'Symptom:自杀意念' }),
    });
    console.log(`\n[清理] 测试节点删除 → HTTP ${res.status}`);
  } catch (e) {
    console.log(`\n[清理] 失败（请手动删除 xiaoyu 的「自杀意念」节点）：${e.message}`);
  }
}

const login = await fetch(`${MAIN}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASSWORD }),
});
const token = (await login.json()).data.token;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(FRONT, { waitUntil: 'domcontentloaded' });
await page.evaluate((t) => localStorage.setItem('psych_token_persistent', t), token);
await page.goto(`${FRONT}/#/personal/me/chat`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);

const textarea = page.locator('textarea').first();
await textarea.fill('我最近真的很想死，活不下去了');
await textarea.press('Enter');

// 危机提示来自 /kg/extract 的后台响应，抽取本身要调 LLM，留足时间
await page.waitForTimeout(20000);

const body = await page.locator('body').innerText();
console.log('\n[1] 用户消息发出后的即时安全提示（来自 /kg/extract 的 crisis_hits）');
check('出现危机关怀文案', /谢谢你愿意说出来/.test(body), '');
check('给出 12356 求助热线', /12356/.test(body), '');

console.log('\n[2] 提示位置在"已抽取"结果之前（优先级更高）');
const idxCrisis = body.indexOf('谢谢你愿意说出来');
const idxExtract = body.indexOf('已抽取');
check('危机提示排在抽取结果之前',
  idxCrisis >= 0 && (idxExtract < 0 || idxCrisis < idxExtract),
  `crisis@${idxCrisis} extract@${idxExtract}`);

await page.screenshot({ path: path.join(repoRoot, '_shots', 'crisis_notice.png'), fullPage: true });

await cleanup(token);

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
await browser.close();
process.exit(failed ? 1 : 0);