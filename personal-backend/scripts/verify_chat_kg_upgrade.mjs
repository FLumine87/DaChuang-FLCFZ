/**
 * verify_chat_kg_upgrade.mjs · 本轮四项改动的浏览器实测
 *
 * 覆盖：
 *   1. 漫游机器人 —— 页面里确实有机器人 SVG；位置随时间变化（真的在走动）；
 *      输入框聚焦后它移到输入框上沿附近，并切到「趴看」姿态。
 *   2. 时间节点 —— 对话里出现时间分隔；分隔文案格式正确。
 *   3. 知识图谱 —— 星云流场元素存在（轨道圈、脉冲、曲线边）；
 *      节点可选中、删除按钮可出现、确认弹窗文案正确。
 *
 * 用法（需要 5173 / 8001 都在线）：
 *   node scripts/verify_chat_kg_upgrade.mjs
 *
 * 为什么直接连系统 Chrome 而不是 playwright 自带的 chromium：
 * 本机没下载 playwright 浏览器（download 常被网络拦），系统装了 Chrome 就直接用，
 * 省一次几百 MB 的下载，也更贴近用户的真实浏览环境。
 */

/* playwright-core 装在 frontend/ 的 node_modules 下，而本脚本在 personal-backend/scripts/。
   ESM 的裸模块名解析只看脚本自己所在目录，所以在根目录下找不到 —— 用依赖的
   真实绝对路径导入（写成 file URL 以满足 ESM 的加载器要求）。
   注意：它是 CJS 包，命名导出在动态 import 下拿不到，必须取 default 再解构。 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

try {
  /* ── 登录 ─────────────────────────────────────────────────────────── */
  console.log('\n[1] 登录');
  await page.goto(`${BASE}/#/auth`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const inputs = page.locator('input');
  await inputs.nth(0).fill(USER);
  await inputs.nth(1).fill(PASS);
  await page.getByRole('button', { name: /登录|进入/ }).first().click();
  await page.waitForTimeout(2500);
  ok('登录后进入个人端', page.url().includes('/personal') || page.url().includes('#/'), page.url());

  /* ── 对话页：机器人 + 时间节点 ─────────────────────────────────────── */
  console.log('\n[2] AI 陪伴对话页 —— 漫游机器人');
  await page.goto(`${BASE}/#/personal/me/chat`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  /* 先关掉可能弹出来的今日问询（它会挡住消息区），再量机器人 */
  const dialogClose = page.locator('[role="dialog"] button[aria-label="关闭"]');
  if (await dialogClose.count()) {
    await dialogClose.first().click();
    await page.waitForTimeout(600);
  }

  /* 机器人：aria-label 定位，本页应有且只有一个（页头静态头像已移除） */
  const bots = page.locator('svg[aria-label*="AI 陪伴助手"]');
  const botCount = await bots.count();
  ok('页面内存在机器人形象', botCount >= 1, `找到 ${botCount} 个`);

  /* 读它外层定位容器的 transform，隔一段时间再读，看坐标是否变化 */
  const readBotPos = () =>
    page.evaluate(() => {
      const svg = document.querySelector('svg[aria-label*="AI 陪伴助手"]');
      const host = svg?.closest('.absolute');
      if (!host) return null;
      const t = getComputedStyle(host).transform;
      const m = t.match(/matrix\(([^)]+)\)/);
      if (m) {
        const p = m[1].split(',').map(Number);
        return { x: Math.round(p[4]), y: Math.round(p[5]) };
      }
      return { x: 0, y: 0, raw: t };
    });

  /* 确保没有焦点在输入框（否则会一直保持趴看，不游走） */
  await page.locator('body').click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(800);

  /* 2026-11-08 第四轮改版后，节奏是"大部分时间站着发呆、偶尔走动"：
     走动间隔 10–20s、一次走 3–8s。原来"8s 内采 3 个点必然看到位移"的前提
     已经不成立 —— 经常采到的就是同一个落脚点（实测 1 个不同位置）。
     这里改成**轮询等待一次真实位移**（上限 40s，足够覆盖一次 10–20s 的间隔 +
     一次 3–8s 的走动），一旦坐标变了就通过；顺带记录位移幅度。 */
  const p0 = await readBotPos();
  ok('能读到机器人坐标', Boolean(p0), JSON.stringify(p0));

  let seen = null;
  for (let i = 0; i < 100; i++) {
    await page.waitForTimeout(400);
    const p = await readBotPos();
    if (p && p0 && (p.x !== p0.x || p.y !== p0.y)) { seen = { from: p0, to: p, ms: (i + 1) * 400 }; break; }
  }
  ok('机器人确实会走动（坐标发生变化）', Boolean(seen),
    seen ? `从 ${seen.from.x},${seen.from.y} 走到 ${seen.to.x},${seen.to.y}（约 ${seen.ms}ms）`
         : '40s 内未观察到位移');

  /* 图层在对话之下，且不会压在消息/输入区上。
     2026-11-08 第三轮改版：机器人改为**全屏游走**，会从对话面板下层穿过
     （用户明确要求"直接在对话框下层走过即可"，不再绕行两侧走廊）。
     所以判据从"整体在面板外侧"改为两条更贴合的：
       · z-index 为负 —— 一定被面板上不透明的内容盖住，物理上不可能遮挡正文；
       · 中心点 elementFromPoint 命中的不是它自己 —— 实测"确实被盖住"。
     更严格的那套（连续采样 + 无瞬移 + 三区覆盖）在 verify_roaming_bot_v3.mjs 里。 */
  const layering = await page.evaluate(() => {
    const svg = document.querySelector('svg[aria-label*="AI 陪伴助手"]');
    if (!svg) return null;
    const b = svg.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    /* 往上找带负 z-index 的宿主层 */
    let el = svg;
    let negZ = false;
    while (el && el !== document.body) {
      const z = getComputedStyle(el).zIndex;
      if (z !== 'auto' && Number(z) < 0) { negZ = true; break; }
      el = el.parentElement;
    }
    return {
      negZ,
      hitIsSelf: Boolean(hit && (hit === svg || svg.contains(hit))),
    };
  });
  ok('机器人图层在对话之下（z-index 为负）', layering && layering.negZ === true);
  ok('中心点没有被机器人自己占据（确实被上层内容盖住）',
    layering && layering.hitIsSelf === false);

  /* ── 输入时探身看 ─────────────────────────────────────────────────── */
  console.log('\n[3] 用户输入时机器人到输入框旁探身看');
  const composer = page.locator('textarea').first();
  await composer.click();
  await page.waitForTimeout(300);
  await composer.fill('今天有点累，想聊聊');

  /* 等它**走到**输入框那一行再量，不要死等固定时长。
     2026-11-08 第四轮把行走速度从 78px/s 降到 45px/s，原来"等 2.6s 必然到位"
     的前提就不成立了：慢速下从落脚点挪到输入框外侧可能要 6–8s，
     原来那条断言会在半路上取样，读到 248px 的偏差（不是缺陷，是没走到）。
     这里轮询到位（纵向对齐且停在面板外）为止，上限 20s。 */
  let peekState = null;
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(400);
    peekState = await page.evaluate(() => {
      const svg = document.querySelector('svg[aria-label*="AI 陪伴助手"]');
      if (!svg) return null;
      /* 判"是否压在面板上"要用绘制元素的内容边界，不能用 svg 外框：
         本轮给画布四周留了透明余量（给歪头/前倾旋转用），
         外框会越过面板边缘，但那圈里没有任何像素。 */
      let minL = Infinity; let maxR = -Infinity; let minT = Infinity; let maxB = -Infinity;
      for (const el of svg.querySelectorAll('rect, circle, ellipse, path')) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) continue;
        minL = Math.min(minL, b.left); maxR = Math.max(maxR, b.right);
        minT = Math.min(minT, b.top); maxB = Math.max(maxB, b.bottom);
      }
      if (!Number.isFinite(minL)) return null;
      const ta = document.querySelector('textarea');
      const taBox = ta.getBoundingClientRect();
      const panel = document.querySelector('.chat-fullheight').getBoundingClientRect();
      return {
        /* 探身姿态的 aria-label 与 idle 不同，用它判断姿态是否切换 */
        peeking: svg.getAttribute('aria-label')?.includes('看你的输入') || false,
        /* 纵向对齐输入框那一行（中心偏差） */
        dy: Math.round(Math.abs((minT + maxB) / 2 - (taBox.top + taBox.height / 2))),
        /* 机体整体仍在面板外 —— 它不是"趴"在框上，而是在框旁边探身看 */
        outsidePanel: maxR <= panel.left + 8 || minL >= panel.right - 8,
      };
    });
    /* 已经切到探看姿、纵向对上、且在面板外 → 就位了 */
    if (peekState?.peeking && peekState.outsidePanel && peekState.dy < 120) break;
  }
  ok('机器人切到「探身看输入」姿态', peekState?.peeking === true, JSON.stringify(peekState));
  ok(
    '机器人纵向对准输入框那一行',
    Boolean(peekState) && peekState.dy < 120,
    `中心偏差 ${peekState?.dy}px`,
  );
  ok('探身时仍不压在输入框所在的面板内', peekState?.outsidePanel === true);

  /* 清空输入并失焦 → 应回到站姿 */
  await composer.fill('');
  await page.locator('body').click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(1200);
  const backIdle = await page.evaluate(() => {
    const svg = document.querySelector('svg[aria-label*="AI 陪伴助手"]');
    return svg ? !svg.getAttribute('aria-label')?.includes('看你的输入') : null;
  });
  ok('输入清空后回到站姿', backIdle === true);

  /* ── 时间节点 ─────────────────────────────────────────────────────── */
  console.log('\n[4] 对话时间节点');
  /* 发一条消息，制造带时间戳的新记录 */
  await composer.click();
  await composer.fill('测试时间节点');
  await composer.press('Enter');
  await page.waitForTimeout(3000);

  const timeInfo = await page.evaluate(() => {
    /* 时间分隔线：一条居中的小胶囊 */
    const pills = [...document.querySelectorAll('span')].filter((s) =>
      /^(今天|昨天|前天|\d+月\d+日|\d{4}年\d+月\d+日)\s\d{2}:\d{2}$/.test(s.textContent?.trim() ?? ''),
    );
    /* 气泡 title：完整时间 */
    const titled = [...document.querySelectorAll('div[title]')].filter((d) =>
      /^\d{4}年\d+月\d+日\s\d{2}:\d{2}$/.test(d.getAttribute('title') ?? ''),
    );
    return {
      dividers: pills.map((p) => p.textContent.trim()).slice(0, 4),
      titledCount: titled.length,
    };
  });
  ok('对话中出现时间分隔节点', timeInfo.dividers.length >= 1, JSON.stringify(timeInfo.dividers));
  ok('分隔文案格式正确（今天 HH:mm）', /^今天 \d{2}:\d{2}$/.test(timeInfo.dividers[0] ?? ''), timeInfo.dividers[0]);
  ok('消息气泡带完整时间提示', timeInfo.titledCount >= 2, `${timeInfo.titledCount} 条`);

  /* ── 知识图谱 ─────────────────────────────────────────────────────── */
  /* 注：2026-11-08 第四轮把图谱从「2D 星云流场」换成了「3D 深空球体」
     （球面布局 + 透视投影 + 星空背景 + 用户节点头像）。本节的断言同步改为
     新实现的对应物；3D 的详细验收在 verify_kg_3d_starfield.mjs 里，这里只保留
     "图谱页确实渲染出来了"的冒烟级检查，避免两处重复维护同一批细节。 */
  console.log('\n[5] 知识图谱（3D 深空球体）');
  await page.goto(`${BASE}/#/personal/me/kg`, { waitUntil: 'domcontentloaded' });

  /* 等图谱真的画出来再看。固定 3s 不够：
     图谱数据是异步拉的（/api/v1/kg/graph/<user>），慢的时候 3s 时节点还没齐，
     后面取到的坐标是"加载中途"的位置，点击自然落空 → 误报"点不中节点"。
     这里轮询到 SVG 里出现节点为止，上限 15s。 */
  let kgReady = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500);
    kgReady = await page.evaluate(() => {
      const svg = document.querySelector('svg[viewBox="0 0 900 560"]');
      return Boolean(svg && svg.querySelectorAll('g[data-kg="nodes"] > g[data-kg-node]').length >= 2);
    });
    if (kgReady) break;
  }
  await page.waitForTimeout(1200);

  const kg = await page.evaluate(() => {
    const svg = document.querySelector('svg[viewBox="0 0 900 560"]');
    if (!svg) return { hasSvg: false };
    return {
      hasSvg: true,
      /* 球体经纬大圆（取代了 2D 的同心轨道圈） */
      rings: svg.querySelectorAll('g[data-kg="rings"] polyline').length,
      /* 图层结构：星空 / 经纬 / 边 / 节点 */
      layers: svg.querySelectorAll('g[data-kg]').length,
      /* 星空星点数 */
      stars: svg.querySelectorAll('g[data-kg^="stars-"] circle').length,
      /* 三维直线边（取代了 2D 的贝塞尔曲线边） */
      edges: svg.querySelectorAll('g[data-kg="edges"] line').length,
      /* 节点 */
      nodes: svg.querySelectorAll('g[data-kg="nodes"] > g[data-kg-node]').length,
      gradients: svg.querySelectorAll('linearGradient, radialGradient').length,
      /* 用户节点头像（只有它含 clipPath 徽章） */
      avatars: [...svg.querySelectorAll('g[data-kg="nodes"] > g[data-kg-node]')].filter((h) => h.querySelector('clipPath')).length,
      /* 交互提示 */
      hint: document.body.textContent?.includes('拖动旋转') ?? false,
    };
  });
  ok('图谱使用新的深空画布', kg.hasSvg === true, JSON.stringify(kg));
  ok('存在球体经纬大圆', (kg.rings ?? 0) >= 3, `${kg.rings} 条`);
  ok('星空背景已铺（星点 ≥600）', (kg.stars ?? 0) >= 600, `${kg.stars} 颗`);
  ok('图层结构齐备（星空/经纬/边/节点）', (kg.layers ?? 0) >= 4, `${kg.layers} 层`);
  ok('连线已渲染（三维直线）', (kg.edges ?? 0) >= 1, `${kg.edges} 条`);
  ok('节点已渲染', (kg.nodes ?? 0) >= 2, `${kg.nodes} 个`);
  ok('用户中心组有头像', (kg.avatars ?? 0) === 1, `${kg.avatars} 个`);
  ok('交互提示可见', kg.hint === true);

  /* 点击一个非用户节点 → 详情出现 + 删除按钮出现。
     挑法：用户节点的文字就是账号名，排除它，取第一个带文字的实体节点。
     （上一版没排除，点中了用户节点 —— 它是核心、按设计不给删，于是"删除按钮
       没出现"被误读成功能坏。测删除功能必须先避开它。）

     3D 改造后注意两点：
       · 选择器换成节点专属的 g[data-kg-node]（不再是 g[transform^="translate"]，
         因为外层的节点容器没有 transform、真正的 translate 在内层 <g> 上）；
       · 点击前必须先**暂停自转**，否则"定位 → 点击"之间的一百多毫秒里节点
         已经随球体转走了，点击会落空。 */
  const pausedAlready = await page.getByTitle('继续旋转').count();
  if (pausedAlready === 0) {
    await page.getByTitle('暂停旋转').click();
    await page.waitForTimeout(600);
  }

  /* 怎么点中一个指定节点（3D 改造后必须这么做）：
     不能按坐标点。原因有二：
       1. 内层 <g> 的 translate 是投影前的世界坐标，还要过透视投影才上屏，
          用它反推屏幕坐标会偏；
       2. 更关键的是节点 DOM 每帧按深度重排序，球心附近的用户节点会盖在
          别的节点前面 —— 按坐标点"考试"，实际命中的是压在上面的 xiaoyu。
     所以这里**直接把 click 事件派发到目标元素本身**，不经过命中测试。
     React 的 onClick 走根节点事件委托，dispatchEvent 冒泡即可触发。
     这样测的是"点击节点 → 出现详情/删除按钮"这条逻辑，而不是碰运气的位置。 */
  const label = await page.evaluate((username) => {
    const svg = document.querySelector('svg[viewBox="0 0 900 560"]');
    if (!svg) return null;
    const groups = [...svg.querySelectorAll('g[data-kg="nodes"] > g[data-kg-node]')];
    const target = groups.find((g) => {
      const t = g.querySelector('text')?.textContent?.trim() ?? '';
      return t.length > 0 && t !== username && !t.startsWith(username);
    });
    if (!target) return null;
    const circle = target.querySelector('circle[fill="transparent"]')
      ?? [...target.querySelectorAll('circle')].pop();
    if (!circle) return null;
    circle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return target.querySelector('text')?.textContent?.trim();
  }, USER);
  const clickResult = label ? { label } : null;

  if (clickResult) {
    console.log(`  （选中节点：${clickResult.label}）`);
    // 点击已在 evaluate 里直接派发给目标元素（见上方说明），这里只需等渲染
    await page.waitForTimeout(300);
    /* 轮询等详情卡出现，不要固定 900ms 后就取样：
       3D 图谱里点中的节点会随即触发一次深度重排 + 选中辉光动画，
       固定等待容易在"详情已挂载但按钮还在渲染"的中间态取样，
       于是「删除按钮没出现」被误报成功能坏（实测手动等够时间是有的）。
       上限 8s，出现即通过。 */
    let detail = { hasDetail: false, hasDeleteBtn: false };
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(400);
      detail = await page.evaluate(() => {
        const text = document.body.textContent ?? '';
        return { hasDetail: /节点：/.test(text), hasDeleteBtn: /删除节点/.test(text) };
      });
      if (detail.hasDetail && detail.hasDeleteBtn) break;
    }
    ok('点击节点后显示详情', detail.hasDetail === true);
    ok('详情里出现「删除节点」按钮', detail.hasDeleteBtn === true);
    if (!detail.hasDeleteBtn) {
      // 诊断：打印详情卡里到底是哪个节点。用户节点按设计不给删，
      // 若点中的是它，就会呈现"有详情、无删除按钮"。
      const diag = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.ui-card')];
        const hit = cards.find((c) => /节点：/.test(c.textContent || ''));
        return hit ? (hit.textContent || '').replace(/\s+/g, ' ').slice(0, 140) : '(无详情卡)';
      });
      console.log(`  （诊断：实际选中的节点 = ${diag}）`);
    }

    const delBtn = page.getByRole('button', { name: '删除节点' });
    if (await delBtn.count()) {
      await delBtn.first().click();
      await page.waitForTimeout(700);
      const dlg = await page.evaluate(() => {
        const text = document.body.textContent ?? '';
        return {
          title: /从图谱中删除/.test(text),
          scope: /只影响你自己的图谱/.test(text),
          confirm: /确认删除/.test(text),
        };
      });
      ok('删除前弹出确认', dlg.title === true);
      ok('确认框说明影响范围（不波及其他用户）', dlg.scope === true);
      ok('确认框有「确认删除」按钮', dlg.confirm === true);
      /* 取消收尾，别真删了用户的测试数据 */
      const cancel = page.getByRole('button', { name: '取消' });
      if (await cancel.count()) await cancel.first().click();
      await page.waitForTimeout(400);
      console.log('  （已取消，未真正删除数据）');
    } else {
      ok('详情里出现「删除节点」按钮', false, '按钮未找到');
    }
  } else {
    ok('能在图谱中找到可删除的实体节点', false, '当前用户图谱里没有非用户节点');
  }

  /* ── 控制台干净度 ─────────────────────────────────────────────────── */
  console.log('\n[6] 控制台');
  const real = consoleErrors.filter(
    (t) => !/favicon|Download the React DevTools|Warning: ReactDOM.render/i.test(t),
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
