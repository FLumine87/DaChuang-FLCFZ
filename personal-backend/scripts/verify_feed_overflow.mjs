/**
 * 个性化推送 / 对话页「文字超出边框」回归验证
 * ────────────────────────────────────────────────────────────────────────────
 * 用户反馈（2026-11-08）：兴趣推送里那条《秦皇岛》的建议，末尾带一个程序拼接的
 * 网易云搜索链接：
 *     https://music.163.com/#/search/m/?s=%E7%A7%A6%E7%9A%87%E5%B2%9B%20...
 * 整串百分号编码、没有任何空格，在默认的 overflow-wrap: normal 下不会在词内断行，
 * 于是横向顶出了卡片右边界。
 *
 * 本脚本不去“读截图猜”，而是**直接量边界**：
 *   · 对每条建议/理由文本，比它的 client rect 与所在卡片、以及可滚动容器的右边界；
 *   · 同时用 Range 量文本行的实际宽度，判断是否有内容溢出行盒。
 *
 * 关键设计：不依赖后端真的返回那条带链接的文案（演示模式/网络都可能变），
 * 而是**在页面里注入一条构造好的超长链接文本**再量 —— 这样无论后端返回什么，
 * 都能稳定地验证“长串可折行”这个 CSS 契约。
 */
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pwPath = require.resolve('playwright-core', { paths: [path.join(repoRoot, 'frontend')] });
const pwMod = await import(pathToFileURL(pwPath).href);
const chromium = (pwMod.default ?? pwMod).chromium;

const BASE = 'http://localhost:5173';
const USER = 'xiaoyu';
const PASS = '123456';

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-proxy-server', '--disable-proxy-config'],
});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));

/* ── 登录 ─────────────────────────────────────────────────────────────── */
await page.goto(`${BASE}/#/auth`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const inputs = page.locator('input');
await inputs.nth(0).fill(USER);
await inputs.nth(1).fill(PASS);
await page.getByRole('button', { name: /登录|进入/ }).first().click();
await page.waitForTimeout(2500);

/**
 * 在指定的**建议条目**里注入一段复刻真实数据的超长链接文本，再逐条量边界。
 * 选择器必须精确到条目内的正文段落（FeedItems 里是 p.whitespace-pre-wrap）——
 * 早先图省事用 `.ui-card p` 量到了页头那句副标题，得到的是假失败。
 */
async function injectAndMeasure(itemSel, textSel) {
  return page.evaluate(
    ({ itemSel, textSel }) => {
      const LONG =
        '《秦皇岛》－ 万能青年旅店（https://music.163.com/#/search/m/?s=%E7%A7%A6%E7%9A%87%E5%B2%9B%20%E4%B8%87%E8%83%BD%E9%9D%92%E5%B9%B4%E6%97%85%E5%BA%97&type=1）';
      const texts = [...document.querySelectorAll(textSel)];
      if (!texts.length) return { error: 'no text nodes' };

      /* 给第一条文本追加超长串（直接改 DOM 文本，React 不管这次改动）。
         打上标记，便于后续按"确属被注入的那条"来判定，而不是靠文本里恰好出现某个词
         （后端每次生成的内容不同，早先按「秦皇岛」找就落空了）。 */
      const first = texts[0];
      first.textContent = first.textContent + ' ' + LONG;
      first.dataset.injectedLong = '1';

      const report = [];
      for (const el of texts) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = [...range.getClientRects()].filter((x) => x.width > 0.5);
        const contentRight = rects.length ? Math.max(...rects.map((x) => x.right)) : el.getBoundingClientRect().right;
        const contentLeft = rects.length ? Math.min(...rects.map((x) => x.left)) : el.getBoundingClientRect().left;

        /* 向上找最近的一层“条目卡片”（有边框的那个）作为参照 */
        let card = el.closest(itemSel);
        const cr = card?.getBoundingClientRect() ?? null;

        report.push({
          text: (el.textContent ?? '').slice(0, 24),
          injected: el.dataset.injectedLong === '1',
          contentLeft: +contentLeft.toFixed(1),
          contentRight: +contentRight.toFixed(1),
          cardLeft: cr ? +cr.left.toFixed(1) : null,
          cardRight: cr ? +cr.right.toFixed(1) : null,
          overflowWrap: getComputedStyle(el).overflowWrap,
          wordBreak: getComputedStyle(el).wordBreak,
          scrollOverflow: el.scrollWidth - el.clientWidth,
          lines: rects.length,
        });
      }
      return { report };
    },
    { itemSel, textSel },
  );
}

/* ══ [1] 个性化推送 ══════════════════════════════════════════════════════ */
console.log('\n[1] 个性化推送 · 兴趣推送长链接换行');
await page.goto(`${BASE}/#/personal/me/feed`, { waitUntil: 'domcontentloaded' });
/* 推送页的正文来自 /api/v1/inference/run，真实 LLM 调用实测耗时 ~25s。
   固定等待会取样在半路（此前只等 3.5s，量到的是空页，误报成"没渲染"）。
   改成轮询：等到正文出现，或超时再判定。 */
await page
  .waitForFunction(() => document.querySelectorAll('p.whitespace-pre-wrap').length > 0, null, { timeout: 90000 })
  .catch(() => {});
await page.waitForTimeout(600);
/* 切到「兴趣推送」标签（那条带音乐链接的建议在这里） */
const interestTab = page.getByRole('button', { name: /兴趣推送/ }).first();
if (await interestTab.count()) {
  await interestTab.click();
  await page.waitForTimeout(1500);
}

/* 条目正文 = FeedItems 里的 <p class="…whitespace-pre-wrap…">；条目卡片 = 带边框的那层 div */
const feedRes = await injectAndMeasure('div.border.rounded-xl', 'p.whitespace-pre-wrap');
ok('个性化推送页渲染出建议文本', !feedRes.error, feedRes.error ?? `${feedRes.report?.length ?? 0} 条`);

if (feedRes.report) {
  const rows = feedRes.report;
  /* 1.1 CSS 契约：所有文本都必须允许超长串折行 */
  const allBreakable = rows.every((r) => r.overflowWrap === 'break-word' || r.wordBreak === 'break-all');
  ok(
    '所有文本均允许超长串折行（overflow-wrap: break-word）',
    allBreakable,
    rows.map((r) => r.overflowWrap).join(','),
  );

  /* 1.2 无横向溢出：内容右边界不得超出卡片右边界 */
  const overflowing = rows.filter((r) => r.cardRight !== null && r.contentRight > r.cardRight + 0.5);
  ok(
    '无文本横向越出卡片右边界',
    overflowing.length === 0,
    overflowing.length
      ? overflowing.map((r) => `「${r.text}」${r.contentRight.toFixed(0)}>${r.cardRight.toFixed(0)}`).join(' ')
      : `${rows.length} 条全部在框内`,
  );

  /* 1.3 元素自身不产生横向滚动 */
  const scrollers = rows.filter((r) => r.scrollOverflow > 1);
  ok(
    '元素自身无横向滚动（scrollWidth ≈ clientWidth）',
    scrollers.length === 0,
    scrollers.length ? scrollers.map((r) => `${r.text}:+${r.scrollOverflow}px`).join(' ') : '',
  );

  /* 1.4 长链接确实参与了折行：被注入超长串的那条应占多行（不能整串撑成一行） */
  const longOne = rows.find((r) => r.injected);
  ok(
    '含长链接的文本被折成多行',
    longOne ? longOne.lines >= 2 : false,
    longOne ? `${longOne.lines} 行（内容宽 ${(longOne.contentRight - longOne.contentLeft).toFixed(0)}px）` : '未注入',
  );

  /* 1.5 反证：把折行规则撤掉，同一条文本必须**确实**溢出。
     没有这一步，"没溢出"可能只是碰巧（比如这轮内容恰好短），无法说明是修复在起作用。
     撤掉规则后能复现溢出 → 证明上面的"未溢出"是 break-words 的结果，而非侥幸。 */
  const falsify = await page.evaluate(() => {
    const el = document.querySelector('p.whitespace-pre-wrap[data-injected-long="1"]');
    if (!el) return { error: 'no injected node' };
    const old = el.style.overflowWrap;
    el.style.overflowWrap = 'normal';
    el.style.wordBreak = 'normal';
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((x) => x.width > 0.5);
    const right = rects.length ? Math.max(...rects.map((x) => x.right)) : 0;
    let card = el.closest('div.border.rounded-xl');
    const cardRight = card?.getBoundingClientRect().right ?? 0;
    el.style.overflowWrap = old;
    return { overflow: +(right - cardRight).toFixed(1) };
  });
  ok(
    '反证：撤掉折行规则后确实溢出（证明本测试可证伪）',
    !falsify.error && falsify.overflow > 1,
    falsify.error ?? `撤掉后溢出 ${falsify.overflow}px`,
  );

  /* 1.6 整页无横向滚动条（不被长链接撑宽） */
  const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('页面无横向滚动条', docOverflow <= 1, `溢出 ${docOverflow}px`);
}

/* ══ [2] 对话页同源文案 ══════════════════════════════════════════════════ */
console.log('\n[2] AI 陪伴对话 · 同源推荐文案换行');
await page.goto(`${BASE}/#/personal/me/chat`, { waitUntil: 'domcontentloaded' });
await page
  .waitForFunction(() => document.querySelectorAll('p.whitespace-pre-wrap').length > 0, null, { timeout: 60000 })
  .catch(() => {});
await page.waitForTimeout(600);

const chatRes = await injectAndMeasure('div.ui-card', 'p.whitespace-pre-wrap');
ok('对话页有可测量的文本容器', !chatRes.error, chatRes.error ?? `${chatRes.report?.length ?? 0} 条`);
if (chatRes.report) {
  const rows = chatRes.report.filter((r) => r.cardRight !== null);
  const overflowing = rows.filter((r) => r.contentRight > r.cardRight + 0.5);
  ok(
    '对话页无文本横向越出卡片右边界',
    overflowing.length === 0,
    overflowing.length ? overflowing.map((r) => `「${r.text}」`).join(' ') : `${rows.length} 条在框内`,
  );
  const docOverflow2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('对话页无横向滚动条', docOverflow2 <= 1, `溢出 ${docOverflow2}px`);
}

/* ══ [3] 截图留证 + console ═════════════════════════════════════════════ */
console.log('\n[3] 截图与 console');
await page.goto(`${BASE}/#/personal/me/feed`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
if (await page.getByRole('button', { name: /兴趣推送/ }).count()) {
  await page.getByRole('button', { name: /兴趣推送/ }).first().click();
  await page.waitForTimeout(1200);
}
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.ui-card p')].find((p) => (p.textContent ?? '').length > 20);
  if (el) {
    el.textContent +=
      ' 《秦皇岛》－ 万能青年旅店（https://music.163.com/#/search/m/?s=%E7%A7%A6%E7%9A%87%E5%B2%9B%20%E4%B8%87%E8%83%BD%E9%9D%92%E5%B9%B4%E6%97%85%E5%BA%97&type=1）';
  }
});
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(repoRoot, 'personal-backend/scripts/_shots/feed_after.png'), fullPage: true });

const realErrors = consoleErrors.filter((e) => !/favicon|ResizeObserver|Download the React DevTools/i.test(e));
ok('无 console 错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await browser.close();

console.log('\n' + '─'.repeat(64));
console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (fail) {
  console.log('失败项：');
  for (const f of failures) console.log(`  · ${f}`);
}
process.exit(fail ? 1 : 0);
