/**
 * verify_roaming_bot_v3.mjs · 机器人第三轮改造的浏览器实测
 *
 * 本轮四条需求（用户原话）：
 *   1. 「将这个形象替换项目中的现有的机器人」
 *   2. 「机器人可以在全屏走动」
 *   3. 「在对话框不要直接闪现到另一侧，直接在对话框下层走过即可」
 *   4. 「输入时保持原有的靠近对话框好奇」
 *
 * 断言目标：
 *   [1] 形象：确实是新的深色金属版 —— 横向宽头型（头壳宽 > 高）、
 *       面部深屏居中（左右留白对等）、侧凸块在头壳边缘外、天线只有一个光环、
 *       瞳孔是白色胶囊、嘴巴有微笑与正圆两个形状。
 *   [2] 全屏：连续采样，机器人的落点必须**覆盖到面板左右两侧之外的区域**
 *       （只在一侧徘徊不算"全屏"）。
 *   [3] 无闪现：采样整个位移过程中的坐标，验证它是**连续移动**的 ——
 *       不存在"相邻两帧之间横向跳过整个面板宽度"的瞬移。
 *   [4] 下层：任一时刻，机器人中心点做 elementFromPoint 命中到的都不是它自己
 *       （说明被上层内容盖住），也就是它在对话之下。
 *   [5] 输入探身：聚焦输入框并打字后，切到 peek 姿态、纵向对准输入框那一行，
 *       且整体仍在面板外（不压在输入框上）。
 *
 * 用法（需 5173 + 8001 在线）：
 *   node personal-backend/scripts/verify_roaming_bot_v3.mjs
 */

import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const frontendDir = process.env.FRONTEND_DIR || path.join(repoRoot, 'frontend');
const pwPath = require.resolve('playwright-core', { paths: [frontendDir] });
const pwMod = await import(pathToFileURL(pwPath).href);
const chromium = (pwMod.default ?? pwMod).chromium;

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const SHOTS = path.join(here, '_shots');
const CHROME = process.env.CHROME_PATH
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? `  ${extra}` : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? `  ${extra}` : ''}`); }
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-proxy-server', '--disable-proxy-config'],
});
const ctx = await browser.newContext({ viewport: { width: 1680, height: 950 } });
const page = await ctx.newPage();

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

const botBox = () =>
  page.evaluate(() => {
    const svg = document.querySelector('svg[aria-label*="AI 陪伴助手"]');
    if (!svg) return null;
    const b = svg.getBoundingClientRect();
    const panel = document.querySelector('.chat-fullheight');
    const p = panel?.getBoundingClientRect();
    return {
      x: b.left, y: b.top, right: b.right, bottom: b.bottom,
      w: Math.round(b.width), h: Math.round(b.height),
      cx: Math.round(b.left + b.width / 2),
      cy: Math.round(b.top + b.height / 2),
      panelLeft: p ? Math.round(p.left) : null,
      panelRight: p ? Math.round(p.right) : null,
      panelTop: p ? Math.round(p.top) : null,
      panelW: p ? Math.round(p.width) : null,
      label: svg.getAttribute('aria-label'),
    };
  });

try {
  console.log('\n[0] 登录并进入 AI 陪伴对话页');
  await page.goto(`${BASE}/#/auth`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const ins = page.locator('input');
  await ins.nth(0).fill('xiaoyu');
  await ins.nth(1).fill('123456');
  await page.getByRole('button', { name: /登录|进入/ }).first().click();
  await page.waitForTimeout(2200);
  await page.goto(`${BASE}/#/personal/me/chat`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);

  /* 关掉今日问询弹窗（它会盖住页面，影响采样） */
  const closeBtn = page.locator('[role="dialog"] button[aria-label="关闭"]');
  if (await closeBtn.count()) { await closeBtn.first().click(); await page.waitForTimeout(700); }
  const laterBtn = page.getByRole('button', { name: /稍后回复/ });
  if (await laterBtn.count()) { await laterBtn.first().click(); await page.waitForTimeout(700); }
  ok('进入对话页', page.url().includes('/personal/me/chat'), page.url());

  /* ── 1. 形象 ────────────────────────────────────────────────────────── */
  console.log('\n[1] 形象：深色金属机甲版');
  const shape = await page.evaluate(() => {
    const svg = document.querySelector('svg[aria-label*="AI 陪伴助手"]');
    if (!svg) return null;
    const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    /* 头壳 = 最大的那个 rect（rx=46 那层） */
    const rects = [...svg.querySelectorAll('rect')];
    const head = rects.find((r) => r.getAttribute('rx') === '46');
    const screen = rects.find((r) => r.getAttribute('rx') === '38');
    const hx = head ? Number(head.getAttribute('x')) : null;
    const hw = head ? Number(head.getAttribute('width')) : null;
    const hh = head ? Number(head.getAttribute('height')) : null;
    const sx = screen ? Number(screen.getAttribute('x')) : null;
    const sw = screen ? Number(screen.getAttribute('width')) : null;
    const shell = rects.find((r) => r.getAttribute('rx') === '48');
    const shellX = shell ? Number(shell.getAttribute('x')) : null;
    const shellW = shell ? Number(shell.getAttribute('width')) : null;
    return {
      vbW: vb[2], vbH: vb[3],
      headW: hw, headH: hh,
      /* 面部黑屏左右留白（含近黑垫层，比头壳各小 14） */
      padLeft: sx !== null && hx !== null ? sx - (hx - 2) : null,
      padRight: sx !== null && hx !== null ? (hx - 2 + (shellW ?? 0)) - (sx + sw) : null,
      /* 侧凸块：位于头壳外框之外（一半压进边缘） */
      tabL: rects.some((r) => r.getAttribute('x') === '222' && r.getAttribute('rx') === '12'),
      tabR: rects.some((r) => r.getAttribute('x') === '434' && r.getAttribute('rx') === '12'),
      /* 天线光环：只应有一个 ellipse（rx=30 ry=9）描边环 */
      antRings: [...svg.querySelectorAll('ellipse')].filter(
        (e) => e.getAttribute('rx') === '30' && e.getAttribute('ry') === '9',
      ).length,
      /* 瞳孔：白色胶囊（rx=13 的 rect，两条） */
      pupils: rects.filter((r) => r.getAttribute('rx') === '13' && r.getAttribute('fill') === '#f7f9ff').length,
      /* 嘴巴：微笑弧线（path）+ 正圆张口（circle r=14） */
      smile: Boolean(svg.querySelector('.bot-mouth-smile')),
      openMouth: Boolean(svg.querySelector('.bot-mouth-open circle')),
      /* 深色机体的标志：近黑描边 #080b11 大量出现。
         注意它同时用于 stroke（四肢/天线）与 fill（各部件的垫底轮廓层），
         只数 stroke 会漏掉一大半。 */
      darkOutline: [...svg.querySelectorAll('[stroke], [fill]')].filter((e) => {
        const s = e.getAttribute('stroke');
        const f = e.getAttribute('fill');
        return s === '#080b11' || f === '#080b11';
      }).length,
    };
  });
  /* viewBox 只校验"比机体大一圈"这个性质，不写死数值：
     2026-11-08 第四轮为了给歪头 / 前倾留旋转余量，画布从 260×432 放大到
     360×470（见 AiCompanionBot 文件头），具体数字以后还会调，
     卡死数值只会让脚本随设计一起腐化。 */
  ok('viewBox 留了旋转余量（宽 > 300 且高 > 420）',
    (shape?.vbW ?? 0) > 300 && (shape?.vbH ?? 0) > 420,
    JSON.stringify({ vbW: shape?.vbW, vbH: shape?.vbH }));
  ok('头壳是横向长方形（宽 > 高）', shape && shape.headW > shape.headH, `${shape?.headW} × ${shape?.headH}`);
  ok('面部黑屏左右留白对等（居中）', shape && shape.padLeft === shape.padRight, `左 ${shape?.padLeft} / 右 ${shape?.padRight}`);
  ok('两侧凸块在头壳边缘外', shape?.tabL === true && shape?.tabR === true);
  ok('天线只有一个光环', shape?.antRings === 1, `共 ${shape?.antRings} 个`);
  ok('瞳孔是白色胶囊（两只）', shape?.pupils === 2, `共 ${shape?.pupils} 只`);
  ok('嘴巴有微笑弧线与正圆张口两个形状', shape?.smile === true && shape?.openMouth === true);
  ok('深色金属机体（近黑描边成组出现）', (shape?.darkOutline ?? 0) >= 10, `描边元素 ${shape?.darkOutline} 个`);

  /* ── 2. 全屏走动 + 3. 无闪现 ────────────────────────────────────────── */
  console.log('\n[2] 全屏走动：落点覆盖面板左右两侧之外');
  await page.locator('body').click({ position: { x: 4, y: 4 } });
  await page.waitForTimeout(600);

  /* 高频采样整个位移过程：既看范围，也看有没有"跳帧瞬移"。
     窗口 26s：够覆盖 2–3 次走动（本轮改造后走动稀疏，
     见 verify_bot_idle_v4.mjs 的节奏断言）。 */
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 26000) {
    const b = await botBox();
    if (b) samples.push({ ...b, t: Date.now() - t0 });
    await page.waitForTimeout(120);
  }
  const valid = samples.filter(Boolean);
  ok('能读到机器人坐标', valid.length > 100, `采样 ${valid.length} 次`);

  const distinct = new Set(valid.map((s) => `${Math.round(s.x)},${Math.round(s.y)}`)).size;
  ok('位置持续变化（确实在走）', distinct > 20, `${distinct} 个不同落点`);

  const pl = valid[0]?.panelLeft ?? 0;
  const prr = valid[0]?.panelRight ?? 0;
  /* 判据用**中心点**是否越过面板边缘，而不是"整体在面板外"。
     原因：面板两侧的空地宽度由窗口宽与侧栏宽度共同决定，宽屏下并不对称
     （例如 1680 宽时左右各约 279px），机器人本体又只有约 100px 宽，
     用中心点判定才如实反映"它确实走到了那一侧的区域"。 */
  const leftOfPanel = valid.filter((s) => s.cx < pl).length;
  const rightOfPanel = valid.filter((s) => s.cx > prr).length;
  const insidePanel = valid.filter((s) => s.cx >= pl && s.cx <= prr).length;

  /* ── 本轮设计变更（2026-11-08 第四轮）——这两条断言不能再看 26s 窗口 ──
     用户要求「机器人不用一直走，大部分时间可以在空白处站着，
     偶尔歪头有些小反应，偶尔走动」，所以节奏被刻意放慢放稀疏：
       · 每走一段就站 11–20s；
       · "穿过面板背后"是这轮最重的动作，每 100s 才一趟，
         且页面打开后第一趟还要等 35s。
     于是 26s 的窗口里它完全可能一直待在**同一侧**的空地上小逛 ——
     那不是缺陷，正是"不用一直走"。
     这里改成断言"在当前这块空地上正常活动"，而把
     "左右两侧都到得了 / 会从面板背后穿过"交给 verify_bot_idle_v4.mjs
     用 150s 窗口验证（那里才是这套节奏对应的观测尺度）。 */
  const inAnyGutter = leftOfPanel + rightOfPanel;
  ok('待在面板左右某侧的空白处（"在空白处站着"）',
    inAnyGutter / valid.length > 0.6,
    `左 ${leftOfPanel} / 右 ${rightOfPanel} / 面板背后 ${insidePanel}（共 ${valid.length} 次）`);

  /* 位移范围仍然要"动起来"，不能定死在一个点上。
     纵向门槛给得低（> 15px）是刻意的：26s 窗口在本轮稀疏节奏下往往只覆盖
     1–2 次走动，而单步的纵向分量本身就可能很小（"就地小逛"有一档是
     几乎纯纵向、也有一档几乎纯横向）。纵向活动范围交给 v4 的 150s 窗口断言
     （那里实测 363px），这里只用于排除"完全垂直不动"的回归。 */
  const spanX = Math.round(Math.max(...valid.map((s) => s.cx)) - Math.min(...valid.map((s) => s.cx)));
  const spanY = Math.round(Math.max(...valid.map((s) => s.cy)) - Math.min(...valid.map((s) => s.cy)));
  ok('在同一侧空地内仍有明显位移（横向 > 60px）', spanX > 60, `横向跨度 ${spanX}px`);
  ok('纵向也动（排除垂直不动）', spanY > 15, `纵向跨度 ${spanY}px（范围内断言见 v4）`);

  console.log(`  ℹ 26s 窗口内：中心点 x 范围 ${Math.round(Math.min(...valid.map((s) => s.cx)))}~${Math.round(Math.max(...valid.map((s) => s.cx)))}，面板 ${pl}~${prr}`);
  console.log('  ℹ 「左右两侧都到得了 / 从面板背后穿过」由 verify_bot_idle_v4.mjs 用 150s 窗口验证');

  console.log('\n[3] 无闪现：位移连续，不存在跨面板瞬移');
  /* 相邻采样（间隔约 120ms）的横向位移不应超过"用户肉眼能接受的单步距离"。
     阈值取面板宽的一半：真要闪现，横向会一次跨过接近整个面板宽（数百 px）。
     连续行走 78px/s → 120ms 约 9px，留足余量。 */
  let maxJump = 0;
  let jumpFrom = null;
  let jumpTo = null;
  for (let i = 1; i < valid.length; i++) {
    const dx = Math.abs(valid[i].cx - valid[i - 1].cx);
    const dy = Math.abs(valid[i].cy - valid[i - 1].cy);
    const d = Math.hypot(dx, dy);
    if (d > maxJump) { maxJump = d; jumpFrom = valid[i - 1]; jumpTo = valid[i]; }
  }
  const panelW = (prr - pl) || 768;
  ok(
    `相邻采样最大位移 ${Math.round(maxJump)}px < 面板宽一半 ${Math.round(panelW / 2)}px（无瞬移）`,
    maxJump < panelW / 2,
    jumpFrom ? `最大一跳：(${Math.round(jumpFrom.cx)},${Math.round(jumpFrom.cy)}) → (${Math.round(jumpTo.cx)},${Math.round(jumpTo.cy)})` : '',
  );

  /* 位移过程中应当观察到"连续多帧小幅推进"，而不是"长时间不动 + 突然跳"
     用差值分布确认：至少有 20 次相邻位移落在 2~40px 这个"行走"区间 */
  const walkSteps = valid.slice(1).map((s, i) => Math.hypot(s.cx - valid[i].cx, s.cy - valid[i].cy));
  const movingFrames = walkSteps.filter((d) => d >= 2 && d <= 60).length;
  ok('大量采样点落在"连续行走"位移区间', movingFrames >= 20, `${movingFrames} 次相邻位移在 2~60px`);

  /* 本轮改造后必须补一条：**走动是少数状态**（用户要"不用一直走"）。
     26s 窗口里走动帧占比应明显低于"一直在动"的水平。
     注意判据要宽松一些：26s 里若正好赶上一次走动，占比会偏高，
     所以这里只要求"不是全程都在走"。严格的比例断言在 v4（150s 窗口）。 */
  const walkFrameRatio = movingFrames / Math.max(1, walkSteps.length);
  ok('不是一直在走（走动采样点占比 < 60%）', walkFrameRatio < 0.6,
    `走动采样点 ${(walkFrameRatio * 100).toFixed(0)}%（严格比例见 v4）`);

  /* ── 4. 图层在对话之下 ──────────────────────────────────────────────── */
  console.log('\n[4] 图层在对话面板之下');
  const layered = await page.evaluate(() => {
    const svg = document.querySelector('svg[aria-label*="AI 陪伴助手"]');
    if (!svg) return null;
    const host = svg.closest('div[aria-hidden="true"]');
    const b = svg.getBoundingClientRect();
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    return {
      hostZ: host ? getComputedStyle(host).zIndex : null,
      /* 命中元素是不是机器人自己（或它的子节点） */
      hitIsSelf: Boolean(hit && (hit === svg || svg.contains(hit))),
      hitTag: hit ? `${hit.tagName}.${(hit.className || '').toString().split(' ')[0]}` : null,
    };
  });
  ok('宿主层 z-index 为负（在内容之下）', layered?.hostZ === '-1', `z-index=${layered?.hostZ}`);
  /* 注意：机器人在"面板背后"时中心点命中的是面板；在"面板外侧空地"时命中的是
     页面容器 —— 两种都不该是它自己。 */
  ok('中心点没有被机器人自己占据（被上层盖住，即"在对话之下"）',
    layered?.hitIsSelf === false, `命中 ${layered?.hitTag}`);

  /* ── 5. 输入时探身看 ────────────────────────────────────────────────── */
  console.log('\n[5] 输入时靠近对话面板探身看（保持原有行为）');
  const composer = page.locator('textarea').first();
  await composer.click();
  await page.waitForTimeout(300);
  await composer.fill('今天有点累，想聊聊');

  /* 轮询等到位再量。2026-11-08 第四轮把位移速度降到 45px/s（改造前 78），
     原来"等 3.2s 必然走到输入框旁"就不成立了 —— 慢速下从落脚点挪到
     输入框外侧可能要 6–8s，固定等待会在半路上取样（实测偏差 223px）。
     这里轮询到"切了探看姿 + 纵向对上 + 在面板外"为止，上限 20s。 */
  let peek = null;
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(400);
    peek = await page.evaluate(() => {
      const svg = document.querySelector('svg[aria-label*="看你的输入"]');
      if (!svg) return { found: false };
      const b = svg.getBoundingClientRect();
      const ta = document.querySelector('textarea').getBoundingClientRect();
      const p = document.querySelector('.chat-fullheight').getBoundingClientRect();
      return {
        found: true,
        dy: Math.round(Math.abs((b.top + b.height / 2) - (ta.top + ta.height / 2))),
        outsidePanel: b.right <= p.left + 8 || b.left >= p.right - 8,
        side: b.left + b.width / 2 < p.left + p.width / 2 ? 'left' : 'right',
        /* 探身姿：瞳孔应比站姿大（height 42 vs 36） */
        pupilH: Number(svg.querySelector('rect[rx="15"]')?.getAttribute('height') ?? 0),
      };
    });
    if (peek?.found && peek.outsidePanel && peek.dy < 90) break;
  }
  ok('切到「看你的输入」姿态', peek?.found === true, JSON.stringify({ side: peek?.side }));
  ok('纵向对准输入框那一行（中心偏差 < 90px）', (peek?.dy ?? 999) < 90, `偏差 ${peek?.dy}px`);
  ok('整体仍在面板外侧（不压在输入框上）', peek?.outsidePanel === true, `站 ${peek?.side} 侧`);
  ok('探看时瞳孔放大（好奇）', peek?.pupilH === 42, `瞳孔高 ${peek?.pupilH}`);

  /* ── 6. 深色模式可见性 ──────────────────────────────────────────────── */
  console.log('\n[6] 深色模式下的可见性');
  await page.locator('body').click({ position: { x: 4, y: 4 } });
  await page.waitForTimeout(500);
  const themeBtn = page.getByRole('button', { name: /切换为深色模式/ });
  if (await themeBtn.count()) {
    await themeBtn.first().click();
    await page.waitForTimeout(1400);
  }
  const darkLook = await page.evaluate(() => {
    const svg = document.querySelector('svg[aria-label*="AI 陪伴助手"]');
    if (!svg) return null;
    const host = svg.closest('div[aria-hidden="true"]');
    const halo = svg.querySelector('.bot-halo');
    const rim = svg.querySelector('.bot-rim');
    return {
      isDark: document.documentElement.classList.contains('dark'),
      haloOpacity: halo ? Number(getComputedStyle(halo).opacity) : null,
      rimOpacity: rim ? Number(getComputedStyle(rim).opacity) : null,
      hostVisible: host ? Number(getComputedStyle(host).opacity) : null,
    };
  });
  ok('切到深色模式', darkLook?.isDark === true);
  ok('深色下背景光晕加强（把深机体托起来）', (darkLook?.haloOpacity ?? 0) >= 0.9, `halo opacity=${darkLook?.haloOpacity}`);
  ok('深色下轮廓高光提亮', (darkLook?.rimOpacity ?? 0) >= 0.5, `rim opacity=${darkLook?.rimOpacity}`);
  ok('深色下机器人仍然可见（宿主未隐藏）', darkLook?.hostVisible === 1, `host opacity=${darkLook?.hostVisible}`);

  await page.screenshot({ path: path.join(SHOTS, 'bot-v3-dark.png') });

  /* 回到浅色截一张，两张留着人工核对造型 */
  const backBtn = page.getByRole('button', { name: /切换为浅色模式/ });
  if (await backBtn.count()) { await backBtn.first().click(); await page.waitForTimeout(1400); }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOTS, 'bot-v3-light.png') });

  /* 机器人特写：站姿 + 探看姿，便于核对形象细节 */
  const still = page.locator('svg[aria-label="AI 陪伴助手"]').first();
  if (await still.count()) {
    await still.screenshot({ path: path.join(SHOTS, 'bot-v3-idle.png'), omitBackground: true })
      .catch((e) => console.log(`  （站姿特写失败：${e.message}）`));
  }
  const ta2 = page.locator('textarea').first();
  await ta2.click().catch(() => {});
  await ta2.fill('看看你在写什么').catch(() => {});
  await page.waitForTimeout(3200);
  const peekingBot = page.locator('svg[aria-label*="看你的输入"]').first();
  if (await peekingBot.count()) {
    await peekingBot.screenshot({ path: path.join(SHOTS, 'bot-v3-peek.png'), omitBackground: true })
      .catch((e) => console.log(`  （探看特写失败：${e.message}）`));
  }

  ok('零 console 错误', consoleErrors.length === 0, `${consoleErrors.length} 条`);
} catch (err) {
  console.log(`\n脚本异常：${err.message}`);
  fail++;
} finally {
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  console.log(`console 错误：${consoleErrors.length} 条${consoleErrors.length ? ` → ${consoleErrors.slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
}
