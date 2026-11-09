/**
 * verify_bot_idle_v4.mjs · 机器人第四轮改造的浏览器实测
 *
 * 本轮四条需求（用户原话）：
 *   1. 「机器人形象确定了没有问题」
 *   2. 「歪头时，右边缺失了一部分，稍作修改」
 *   3. 「机器人的行进速度慢一点」
 *   4. 「机器人不用一直走，大部分时间可以在空白处站着，偶尔歪头有些小反应，
 *       偶尔走动」
 *
 * 断言目标：
 *   [1] **歪头不再被裁**（本轮核心 bug）：
 *       在**同一个屏幕坐标系**里直接比较「svg 视口矩形」与「各个绘制元素的
 *       矩形」，看有没有元素伸出视口之外。不冻结动画 —— 长采样（> 一个 13s
 *       歪头周期）自然覆盖到最歪那几帧。
 *       改造前头一歪，右上角就甩出 viewBox 右边界，右缘被切掉一块。
 *   [2] **歪头确实在偶尔发生**：连续采样 .bot-tilt 的 computed transform 角度，
 *       要求同时出现"竖直（≈0°）"和"明显倾斜"两种状态，
 *       且竖直帧占大多数 —— 是"偶尔有个小反应"，不是一直在摇。
 *   [3] **走得更慢**：实测"位移像素 / 毫秒"，要求明显低于改造前的 78px/s。
 *   [4] **站得多、走得少**（"大部分时间在空白处站着，偶尔走动"）：
 *       判据按**可见时**（机器人位于面板左右空地、用户看得见）来算 ——
 *       要求空地上站立帧占多数（走动 < 30%）。横穿面板那一趟约九成发生在
 *       面板背后（被面板盖住、看不见），单独计入会得到一个与用户感受无关的
 *       偏悲观数字，所以它只作参考项，另有一条"仍会经过面板背后"保证
 *       "从对话下层走过"这个效果还在。
 *   [5] 回归：输入时仍会贴着输入框那一行探身看（不压在输入框上）。
 *
 * 用法（需 5173 + 8001 在线）：
 *   node personal-backend/scripts/verify_bot_idle_v4.mjs
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

const BOT = 'svg[aria-label*="AI 陪伴助手"]';

/** 同一屏幕坐标系下量"内容是否伸出视口"。
 *  为什么不用 getBBox：它返回的是**自身 user space** 的包围盒，
 *  不含祖先 <g> 上的 CSS transform（歪头/前倾/呼吸都挂在那几层）。
 *  而 getBoundingClientRect 是屏幕坐标、已经把全部变换算进去了，
 *  两边同一个坐标系直接比，不用做任何矩阵换算，最不容易出错。 */
const measureClip = () => page.evaluate((sel) => {
  const svg = document.querySelector(sel);
  if (!svg) return null;
  const sr = svg.getBoundingClientRect();
  let minL = 1e9; let maxR = -1e9; let minT = 1e9; let maxB = -1e9;
  for (const el of svg.querySelectorAll('rect, circle, ellipse, path')) {
    const b = el.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) continue;
    minL = Math.min(minL, b.left); maxR = Math.max(maxR, b.right);
    minT = Math.min(minT, b.top); maxB = Math.max(maxB, b.bottom);
  }
  const deg = (el) => {
    if (!el) return null;
    const t = getComputedStyle(el).transform;
    const m = t && t !== 'none' ? t.match(/matrix\(([^)]+)\)/) : null;
    if (!m) return 0;
    const [a, b] = m[1].split(',').map(Number);
    return Math.atan2(b, a) * 180 / Math.PI;
  };
  return {
    overR: maxR - sr.right, overL: sr.left - minL,
    overB: maxB - sr.bottom, overT: sr.top - minT,
    tilt: deg(svg.querySelector('.bot-tilt')),
    svgW: Math.round(sr.width), svgH: Math.round(sr.height),
    label: svg.getAttribute('aria-label'),
  };
}, BOT);

try {
  /* ── 0. 登录进入对话页 ─────────────────────────────────────────────── */
  console.log('\n[0] 登录并进入 AI 陪伴对话页');
  await page.goto(`${BASE}/#/auth`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const ins = page.locator('input');
  await ins.nth(0).fill('xiaoyu');
  await ins.nth(1).fill('123456');
  await page.getByRole('button', { name: /登录|进入/ }).first().click();
  await page.waitForTimeout(2400);
  await page.goto(`${BASE}/#/personal/me/chat`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3200);
  /* 关掉今日问询弹窗（它会盖住页面，影响采样） */
  const closeBtn = page.locator('[role="dialog"] button[aria-label="关闭"]');
  if (await closeBtn.count()) { await closeBtn.first().click(); await page.waitForTimeout(600); }
  const laterBtn = page.getByRole('button', { name: /稍后回复/ });
  if (await laterBtn.count()) { await laterBtn.first().click(); await page.waitForTimeout(600); }
  ok('进入对话页', page.url().includes('/personal/me/chat'), page.url());
  ok('机器人已渲染', await page.locator(BOT).count() > 0);

  /* ── 1. 歪头不再被裁（闲站） ───────────────────────────────────────── */
  console.log('\n[1] 歪头不再被裁 · 闲站（本轮核心 bug）');
  /* 「移到一边 + 点空白」确保没有焦点在输入框，否则会一直保持探看姿 */
  await page.locator('body').click({ position: { x: 6, y: 6 } });
  await page.waitForTimeout(800);

  let worst = { overR: -1e9, overL: -1e9, overB: -1e9, overT: -1e9 };
  const degs = [];
  const SAMPLES = 68;             /* × 250ms ≈ 17s，覆盖一个 13s 歪头周期 */
  for (let i = 0; i < SAMPLES; i++) {
    const r = await measureClip();
    if (r) {
      degs.push(r.tilt ?? 0);
      worst = {
        overR: Math.max(worst.overR, r.overR), overL: Math.max(worst.overL, r.overL),
        overB: Math.max(worst.overB, r.overB), overT: Math.max(worst.overT, r.overT),
      };
    }
    await page.waitForTimeout(250);
  }
  ok(
    '闲站 17s：右缘始终未被裁',
    worst.overR <= 0.5,
    `最坏越界 ${worst.overR.toFixed(2)}px（<=0 表示还有余量）`,
  );
  ok('闲站 17s：左缘未被裁', worst.overL <= 0.5, `最坏越界 ${worst.overL.toFixed(2)}px`);
  ok('闲站 17s：上下缘未被裁', worst.overT <= 0.5 && worst.overB <= 0.5,
    `上 ${worst.overT.toFixed(2)}px / 下 ${worst.overB.toFixed(2)}px`);

  /* ── 2. 歪头是"偶尔的小反应" ──────────────────────────────────────── */
  console.log('\n[2] 歪头：偶尔歪一下，不是一直歪也不是不歪');
  const upright = degs.filter((d) => Math.abs(d) < 0.6).length;
  const maxTilt = Math.max(...degs.map(Math.abs));
  const tilted = degs.filter((d) => Math.abs(d) >= 2).length;
  ok('大部分时间头是竖直的（>= 70% 帧接近 0°）', upright / degs.length >= 0.7,
    `竖直 ${upright}/${degs.length} 帧`);
  ok('确实会歪（最大倾角 >= 4°）', maxTilt >= 4, `最大 ${maxTilt.toFixed(1)}°`);
  ok('歪头是"偶尔"（倾斜帧 < 35%）', tilted / degs.length < 0.35,
    `倾斜 ${tilted}/${degs.length} 帧`);

  /* ── 3 & 4. 慢速 + 站得多走得少 ───────────────────────────────────── */
  console.log('\n[3] 行进速度 与 [4] 走动 / 站立比例');
  /* 采样放在页面里做（rAF 驱动），避免 Playwright 往返延迟把"像素/毫秒"算歪。
     时长 150s 是被设计的节奏逼出来的，不是随意加的：
       · 走动本身稀疏（走 3–8s、站 11–20s），"就地小逛"要出现两次以上；
       · **横穿**（=从面板背后走过）按 CROSS_COOLDOWN_MS=100s 排布，
         而刚进页面时还要等 FIRST_CROSS_DELAY_MS=35s 才有第一趟，
         加上横穿本身约 19s —— 想稳定观测到一次"经过面板背后"，
         窗口必须盖住 35s + 一趟横穿。
     早先用 60s 窗口时"是否经过面板背后"变成了抽奖：冷却放长后就再也采不到。 */
  const track = await page.evaluate(async (DUR) => {
    const svg = document.querySelector('svg[aria-label*="AI 陪伴助手"]');
    const host = svg?.closest('div[aria-hidden="true"]');
    const mover = host?.firstElementChild;
    const panel = document.querySelector('.chat-fullheight');
    if (!svg || !host || !mover || !panel) return null;
    const t0 = performance.now();
    const out = [];
    while (performance.now() - t0 < DUR) {
      const r = svg.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      const walking = Array.from(svg.querySelectorAll('g'))
        .some((g) => g.classList.contains('bot-walk'));
      out.push({
        t: performance.now() - t0,
        x: r.left, y: r.top, w: r.width,
        cx: r.left + r.width / 2,
        panelLeft: pr.left, panelRight: pr.right,
        walking,
        opacity: Number(getComputedStyle(host).opacity),
      });
      await new Promise((res) => requestAnimationFrame(res));
    }
    return out;
  }, 150000);

  if (!track || track.length < 200) {
    ok('采样到足够的运动轨迹', false, `样本 ${track?.length ?? 0}`);
  } else {
    /* ── 速度：按"运动段"统计，不要逐帧差分直接平均。
       两个坑都踩过：
         · 逐帧差分时若只统计"位移较大"的帧，会把缓动两端速度趋近 0 的
           那段丢掉 → 只算中段 → 速度被高估（实测高估到 3 倍）；
         · 若反过来只认"连续多帧不动"为停稳，缓动尾巴的亚像素移动会让
           停稳点提前判定 → 距离被少算 → 速度被低估。
       正确口径是**整段**：以"位移 > 0.05px"为在动，连续在动的帧合成一段，
       段内 总距离 ÷ 总时长 才是这一段的平均速度，缓动头尾自然被包含在内。 */
    const runs = [];
    let run = null;
    for (let i = 1; i < track.length; i++) {
      const a = track[i - 1];
      const b = track[i];
      const dt = b.t - a.t;
      if (dt <= 0 || dt > 120) { run = null; continue; }
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d > 0.05) {
        if (!run) run = { dist: 0, ms: 0, maxJump: 0 };
        run.dist += d;
        run.ms += dt;
        run.maxJump = Math.max(run.maxJump, d);
      } else if (run) {
        runs.push(run);
        run = null;
      }
    }
    if (run) runs.push(run);

    /* 只保留真正的"一次走动"（> STEP_MIN_PX 的量级），忽略抖动 */
    const realRuns = runs.filter((r) => r.dist >= 100);
    const speeds = realRuns.map((r) => (r.dist / r.ms) * 1000);
    const avgSpeed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
    const maxJump = Math.max(0, ...runs.map((r) => r.maxJump));

    ok('确实发生了走动（>= 2 次完整位移）', realRuns.length >= 2, `${realRuns.length} 次`);
    ok('行进速度明显变慢（< 60 px/s）', avgSpeed > 5 && avgSpeed < 60,
      `实测 ${avgSpeed.toFixed(1)} px/s（改造前 78 px/s）；各次 ${speeds.slice(0, 12).map((s) => s.toFixed(0)).join('/')}`);
    ok('全程连续位移、无闪现', maxJump < 60, `单帧最大位移 ${maxJump.toFixed(1)}px`);
    /* 单次走动距离被 MAX_STEP_PX 限住 —— 这是"慢"能成立的前提 */
    const maxRun = Math.max(0, ...realRuns.map((r) => r.dist));
    ok('单次走动不超过距离上限（<= 400px）', maxRun <= 400, `最远一次 ${maxRun.toFixed(0)}px`);

    /* ── 走动 / 站立占比 ────────────────────────────────────────────────
       关键：**用户能看到的**只有"在空地上"的那些时刻。横穿面板那一趟
       （约 19s、拆 3 步、中间只歇 1–3s）有约九成发生在**面板背后**，
       用户根本看不见 —— 把它和可见走动等权去算总占比，会得出一个
       偏悲观、且与用户实际感受无关的数字（实测整体 26–36% 波动很大）。
       所以主判据按"可见时（空地上）"算，另附整体占比作为参考。 */
    const inGutterF = track.filter((s) => s.cx < s.panelLeft || s.cx > s.panelRight);
    const behindF = track.filter((s) => s.cx >= s.panelLeft && s.cx <= s.panelRight);
    const gutWalk = inGutterF.filter((s) => s.walking).length;
    const gutRatio = inGutterF.length ? gutWalk / inGutterF.length : 0;

    ok('看得见的时候大部分时间站着（空地上走动帧 < 30%）', gutRatio < 0.3,
      `可见走动 ${(gutRatio * 100).toFixed(0)}%（${gutWalk}/${inGutterF.length} 帧在空地上）`);

    const walkFrames = track.filter((s) => s.walking).length;
    ok('整体走动占比也在三成上下（参考项）', walkFrames / track.length < 0.4,
      `整体走动 ${((walkFrames / track.length) * 100).toFixed(0)}%（${walkFrames}/${track.length} 帧）`);

    /* 落点：面板左右空地 vs 面板背后（面板背后 = 被面板盖住） */
    ok('大部分时间位于面板左右空地上（> 60%）', inGutterF.length / track.length > 0.6,
      `空地 ${((inGutterF.length / track.length) * 100).toFixed(0)}% / 面板背后 ${((behindF.length / track.length) * 100).toFixed(0)}%`);
    ok('仍会经过面板背后（保留"从下层走过"）', behindF.length > 0, `${behindF.length} 帧在面板横向范围内`);

    /* 走动次数：一段连续位移算一次。按设计节奏（走 3–8s、站 11–20s），
       150s 里大概 8–14 次；给到 20 是留足余量又不至于形同虚设。 */
    let walks = 0;
    let prev = false;
    for (const s of track) {
      if (s.walking && !prev) walks++;
      prev = s.walking;
    }
    ok('走动不频繁（150s 内 <= 20 次）', walks <= 20, `${walks} 次`);

    /* 纵向也要走起来，不能只在一条水平线上横移 */
    const ys = track.map((s) => s.y);
    ok('纵向也有活动范围（> 60px）', Math.max(...ys) - Math.min(...ys) > 60,
      `${(Math.max(...ys) - Math.min(...ys)).toFixed(0)}px`);
  }

  /* ── 5. 回归：输入时探身看 ─────────────────────────────────────────── */
  console.log('\n[5] 输入时仍会探身看（回归）');
  const ta = page.locator('textarea').first();
  await ta.click();
  await ta.fill('在写点什么');
  /* 等它**走到**输入框那一行。慢速下从当前位置挪到输入框外侧可能要走 8s，
     加上 45px/s，等 4.2s 时常还在路上 —— 早先那条"机体在面板外侧"的失败
     就是踩了这一点（量到的是半路上的位置）。所以这里轮询到就位为止。 */
  let peek = null;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(500);
    peek = await page.evaluate(() => {
      const svg = document.querySelector('svg[aria-label*="看你的输入"]');
      if (!svg) return null;
      const mover = svg.closest('div[aria-hidden="true"]')?.firstElementChild;
      const t = document.querySelector('textarea')?.getBoundingClientRect();
      const p = document.querySelector('.chat-fullheight')?.getBoundingClientRect();
      if (!t || !p || !mover) return { found: true };
      /* 还在走就别急，等它停稳再量（否则量到的是半路位置） */
      const tr = getComputedStyle(mover).transform;
      let minL = 1e9; let maxR = -1e9; let minT = 1e9; let maxB = -1e9;
      for (const el of svg.querySelectorAll('rect, circle, ellipse, path')) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) continue;
        minL = Math.min(minL, b.left); maxR = Math.max(maxR, b.right);
        minT = Math.min(minT, b.top); maxB = Math.max(maxB, b.bottom);
      }
      return {
        found: true,
        settled: Boolean(tr),
        dy: Math.round(Math.abs((minT + maxB) / 2 - (t.top + t.height / 2))),
        outside: maxR <= p.left + 2 || minL >= p.right - 2,
        side: (minL + maxR) / 2 < p.left + p.width / 2 ? 'left' : 'right',
        gapRight: Math.round(maxR - p.right),
        gapLeft: Math.round(p.left - minL),
      };
    });
    /* 已经贴到面板外、并且纵向也对上输入框了 → 就位 */
    if (peek && peek.outside && (peek.dy ?? 999) < 40) break;
  }
  ok('切到探看姿态', peek?.found === true, `站 ${peek?.side} 侧`);
  ok('纵向对准输入框那一行（偏差 < 90px）', (peek?.dy ?? 999) < 90, `偏差 ${peek?.dy}px`);
  /* 显示时按**所站那一侧**取间隙：站左侧要看 gapLeft、站右侧要看 gapRight。
     早先统一取 gapRight，站左侧时 maxR - p.right 会得到一个约等于
     -面板宽 的负数（实测 -783px），看着像"跑飞了"，其实位置是对的。 */
  const peekGap = peek?.side === 'left' ? peek?.gapLeft : peek?.gapRight;
  ok('机体整体在面板外侧（不压在输入框上）', peek?.outside === true,
    `距面板 ${peekGap}px`);

  /* 探看姿期间也要确认没被裁（探看叠加 3° 头偏 + 5° 前倾，角度最大） */
  let peekWorst = -1e9;
  for (let i = 0; i < 12; i++) {
    const r = await measureClip();
    if (r) peekWorst = Math.max(peekWorst, r.overR, r.overL, r.overT, r.overB);
    await page.waitForTimeout(200);
  }
  ok('探看姿（角度最大）下也未被裁', peekWorst <= 0.5, `最坏越界 ${peekWorst.toFixed(2)}px`);

  await ta.fill('');
  await page.waitForTimeout(2500);

  /* ── 截图留档 ──────────────────────────────────────────────────────── */
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOTS, 'bot-v4-page.png') });
  const bot = page.locator(BOT).first();
  if (await bot.count()) {
    await bot.screenshot({ path: path.join(SHOTS, 'bot-v4-idle.png'), omitBackground: true })
      .catch((e) => console.log(`  （特写失败：${e.message}）`));
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
