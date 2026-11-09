/**
 * verify_kg_delete_flow.mjs · 知识图谱「删除节点」的端到端数据流验证
 *
 * 为什么单独一个脚本：上一个综合脚本只验证到"确认弹窗出现过"就取消了，
 * 没有验证"点确认后数据真的少了"。删除是破坏性操作，光看到按钮不算数，
 * 必须确认它真删了、且删得对（只删该节点，不误伤别的记录）。
 *
 * 做法（刻意不碰任何账号真实数据的服务端部分）：
 *   1. 登录后往 localStorage 注入 3 条**本机**三元组（L1 层，图谱页会画出来）；
 *   2. 打开图谱页，确认这 3 个节点出现；
 *   3. 选中其中一个，走"删除节点 → 确认删除"的真实交互；
 *   4. 校验：该节点从图上消失、localStorage 里只剩 2 条、另外 2 个节点还在；
 *   5. 收尾：把注入的本机记录恢复成原样（不留下测试垃圾）。
 *
 * 服务端那条边（Neo4j）在测试里通常 deleted=0（这些名字是测试专用的），
 * 所以整个测试对服务端零影响 —— 跨用户隔离另由后端脚本单独验证过。
 */

import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
/* 本文件位于 <repo>/personal-backend/scripts/，frontend 在 <repo>/frontend */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const frontendDir = process.env.FRONTEND_DIR || path.join(repoRoot, 'frontend');
const pwPath = require.resolve('playwright-core', { paths: [frontendDir] });
const pwMod = await import(pathToFileURL(pwPath).href);
const chromium = (pwMod.default ?? pwMod).chromium;

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const USER = process.env.TEST_USER || 'xiaoyu';
const PASS = process.env.TEST_PASS || '123456';

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${extra ? '  ' + extra : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? '  ' + extra : ''}`);
  }
};

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-proxy-server', '--disable-proxy-config'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

/** 注入的测试节点名：起得与真实数据明显不同，便于识别与清理 */
const NODES = ['测试节点甲', '测试节点乙', '测试节点丙'];
const KEY = `psych_kg:v1:${USER}`;

try {
  console.log('\n[1] 登录并注入本机测试三元组');
  await page.goto(`${BASE}/#/auth`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const inputs = page.locator('input');
  await inputs.nth(0).fill(USER);
  await inputs.nth(1).fill(PASS);
  await page.getByRole('button', { name: /登录|进入/ }).first().click();
  await page.waitForTimeout(2500);

  /* 记下原始本机记录，测完原样恢复 */
  const original = await page.evaluate((k) => localStorage.getItem(k), KEY);

  const injected = await page.evaluate(
    ({ k, names }) => {
      const now = new Date().toISOString();
      const store = {
        triples: names.map((n) => ({ head: '我', relation: 'LIKES', tail: n, at: now, category: '音乐' })),
        updatedAt: now,
      };
      localStorage.setItem(k, JSON.stringify(store));
      return JSON.parse(localStorage.getItem(k) || '{}').triples.length;
    },
    { k: KEY, names: NODES },
  );
  ok('注入 3 条本机三元组', injected === 3, `${injected} 条`);

  console.log('\n[2] 图谱页渲染这 3 个节点');
  await page.goto(`${BASE}/#/personal/me/kg`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  /* 重新挂载只读一次本机数据，用 reload 确保拿到刚注入的内容 */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const before = await page.evaluate((names) => {
    const svg = document.querySelector('svg[viewBox="0 0 900 560"]');
    const texts = svg ? [...svg.querySelectorAll('text')].map((t) => t.textContent?.trim()) : [];
    return {
      total: texts.length,
      found: names.filter((n) => texts.includes(n)),
    };
  }, NODES);
  ok('3 个测试节点全部出现在图上', before.found.length === 3, JSON.stringify(before.found));

  console.log('\n[3] 选中并删除「测试节点乙」（走真实交互）');
  const targetPos = await page.evaluate((name) => {
    const svg = document.querySelector('svg[viewBox="0 0 900 560"]');
    if (!svg) return null;
    const text = [...svg.querySelectorAll('text')].find((t) => t.textContent?.trim() === name);
    const g = text?.closest('g[transform^="translate"]');
    if (!g) return null;
    const m = (g.getAttribute('transform') ?? '').match(/translate\(([-\d.]+),([-\d.]+)\)/);
    if (!m) return null;
    /* 用户坐标 → 屏幕坐标走 getScreenCTM()，不按 box.width/900 手算：
       图谱页已改成"撑满一屏"，卡片宽高比不再等于 900:560，preserveAspectRatio
       的 meet 会留下一条居中的空白带；手算会偏掉半条带（实测 74px），点到别处。 */
    const p = new DOMPoint(Number(m[1]), Number(m[2])).matrixTransform(svg.getScreenCTM());
    return { x: p.x, y: p.y };
  }, NODES[1]);

  ok('能定位到目标节点', targetPos !== null, JSON.stringify(targetPos));

  await page.mouse.click(targetPos.x, targetPos.y);
  await page.waitForTimeout(800);
  const selectedName = await page.evaluate(() => {
    /* 详情区域的结构是：节点：<名字> <span>类型</span>，中间没有空格，
       所以不能按 \s 截断（会把"测试节点乙兴趣"整串取出来）。
       用"节点："后的原文 + 已知节点名做前缀匹配更稳。 */
    const text = document.body.textContent ?? '';
    const m = text.match(/节点：(.*?)播放|节点：([^\s]+)/);
    const raw = (m?.[2] ?? '').trim();
    return raw;
  });
  /* 前缀匹配：详情里名字后面直接跟着类型标签（如「兴趣」），用 startsWith 判定 */
  ok(
    '选中的正是「测试节点乙」',
    Boolean(selectedName) && selectedName.startsWith(NODES[1]),
    `选中=${selectedName}`,
  );

  await page.getByRole('button', { name: '删除节点' }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: '确认删除' }).first().click();
  await page.waitForTimeout(2500);

  console.log('\n[4] 校验删除结果');
  const after = await page.evaluate(
    ({ k, names }) => {
      const raw = JSON.parse(localStorage.getItem(k) || '{"triples":[]}');
      const svg = document.querySelector('svg[viewBox="0 0 900 560"]');
      const texts = svg ? [...svg.querySelectorAll('text')].map((t) => t.textContent?.trim()) : [];
      return {
        stored: raw.triples.map((t) => t.tail),
        onGraph: names.filter((n) => texts.includes(n)),
      };
    },
    { k: KEY, names: NODES },
  );

  ok('本机记录里「测试节点乙」已被删除', !after.stored.includes(NODES[1]), JSON.stringify(after.stored));
  ok('本机记录剩 2 条', after.stored.length === 2, `${after.stored.length} 条`);
  ok('另外两个节点未被误删', after.stored.includes(NODES[0]) && after.stored.includes(NODES[2]));
  ok('图上「测试节点乙」已消失', !after.onGraph.includes(NODES[1]), JSON.stringify(after.onGraph));

  console.log('\n[5] 恢复原始本机记录（不留测试垃圾）');
  await page.evaluate(
    ({ k, orig }) => {
      if (orig === null) localStorage.removeItem(k);
      else localStorage.setItem(k, orig);
    },
    { k: KEY, orig: original },
  );
  const restored = await page.evaluate((k) => localStorage.getItem(k), KEY);
  ok('本机记录已还原', restored === original);

  const real = errors.filter(
    (t) => !/favicon|Download the React DevTools/i.test(t),
  );
  ok('无控制台错误', real.length === 0, real.slice(0, 3).join(' | '));
} catch (e) {
  fail++;
  console.log(`\n✗ 脚本异常: ${e.message}`);
  console.log(e.stack?.split('\n').slice(0, 5).join('\n'));
} finally {
  await browser.close();
}

console.log(`\n───────────────────────────────`);
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
