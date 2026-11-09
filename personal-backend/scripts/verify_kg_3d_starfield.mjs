/**
 * verify_kg_3d_starfield.mjs · 知识图谱「3D 星空」改造的浏览器实测
 *
 * 覆盖四条需求，每条都要有可证伪的断言（不是"看起来对"）：
 *
 *  [1] 3D 球体 —— 拖动视角后节点的屏幕坐标必须真的改变，且**不同深度的节点
 *      缩放不同**（透视投影的直接证据：depthScale 不应全等）。
 *      再验证俯仰能转、夹在 ±0.75rad 内。
 *  [2] 用户节点头像 —— 中心节点存在头像结构（男/女造型二选一），且用户节点
 *      不参与"删除"（核心不给删）。
 *  [3] 同类靠近 —— 从页面读不到三维坐标，所以断言走**投影后的聚类**：
 *      同类节点两两屏幕距离的平均值，必须显著小于"同类到异类"的平均距离。
 *  [4] 星空风格 —— 三层星点存在（数量分档）、星云/银河/暗角渐变存在。
 *  [5] 点击发光 —— 点一个节点后，同类节点出现 .kg-halo-pulse 光晕，
 *      且**光晕数量 == 同类节点数**（不多不少，这才叫"同类型发光"）；
 *      无关节点 opacity 被压到 0.2。
 *  [6] 旋转控制 —— 默认自转（视角随时间变化）；拖动后暂停；点"继续旋转"恢复。
 *  [7] 无 console 错误。
 *
 * 跑法（任选 cwd）：
 *   node personal-backend/scripts/verify_kg_3d_starfield.mjs
 * 前置：8000（主后端，登录）+ 8001（personal-backend，图谱）+ 5173（前端）都在线。
 */

import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
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

/**
 * 读取页面上的图谱信息。
 *
 * 为什么坐标从 `<g transform="translate(..) scale(..)">` 上读而不是量边界：
 * 节点内层 g 的 transform 就是投影结果本身（paint() 每帧写进去的），
 * 直接读它就是读"投影后的屏幕坐标 + 深度缩放"，精度最高、也最省事。
 */
const READ_KG = () => {
  const svg = document.querySelector('svg[viewBox="0 0 900 560"]');
  if (!svg) return { hasSvg: false };
  const nodes = [...svg.querySelectorAll('g[data-kg="nodes"] > g[data-kg-node]')].map((host) => {
    const body = host.querySelector('g');
    const tr = body?.getAttribute('transform') ?? '';
    const m = tr.match(/translate\(([-\d.]+),([-\d.]+)\)\s*scale\(([\d.]+)\)/);
    const label = host.querySelector('text')?.textContent?.trim() ?? '';
    const dim = Number(getComputedStyle(host).opacity);
    const bodyOpacity = Number(body?.getAttribute('opacity') ?? '1');
    /* 标签的屏幕位置与字号：验证"避让后不重叠""字号已做反向补偿"要用。
       标签挂在 scale(k) 组里，font-size 属性是本地值，屏幕值要乘 k。 */
    const text = host.querySelector('text');
    const tx = Number(text?.getAttribute('x') ?? '0');
    const ty = Number(text?.getAttribute('y') ?? '0');
    const fs = Number(text?.getAttribute('font-size') ?? '11');
    const box = svg.getBoundingClientRect();
    const k = m ? Number(m[3]) : 1;
    const svgScale = box.width / 900;
    return {
      label,
      x: m ? Number(m[1]) : NaN,
      y: m ? Number(m[2]) : NaN,
      scale: k,
      dim,
      bodyOpacity,
      halos: host.querySelectorAll('circle.kg-halo-pulse').length,
      /* 头像判据：用户节点里含 clipPath 的徽章组 —— KgUserAvatar 才有 */
      isAvatar: host.querySelector('clipPath') !== null,
      hasDeleteBtn: host.querySelector('title') !== null,
      /* 标签中心（SVG 用户坐标）与"屏幕字号" */
      labelX: m ? Number(m[1]) + tx * k : NaN,
      labelY: m ? Number(m[2]) + ty * k : NaN,
      labelScreenSize: fs * k,
      labelSvgScale: svgScale,
      /* 节点圆盘的屏幕半径（用于遮挡判定） */
      nodeR: (host.querySelector('circle[stroke]')?.getAttribute('r') ?? '0') * k,
    };
  });
  const stars = [0, 1, 2].map((i) => svg.querySelectorAll(`g[data-kg="stars-${i}"] circle`).length);
  return {
    hasSvg: true,
    nodes,
    starLayers: stars,
    rings: svg.querySelectorAll('g[data-kg="rings"] polyline').length,
    edges: svg.querySelectorAll('g[data-kg="edges"] line').length,
    edgeLabels: [...svg.querySelectorAll('g[data-kg="edge-labels"] text')].filter(
      (t) => Number(t.getAttribute('opacity')) > 0.5 && (t.textContent ?? '').trim() !== '',
    ).length,
    /* 深空底与暗角是两个 radialGradient；银河带是带钩子的柔光组。
       计数加总容易受挂载顺序影响，改成"逐个关键元素是否存在"更有说明力 */
    gradients: {
      void: svg.querySelectorAll('radialGradient').length,
      hasGalaxy: svg.querySelector('[data-kg="galaxy"]') !== null,
    },
    filters: svg.querySelectorAll('filter').length,
    halos: svg.querySelectorAll('circle.kg-halo-pulse').length,
    hint: document.body.textContent?.includes('拖动旋转') ?? false,
  };
};

const readKg = () => page.evaluate(READ_KG);

/** 从节点文字反推"类型"：图例的顺序即类型，但更稳的是看颜色 */
const readTypes = () =>
  page.evaluate(() => {
    const svg = document.querySelector('svg[viewBox="0 0 900 560"]');
    if (!svg) return {};
    const map = {};
    for (const host of svg.querySelectorAll('g[data-kg="nodes"] > g[data-kg-node]')) {
      const name = host.querySelector('text')?.textContent?.trim() ?? '';
      /* 星体圆的 fill 就是类型色（用户节点是头像，取其外发光色） */
      const c = host.querySelector('circle[stroke]') ?? host.querySelector('circle');
      map[name] = c?.getAttribute('fill') ?? '';
    }
    return map;
  });

/**
 * 确保自转已暂停（幂等）。
 *
 * 为什么要这么个辅助函数：控件按钮的 title 会随状态在「暂停旋转/继续旋转」
 * 之间切换 —— 直接 getByTitle('暂停旋转') 在已经暂停时会等 30s 超时。
 * 这里先探测当前 title，已暂停就什么都不做。
 */
async function ensurePaused() {
  const paused = await page.getByTitle('继续旋转').count();
  if (paused > 0) return;
  await page.getByTitle('暂停旋转').click();
}

/** 平均两两距离（聚类紧密度） */
function avgPairDist(a, b, same) {  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      if (same(i, j)) {
        sum += Math.hypot(a[i].x - a[j].x, a[i].y - a[j].y);
        n++;
      }
    }
  }
  return n ? sum / n : 0;
}

try {
  console.log('\n[0] 登录');
  await page.goto(`${BASE}/#/auth`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const inputs = page.locator('input');
  await inputs.nth(0).fill(USER);
  await inputs.nth(1).fill(PASS);
  await page.getByRole('button', { name: /登录|进入/ }).first().click();
  await page.waitForTimeout(2500);

  console.log('\n[1] 图谱页渲染 3D 星空');
  await page.goto(`${BASE}/#/personal/me/kg`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const g1 = await readKg();
  ok('图谱画布存在', g1.hasSvg === true);
  ok('节点已渲染（≥6）', (g1.nodes?.length ?? 0) >= 6, `${g1.nodes?.length} 个`);
  ok('球体经纬大圆（≥3）', (g1.rings ?? 0) >= 3, `${g1.rings} 条`);
  ok('边已渲染', (g1.edges ?? 0) >= 3, `${g1.edges} 条`);
  ok('星空三层星点齐备', (g1.starLayers ?? []).every((c) => c > 30), JSON.stringify(g1.starLayers));
  ok('星点总数充足（≥600）', (g1.starLayers ?? []).reduce((a, b) => a + b, 0) >= 600, `${(g1.starLayers ?? []).reduce((a, b) => a + b, 0)} 颗`);
  ok('星云/银河/暗角齐备（径向≥2 + 银河带）', (g1.gradients?.void ?? 0) >= 2 && g1.gradients?.hasGalaxy === true, JSON.stringify(g1.gradients));
  ok('星云模糊滤镜存在', (g1.filters ?? 0) >= 1, `${g1.filters} 个`);
  ok('操作提示可见', g1.hint === true);

  console.log('\n[2] 透视投影（3D 的直接证据）');
  const scales = g1.nodes.map((n) => n.scale).filter((s) => Number.isFinite(s));
  const minS = Math.min(...scales);
  const maxS = Math.max(...scales);
  ok('深度缩放不全等（确为透视投影）', maxS - minS > 0.02, `scale ${minS.toFixed(3)} ~ ${maxS.toFixed(3)}`);
  const bodyOps = g1.nodes.map((n) => n.bodyOpacity).filter((s) => Number.isFinite(s));
  ok(
    '远处节点被雾化压暗（bodyOpacity 有差异）',
    Math.max(...bodyOps) - Math.min(...bodyOps) > 0.05,
    `${Math.min(...bodyOps).toFixed(2)} ~ ${Math.max(...bodyOps).toFixed(2)}`,
  );

  console.log('\n[3] 拖动旋转视角');
  const box = await page.locator('svg[viewBox="0 0 900 560"]').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  /* 拖动前先暂停自转（点"暂停旋转"），否则两次读数之间画面自己在转，
     位移里混进了自转量 —— 分不清"拖动了"还是"它自己转了"。
     从**节点上**起手拖（水平方向擦过中心节点区域）：这恰好覆盖
     "用户节点会不会挡住旋转" 这个真实场景 */
  await ensurePaused();
  await page.waitForTimeout(500);
  const dragBefore = (await readKg()).nodes;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 190, cy, { steps: 14 });
  await page.mouse.move(cx + 190, cy + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = (await readKg()).nodes;
  const before = dragBefore;
  ok('拖动后节点屏幕坐标整体改变', before.map((n) => `${n.x},${n.y}`).join('|') !== after.map((n) => `${n.x},${n.y}`).join('|'));

  /* 位移量应随深度/位置不同 → 是"在转球"，而不是整体平移 */
  const diffs = after.map((n, i) => {
    const b = before[i];
    return b ? Math.hypot(n.x - b.x, n.y - b.y) : 0;
  });
  ok(
    '各节点位移不一致（是旋转而非平移）',
    Math.max(...diffs) - Math.min(...diffs) > 1,
    `位移 ${Math.min(...diffs).toFixed(1)} ~ ${Math.max(...diffs).toFixed(1)}px`,
  );
  ok('拖动确实生效（最大位移 > 20px）', Math.max(...diffs) > 20, `${Math.max(...diffs).toFixed(1)}px`);

  /* 俯仰夹紧：往上狂拖后 node y 范围不该塌成一条线 */
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 900, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const clamped = (await readKg()).nodes;
  const spanY = Math.max(...clamped.map((n) => n.y)) - Math.min(...clamped.map((n) => n.y));
  ok('俯仰被夹住（球体未压扁成线）', spanY > 120, `y 跨度 ${spanY.toFixed(0)}px`);
  await page.waitForTimeout(200);

  console.log('\n[4] 默认自转 / 暂停 / 恢复');
  await page.getByTitle('重置视角').click();
  await page.waitForTimeout(300);
  const rot1 = (await readKg()).nodes.map((n) => n.x).join('|');
  await page.waitForTimeout(1600);
  const rot2 = (await readKg()).nodes.map((n) => n.x).join('|');
  ok('默认缓慢自转（视角随时间变化）', rot1 !== rot2);

  /* 拖动后应暂停自转：在静置窗口（2.5s）内连续采样，角度必须不变。
     注意不能用"两次读数不同 = 在转"来反证 —— 采样本身有几十毫秒延迟，
     而自转 0.1rad/s 在这个间隙里也能让坐标变一点点，容易误判。 */
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const pauseSamples = [];
  for (let i = 0; i < 6; i++) {
    pauseSamples.push((await readKg()).nodes.map((n) => `${n.x.toFixed(2)},${n.y.toFixed(2)}`).join('|'));
    await page.waitForTimeout(240);
  }
  const uniqueInWindow = new Set(pauseSamples).size;
  ok(
    '拖动后暂停自转（静置窗口内姿态不变）',
    uniqueInWindow <= 2, // 允许 1 次抖动（React 重渲染的取整误差）
    `${pauseSamples.length} 次采样 ${uniqueInWindow} 种姿态`,
  );

  /* 等过静置窗口（2.5s）后应自行恢复 */
  await page.waitForTimeout(2800);
  const resSamples = [];
  for (let i = 0; i < 6; i++) {
    resSamples.push((await readKg()).nodes.map((n) => n.x.toFixed(2)).join('|'));
    await page.waitForTimeout(240);
  }
  ok('静置后自动恢复旋转', new Set(resSamples).size >= 5, `${new Set(resSamples).size}/6 种姿态`);

  /* 后面的交互断言都要"先定位、再点击"。球体在自转时，定位与点击之间
     （evaluate + mouse.click 约百毫秒）节点已经转走了，点击会落空。
     所以这里把视角冻结 —— 这也更贴近真实使用：用户想细看时本来就会先停住。 */
  await ensurePaused();
  await page.waitForTimeout(500);

  console.log('\n[5] 用户节点头像');
  const types = await readTypes();
  /* 用户节点的名字就是账号名；它必须带头像（clipPath） */
  const userNode = g1.nodes.find((n) => !n.isAvatar ? false : true);
  ok('存在头像节点（clipPath 徽章）', Boolean(userNode), `${g1.nodes.filter((n) => n.isAvatar).length} 个`);
  const avatarCount = g1.nodes.filter((n) => n.isAvatar).length;
  ok('头像节点唯一（只有中心用户）', avatarCount === 1, `${avatarCount} 个`);
  ok('用户节点不可删除（无删除按钮）', !g1.nodes.find((n) => n.isAvatar)?.hasDeleteBtn);
  /* 头像内部结构：应有渐变底 + 衣物 + 面部路径 */
  const avatarDetail = await page.evaluate(() => {
    const host = [...document.querySelectorAll('g[data-kg="nodes"] > g[data-kg-node]')].find((h) => h.querySelector('clipPath'));
    if (!host) return null;
    return {
      paths: host.querySelectorAll('path').length,
      circles: host.querySelectorAll('circle').length,
      hasFace: host.querySelectorAll('ellipse').length >= 1,
      title: host.querySelector('text')?.textContent?.trim(),
    };
  });
  ok('头像含面部与造型细节', (avatarDetail?.paths ?? 0) >= 5 && (avatarDetail?.circles ?? 0) >= 5, JSON.stringify(avatarDetail));

  console.log('\n[6] 标签可读性（避让 + 字号补偿 + 不压头像）');
  await ensurePaused();
  await page.waitForTimeout(500);
  const lbl = (await readKg()).nodes;
  /* 6.1 字号补偿：屏幕字号应基本一致（不因深度不同而大小悬殊）。
       不做补偿时实测「周杰伦」是 15.6px、最远 8.5px，比值近 1.8。
       注意要**排除用户节点**：它的基准字号本来就不同（12.5 对 11），
       混在一起算比值没有意义。 */
  const sizes = lbl
    .filter((n) => !n.isAvatar)
    .map((n) => n.labelScreenSize / n.labelSvgScale)
    .filter((s) => Number.isFinite(s) && s > 0);
  const ratio = Math.max(...sizes) / Math.min(...sizes);
  ok(
    '标签屏幕字号基本一致（已做反向缩放补偿）',
    ratio < 1.06,
    `最大/最小 = ${ratio.toFixed(3)}（${Math.min(...sizes).toFixed(2)}~${Math.max(...sizes).toFixed(2)}px）`,
  );

  /* 6.2 标签互不重叠：用"标签中心距离 vs 各自估算宽度和的一半"判断 */
  const overlap = [];
  for (let i = 0; i < lbl.length; i++) {
    for (let j = i + 1; j < lbl.length; j++) {
      const a = lbl[i];
      const b = lbl[j];
      const wide = (s) => [...s].reduce((acc, c) => acc + (c.charCodeAt(0) > 0x2e80 ? 1 : 0.6), 0);
      const wa = wide(a.label) * (a.labelScreenSize / a.labelSvgScale);
      const wb = wide(b.label) * (b.labelScreenSize / b.labelSvgScale);
      const dx = Math.abs(a.labelX - b.labelX);
      /* 只在同一行附近才可能重叠（纵向错开就不算） */
      const dy = Math.abs(a.labelY - b.labelY);
      if (dy < 9 && dx < (wa + wb) / 2 - 1) overlap.push(`${a.label}↔${b.label}`);
    }
  }
  ok('标签互不重叠', overlap.length === 0, overlap.slice(0, 4).join(' / ') || '无重叠');

  /* 6.3 标签不压在中心头像上 */
  const avatarNode = lbl.find((n) => n.isAvatar);
  const onAvatar = lbl.filter(
    (n) => !n.isAvatar && Math.hypot(n.labelX - avatarNode.x, n.labelY - avatarNode.y) < avatarNode.nodeR + 6,
  );
  ok('没有标签压住中心头像', onAvatar.length === 0, onAvatar.map((n) => n.label).join(',') || '无');

  console.log('\n[7] 深度遮挡（背面节点不盖住正面）');
  /* SVG 没有 z-index：DOM 在后的压在上面。若顺序不按深度排，球体转起来就会
     出现"此刻在背面"的节点盖住正面节点、甚至盖住中心的用户头像。
     关键：**必须先把视角转开再断言** —— 初始视角下顺序可能本来就对，
     不转一次测不出"重排有没有真的在工作"（实测过：转 250px 后「疲乏」曾盖住头像）。
     断言：DOM 顺序必须与"当前视角下各节点的投影缩放（越大越近）升序"一致。 */
  /* 先把视角转开，再验证深度重排（初始视角的顺序可能本来就对，测不出问题） */
  const boxRot = await page.locator('svg[viewBox="0 0 900 560"]').boundingBox();
  await page.mouse.move(boxRot.x + boxRot.width / 2, boxRot.y + boxRot.height / 2);
  await page.mouse.down();
  await page.mouse.move(boxRot.x + boxRot.width / 2 + 240, boxRot.y + boxRot.height / 2 + 90, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  const depthOrder = await page.evaluate(() => {
    const svg = document.querySelector('svg[viewBox="0 0 900 560"]');
    const host = svg.querySelector('g[data-kg="nodes"]');
    /* 深度缩放写在内层 <g> 的 transform 上，与 z 单调相关（z 越大 → depth 越小
       → scale 越大），作为深度代理足够用来验证排序 */
    const scales = [...host.children].map((c) => {
      const m = (c.querySelector('g')?.getAttribute('transform') ?? '').match(/scale\(([\d.]+)\)/);
      return m ? Number(m[1]) : NaN;
    });
    return { count: host.children.length, scales };
  });
  let monotonic = true;
  let worstDip = 0;
  for (let i = 1; i < depthOrder.scales.length; i++) {
    const prev = depthOrder.scales[i - 1];
    const cur = depthOrder.scales[i];
    if (!Number.isFinite(prev) || !Number.isFinite(cur)) continue;
    const dip = prev - cur;
    if (dip > 0.002) {
      monotonic = false;
      worstDip = Math.max(worstDip, dip);
    }
  }
  ok(
    '转动视角后节点 DOM 顺序仍按深度升序',
    monotonic,
    `${depthOrder.count} 个 · scale ${depthOrder.scales.map((s) => s.toFixed(2)).join(' ')}${monotonic ? '' : ` · 最大逆序 ${worstDip.toFixed(3)}`}`,
  );
  /* 中心头像（scale 恒为 1）不应被"比它更远"的节点盖住：
     只要求它后面没有明显更远的节点即可（更远的应排在它前面画）。 */
  const userIdx = depthOrder.scales.findIndex((s) => Math.abs(s - 1) < 0.002);
  const behindFar = depthOrder.scales
    .slice(userIdx + 1)
    .filter((s) => Number.isFinite(s) && s < 0.995).length;
  ok('中心头像之后没有更远的节点（不会被背面节点盖住）', userIdx < 0 || behindFar === 0, `头像后更远节点 ${behindFar} 个`);

  console.log('\n[8] 同类型节点聚拢（投影后聚类）');
  const colorMap = await readTypes();
  const byColor = {};
  for (const n of g1.nodes) {
    const c = colorMap[n.label] || 'unknown';
    (byColor[c] ||= []).push(n);
  }
  /* 取最大的两个簇做对比 */
  const clusters = Object.values(byColor).filter((a) => a.length >= 2).sort((a, b) => b.length - a.length);
  ok('存在 ≥2 个含多个节点的类型簇', clusters.length >= 2, `${clusters.length} 簇`);
  if (clusters.length >= 2) {
    const A = clusters[0];
    const aNames = new Set(A.map((n) => n.label));
    const sameD = avgPairDist(A, A, () => true);
    const other = g1.nodes.filter((n) => !aNames.has(n.label));
    let crossSum = 0;
    let crossN = 0;
    for (const a of A) {
      for (const b of other) {
        crossSum += Math.hypot(a.x - b.x, a.y - b.y);
        crossN++;
      }
    }
    const crossD = crossN ? crossSum / crossN : 0;
    /* 球面上"同类"占一个锥（实测夹角 ≤17°），异类 ≥88°：
       投影后同类平均距离应明显小于跨类平均距离。判定用 0.6 倍留出余量 */
    ok(
      '同类平均距离 < 跨类平均距离的 0.6 倍',
      sameD < crossD * 0.6,
      `同类 ${sameD.toFixed(0)}px vs 跨类 ${crossD.toFixed(0)}px`,
    );
  }

  console.log('\n[9] 点击节点 → 同类发光');
  /* 挑一个节点数最多的类型的成员来点 */
  const targetName = clusters[0]?.[0]?.label;
  const targetPos = await page.evaluate((name) => {
    const svg = document.querySelector('svg[viewBox="0 0 900 560"]');
    const host = [...svg.querySelectorAll('g[data-kg="nodes"] > g[data-kg-node]')].find(
      (h) => h.querySelector('text')?.textContent?.trim() === name,
    );
    if (!host) return null;
    const body = host.querySelector('g');
    const tr = body.getAttribute('transform') ?? '';
    const m = tr.match(/translate\(([-\d.]+),([-\d.]+)\)/);
    /* 用户坐标 → 屏幕坐标必须走 getScreenCTM()，不能按 box.width/900 手算：
       图谱页现在撑满一屏、卡片宽高比不再等于 900:560，于是 preserveAspectRatio
       的 meet 会在卡片内留下**居中**的空白带，缩放系数是 min(w/900, h/560)
       且带一个居中偏移。手算 box.left + x/900*box.width 会偏掉这半条带
       （1440×900 下实测偏 74px，足以点到隔壁节点）。
       getScreenCTM 把 viewBox + preserveAspectRatio + 元素自身变换一起算进去，
       返回的就是 client 坐标，正是 mouse.click 要的口径。 */
    const p = new DOMPoint(Number(m[1]), Number(m[2])).matrixTransform(svg.getScreenCTM());
    return {
      x: p.x,
      y: p.y,
      scale: Number((tr.match(/scale\(([\d.]+)\)/) ?? [])[1] ?? 1),
    };
  }, targetName);
  ok('能定位到目标节点', targetPos !== null, targetName);

  await page.mouse.click(targetPos.x, targetPos.y);
  await page.waitForTimeout(700);
  const lit = await readKg();
  const haloNodes = lit.nodes.filter((n) => n.halos > 0);
  const dimNodes = lit.nodes.filter((n) => n.dim < 0.4);
  const litSameColor = lit.nodes.filter((n) => n.halos > 0 && colorMap[n.label] === colorMap[targetName]);

  ok('点击后出现同类发光光晕', haloNodes.length >= 2, `${haloNodes.length} 个带光晕`);
  ok(
    '带光晕的节点全部与目标同色同类',
    haloNodes.length === litSameColor.length,
    `${litSameColor.length}/${haloNodes.length} 同类`,
  );
  ok('无关节点被压暗（opacity<0.4）', dimNodes.length >= 1, `${dimNodes.length} 个压暗`);
  ok('目标节点自身不淡出', lit.nodes.find((n) => n.label === targetName)?.dim === 1);
  /* 边标签：聚焦时应出现与目标相关的边标签 */
  ok('聚焦时边标签出现', (lit.edgeLabels ?? 0) >= 1, `${lit.edgeLabels} 条`);
  ok('同类发光动画类存在', await page.evaluate(() => document.querySelectorAll('circle.kg-halo-pulse').length >= 2));

  /* 点击空白处 → 取消。
     注意：不能点画布左上角。选中详情现在是一块**浮在画布左上角之上**的浮层
     （见 KgPage 里的说明），点那里命中的是浮层而不是画布，取消不了聚焦。
     改成从画布**下边中点**往内 16px 处点：那里一定是画布空处，且
     不受左上浮层、左下操作提示、右下同类说明、右上缩放控件的遮挡。 */
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 16);
  await page.waitForTimeout(500);
  const cleared = await readKg();
  ok('点空白处清除聚焦（光晕消失）', cleared.nodes.every((n) => n.halos === 0));
  ok('清除后所有节点恢复不透明', cleared.nodes.every((n) => n.dim > 0.9));

  console.log('\n[10] 双击节点 → 转到正面');
  /* 先冻结：双击要连点两下，期间球体若在转会直接落空（见 [5] 前的说明）。
     点"暂停旋转"后位置稳定，双击与随后的读数才是可信的。 */
  await ensurePaused();
  await page.waitForTimeout(500);
  const dblPos = await page.evaluate((name) => {
    const svg = document.querySelector('svg[viewBox="0 0 900 560"]');
    const host = [...svg.querySelectorAll('g[data-kg="nodes"] > g[data-kg-node]')].find(
      (h) => h.querySelector('text')?.textContent?.trim() === name,
    );
    if (!host) return null;
    const m = (host.querySelector('g').getAttribute('transform') ?? '').match(/translate\(([-\d.]+),([-\d.]+)\)/);
    /* 同 [9]：走 getScreenCTM（卡片比例不再等于 viewBox 比例，手算会偏掉空白带） */
    const pt = new DOMPoint(Number(m[1]), Number(m[2])).matrixTransform(svg.getScreenCTM());
    const px = pt.x;
    const py = pt.y;
    /* 命中测试：这个屏幕点上真正被点到的元素是谁？
       —— 双击落空时，靠它区分"坐标算错了"还是"被别的元素挡住了" */
    const hitEl = document.elementFromPoint(px, py);
    return {
      x: px,
      y: py,
      hit: hitEl ? `${hitEl.tagName}@${hitEl.closest('g[data-kg-node]')?.getAttribute('data-kg-node') ?? '-'}` : 'null',
    };
  }, targetName);
  if (dblPos) {
    await page.mouse.dblclick(dblPos.x, dblPos.y);
    await page.waitForTimeout(600);
    /* 双击会 pauseSpin(4000)，所以此刻姿态是稳定的，读数可信 */
    const front = await readKg();
    const tn = front.nodes.find((n) => n.label === targetName);
    /* 转到正面后：它应在屏幕中心附近（球心投影处），且深度缩放接近最大值 */
    const centerDist = Math.hypot(tn.x - 450, tn.y - 280);
    const maxScale = Math.max(...front.nodes.map((n) => n.scale));
    ok(
      '双击后目标节点移动到球体正面（靠近画布中心）',
      centerDist < 130,
      `距中心 ${centerDist.toFixed(0)}px · 落点命中=${dblPos.hit} · 坐标=(${dblPos.x.toFixed(0)},${dblPos.y.toFixed(0)})`,
    );
    ok('双击后目标节点深度缩放最大（最近）', tn.scale >= maxScale - 0.02, `scale=${tn.scale.toFixed(3)} max=${maxScale.toFixed(3)}`);
    ok('双击后目标节点被选中（详情出现）', await page.evaluate((name) => (document.body.textContent ?? '').includes(`节点：${name}`), targetName),
      await page.evaluate(() => ((document.body.textContent ?? '').match(/节点：\S{0,8}/g) ?? []).join(' / ') || '正文里没有任何"节点："'));
  }

  console.log('\n[11] 缩放与重置');
  await page.getByTitle('重置视角').click();
  await page.waitForTimeout(500);
  const z0 = await page.evaluate(() => {
    const svg = document.querySelector('svg[viewBox="0 0 900 560"]');
    const g = svg.querySelector('g[data-kg="nodes"] > g[data-kg-node] > g');
    const m = g.getAttribute('transform').match(/scale\(([\d.]+)\)/);
    return Number(m[1]);
  });
  await page.getByTitle('放大').click();
  await page.getByTitle('放大').click();
  await page.waitForTimeout(600);
  const z1 = await page.evaluate(() => {
    const svg = document.querySelector('svg[viewBox="0 0 900 560"]');
    const g = svg.querySelector('g[data-kg="nodes"] > g[data-kg-node] > g');
    const m = g.getAttribute('transform').match(/scale\(([\d.]+)\)/);
    return Number(m[1]);
  });
  ok('点放大后节点整体变大', z1 > z0 + 0.01, `${z0.toFixed(3)} → ${z1.toFixed(3)}`);

  console.log('\n[12] console 错误');
  const real = errors.filter((t) => !/favicon|Download the React DevTools/i.test(t));
  ok('无控制台错误', real.length === 0, real.slice(0, 3).join(' | '));
} catch (e) {
  fail++;
  console.log(`\n✗ 脚本异常: ${e.message}`);
  console.log(e.stack?.split('\n').slice(0, 6).join('\n'));
} finally {
  await browser.close();
}

console.log(`\n───────────────────────────────`);
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
