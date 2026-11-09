/**
 * 浏览器端到端验证：AI 陪伴对话页「今日问询自动弹窗 + 三选项 + 机器人形象」。
 *
 * 验证目标（用户 2026-11-07 需求）：
 *   1. 打开 AI 陪伴对话页，当天首次**自动弹出**问询窗口（不用点任何按钮）；
 *   2. 窗口在页面**正中间**；
 *   3. 三个选项：回复 / 稍后回复 / 不想回复，各自行为正确；
 *   4. 页面里有 AI 机器人形象，且配色是页面主色系（不能是黑/异色）；
 *   5. 一天只弹一次（刷新不再弹）。
 *
 * 用法（在 frontend 目录）：
 *   node .verify-tmp/run3.mjs
 */
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

/* playwright-core 装在 frontend/node_modules 下（仓库根目录没有），
   所以不能写裸包名 `from 'playwright'` —— 从 scripts/ 目录解析不到。
   这里统一用 createRequire 从 frontend 解析，和 verify_kg_3d_starfield.mjs 一致。 */
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const frontendDir = process.env.FRONTEND_DIR || path.join(repoRoot, 'frontend');
const pwPath = require.resolve('playwright-core', { paths: [frontendDir] });
const pwMod = await import(pathToFileURL(pwPath).href);
const chromium = (pwMod.default ?? pwMod).chromium;

const APP = 'http://localhost:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = '.verify-tmp/_shots';
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
/* 先注入鉴权助手（必须在任何导航之前）：脚本里的裸 fetch 不会自动带
   Authorization，而 8001 从第十轮起统一要求它（详见 installAuthHelper 的说明） */
await installAuthHelper(page);

async function login() {
  await page.goto(`${APP}/#/login`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /演示账号/ }).click();
  await page.getByRole('button', { name: '登录并进入系统' }).click();
  await page.waitForURL('**/personal/**', { timeout: 25000 }).catch(() => {});
  await sleep(1200);
}

/** 把某用户重置成"今天还没有 pending 问询"的状态：
 *  · 服务端用 ensure?force=1 —— 它会删掉今天的旧记录并新建一条 pending
 *    （这是后端既有的调试能力，正好用来做测试重置）；
 *  · 本机清掉 ensured / dismissed / 欢迎页标记，让页面重新走"首次进入"分支。
 *
 * ── 关于鉴权（第十轮起）────────────────────────────────────────────────
 * 8001 现在统一要求 `Authorization: Bearer <token>`（见 README-个人端部署指南 §2.4），
 * token 存在 localStorage 的 psych_token_persistent（见 services/http.ts）。
 * 页面内的业务请求由 axios 拦截器自动注入，但**脚本里的裸 fetch 不会** ——
 * 少了这一步会 401，表现为"服务端状态读不到 / 重置无效"，看起来像功能坏了。
 * 下面用 addInitScript 往每个页面注入一个 window.__authInit()：
 * 它是"每次导航后都会自动重建"的，所以不会像单次 evaluate 那样被刷新冲掉。
 */
async function installAuthHelper(page) {
  await page.addInitScript(() => {
    window.__authInit = (extra = {}) => ({
      ...extra,
      headers: {
        ...(extra.headers ?? {}),
        Authorization: `Bearer ${localStorage.getItem('psych_token_persistent') ?? ''}`,
      },
    });
  });
}

async function resetUser(user) {
  await page.evaluate(
    (u) => {
      localStorage.removeItem(`psych_checkin_declined::${u}`);
      localStorage.removeItem(`psych_checkin_dismissed::${u}`);
      localStorage.removeItem('psych_welcome_seen');
    },
    user,
  );
  const info = await page.evaluate(async (u) => {
    const r = await fetch(`/api/v1/checkin/ensure?user_id=${u}&force=1`, window.__authInit({ method: 'POST' }));
    const d = await r.json();
    return { id: d.checkin ? d.checkin.id : null, status: d.checkin ? d.checkin.status : null };
  }, user);
  return info;
}

const dialog = () => page.getByRole('dialog', { name: '今日关怀问询' });
const botSvg = () => page.locator('svg[aria-label="AI 陪伴助手"]');

try {
  await login();
  log('[1] 登录成功，落在', page.url());

  /* 重置成"今天还没有 pending 问询"（服务端 force 重建 + 清本机标记） */
  const info = await resetUser('xiaoyu');
  log('[2] 重置后服务端问询：', JSON.stringify(info));
  await page.evaluate(() => {
    localStorage.removeItem('psych_checkin_declined::xiaoyu');
    localStorage.removeItem('psych_checkin_dismissed::xiaoyu');
  });

  await page.goto(`${APP}/#/personal/me/chat`, { waitUntil: 'networkidle' });
  await sleep(2500);

  /* 1) 自动弹窗（用户没有点任何按钮） */
  const visible = await dialog().isVisible().catch(() => false);
  check('进入对话页自动弹出问询窗（无需点按钮）', visible);

  /* 1b) 关键回归：不点任何选项直接离开，再回来**仍应弹出**。
     这条专门用来盯住曾经的设计陷阱 —— 早先有个 `psych_checkin_ensured`
     标记，只要今天触发过一次就再也不弹，导致"清了服务端记录重测仍无弹窗"。
     现在的判据是"状态仍 pending 且用户没主动关过"，所以必须继续弹。 */
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(2500);
  check(
    '未作任何选择就离开、回来仍会弹（无"已触发"标记憋住弹窗）',
    await dialog().isVisible().catch(() => false),
  );

  /* 2) 位于页面正中间：中心点与视口中心偏差应很小 */
  if (visible) {
    const box = await dialog().locator('.ui-card').boundingBox();
    const vp = page.viewportSize();
    const dx = Math.abs(box.x + box.width / 2 - vp.width / 2);
    const dy = Math.abs(box.y + box.height / 2 - vp.height / 2);
    check('弹窗位于页面正中间', dx < 8 && dy < 8, `offset dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`);
  }

  /* 3) 三个选项齐全 */
  const btns = await dialog().locator('button').allInnerTexts();
  const joined = btns.join('|');
  check('含「回复」按钮', /回复/.test(joined));
  check('含「稍后回复」按钮', /稍后回复/.test(joined));
  check('含「不想回复」按钮', /不想回复/.test(joined));
  await page.screenshot({ path: `${OUT}/bot-01-auto-dialog.png` });

  /* 4) 弹窗里的机器人形象存在 */
  const botInDialog = await dialog().locator('svg[aria-label="AI 陪伴助手"]').count();
  check('弹窗内有机器人形象', botInDialog > 0);

  /* 5) 点「回复」→ 关窗并进入回答态（原地，不跳页） */
  await dialog().getByRole('button', { name: /^回复$/ }).click();
  await sleep(800);
  check('点「回复」后弹窗关闭', !(await dialog().isVisible().catch(() => false)));
  const answering = await page.getByText(/正在回复这条问询/).count();
  check('点「回复」后进入回答态（原地不跳页）', answering > 0, `url=${page.url()}`);
  await page.screenshot({ path: `${OUT}/bot-02-answering.png` });

  /* 6) 真正把答复发出去 → 服务端转为 replied → 之后再刷新不再弹。
     注意两点：
       · 只用 reload() 而不是 goto 同一 URL —— 仅 hash 相同的 goto 不触发真正
         重载，页面还在内存里，测出来是"没重新挂载"而不是"重挂也不弹"，假阳性；
       · 必须**真的发送一条消息**才算回复完成。只点「回复」按钮是进入回答态，
         服务端仍是 pending —— 那种情况下刷新本来就该再弹（他还没答），
         把它当"不该弹"来断言是脚本的错，不是实现的错。 */
  await page.locator('textarea').fill('今天还行，就是有点累。');
  await page.getByRole('button', { name: '发送' }).click();
  await sleep(9000);
  const repliedStatus = await page.evaluate(async () => {
    const r = await fetch('/api/v1/checkin/history?user_id=xiaoyu&limit=5', window.__authInit());
    const list = await r.json();
    return list.length ? list[0].status : 'none';
  });
  check('发送答复后服务端状态为 replied', repliedStatus === 'replied', `status=${repliedStatus}`);

  await page.reload({ waitUntil: 'networkidle' });
  await sleep(2200);
  check(
    '已回复后刷新不再弹（一天只问一次）',
    !(await dialog().isVisible().catch(() => false)),
  );

  /* 7) 页面上有机器人形象。
     注意用**包含**匹配而不是精确相等：机器人有两种姿态，探身看输入时的
     aria-label 是「AI 陪伴助手正在看你的输入」，精确匹配会在它恰好探身的那一刻
     数到 0，造成假失败。断言的是"形象确实存在"，不是"恰好有几个"。
     2026-11-08 第三轮改版：形象换成深色金属机甲（发光件仍取品牌蓝 #465fff /
     #6b82ff），机体本身是写死的金属灰材质而不是 primary 变量 —— 这是刻意的：
     机体要的是一套"材质"而非主题色，若走 primary 变量，深色模式下会被换成深蓝、
     发光会整个消失。所以这里断言改为「存在发光件且色相属于品牌蓝」，
     不再要求它必须引用 primary 变量。 */
  const botCount = await page.locator('svg[aria-label*="AI 陪伴助手"]').count();
  check('页面内存在机器人形象', botCount >= 1, `共 ${botCount} 个`);
  if (botCount > 0) {
    const look = await page.locator('svg[aria-label*="AI 陪伴助手"]').first().evaluate((svg) => {
      const stops = [...svg.querySelectorAll('stop')].map((s) => s.getAttribute('stop-color') || '');
      const strokes = [...svg.querySelectorAll('[stroke]')].map((e) => e.getAttribute('stroke') || '');
      const all = [...stops, ...strokes];
      /* 品牌蓝：#465fff / #6b82ff 及同族。判据是 B 通道显著高于 R（蓝紫系） */
      const isBrandBlue = (c) => {
        const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c.trim());
        if (!m) return false;
        const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16));
        return b > 180 && b - r > 60 && b >= g;
      };
      return {
        total: all.length,
        blue: all.filter(isBrandBlue).length,
        /* 深色机体材质：金属灰（三通道接近、整体偏暗）成组出现 */
        metal: all.filter((c) => {
          const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c.trim());
          if (!m) return false;
          const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16));
          const mx = Math.max(r, g, b);
          return mx - Math.min(r, g, b) < 24 && mx > 16 && mx < 130;
        }).length,
      };
    });
    check('机器人有品牌蓝发光件（眼睛/关节/天线）', look.blue >= 5,
      `${look.blue}/${look.total} 个蓝紫色值`);
    check('机器人机体是深色金属材质', look.metal >= 8,
      `${look.metal}/${look.total} 个金属灰材质`);
  }

  /* 8) 验证「不想回复」：重置后弹窗 → 点不想回复 → 服务端 declined + 不再弹 */
  const newId = (await resetUser('xiaoyu')).id;
  await page.evaluate(() => {
    localStorage.removeItem('psych_checkin_declined::xiaoyu');
    localStorage.removeItem('psych_checkin_dismissed::xiaoyu');
  });
  /* 必须 reload 让组件重新挂载，才会重新走"首次进入"分支 */
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(2500);
  const dlg2 = await dialog().isVisible().catch(() => false);
  check('重置后可再次自动弹窗', dlg2);
  if (dlg2) {
    await dialog().getByRole('button', { name: '不想回复' }).click();
    await sleep(1200);
    check('点「不想回复」后弹窗关闭', !(await dialog().isVisible().catch(() => false)));
    const status = await page.evaluate(async (id) => {
      const r = await fetch(`/api/v1/checkin/history?user_id=xiaoyu&limit=5`, window.__authInit());
      const list = await r.json();
      const cur = list.find((x) => x.id === id);
      return cur ? cur.status : 'not-found';
    }, newId);
    check('服务端状态置为 declined', status === 'declined', `status=${status}`);
    const pend = await page.evaluate(async () => {
      const r = await fetch('/api/v1/checkin/pending?user_id=xiaoyu', window.__authInit());
      return (await r.json()).count;
    });
    check('declined 后不出现在待回复列表', pend === 0, `pending=${pend}`);
  }
  await page.screenshot({ path: `${OUT}/bot-03-after-decline.png` });

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
