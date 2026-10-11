#!/usr/bin/env node
/**
 * build-bundle.mjs · 把 prototype/ 打成单文件 HTML
 * -----------------------------------------------------------------------------
 * 为什么需要它：原型有 16 个页面 + 一份外壳脚本 + 若干交互脚本，
 * 直接发给别人容易漏文件、也容易被当成「素材」而不是「能点的东西」。
 * 这里把 CSS / JS / 截图全部内联，再用 hash 路由换页，产出一个
 * 双击即用、断网可看的单文件。
 *
 * 用法：node scripts/build-bundle.mjs
 * 产物：原型-单文件.html
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/* JSON 放进 <script> 块时必须转义 </script 与 <!--，
   否则 HTML 解析器会在这些位置提前结束脚本块（正文里含内联脚本，必然踩到）。 */
function safeJson(value) {
  return JSON.stringify(value)
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\u0021--');
}

const ROOT = path.resolve(import.meta.dirname, '..');
const PAGES_DIR = path.join(ROOT, 'pages');
const OUT = path.join(ROOT, process.argv.includes('--no-shots') ? '原型-轻量版.html' : '原型-单文件.html');

const read = (p) => readFileSync(p, 'utf8');

/* ---------------------------------------------------------------------------
   1) 样式：四份 CSS 合成一份
--------------------------------------------------------------------------- */
const CSS_FILES = ['assets/fonts/fonts.css', 'assets/tokens.css', 'assets/base.css', 'assets/shell.css'];
const FONTS_CSS = read(path.join(ROOT, 'assets/fonts/fonts.css'));
const css = [CSS_FILES[1], CSS_FILES[2], CSS_FILES[3]]
  .map((f) => read(path.join(ROOT, f)))
  .join('\n\n');

/* 字体：把 woff2 也内联，否则单文件在别人机器上会退化成系统字体 */
const fontsDir = path.join(ROOT, 'assets/fonts');
const fontInline = FONTS_CSS.replace(/url\('\.\/([^']+)'\)/g, (m, file) => {
  const p = path.join(fontsDir, file);
  if (!existsSync(p)) return m;
  return `url(data:font/woff2;base64,${readFileSync(p).toString('base64')})`;
});

/* ---------------------------------------------------------------------------
   2) 外壳脚本：shell.js 原样用；app.js 里「读本机偏好」那两段在单文件里
      必须由外层路由统一决定，否则换页会被上一次的选择覆盖。

   注意：shell.js 里的 NAV 是用 JS 字符串拼出侧边栏链接的
   （{ href: 'admin-screenings.html' } -> '<a href="' + it.href + '">'），
   第 75 行那个只针对 HTML 属性的 href 改写**匹配不到它们**。若不处理，
   点击侧边栏会变成「真实文件导航」而不是 hash 换页：
   - 单文件版：跳向不存在的 admin-screenings.html（404）
   - 嵌在 iframe 里时：相对地址按父页面解析，同样 404
   所以这里把 NAV 的 href 也统一改写成路由 hash。
--------------------------------------------------------------------------- */
const NAV_HREF_RE = /href:\s*(["'])([A-Za-z0-9_-]+)\.html\1/g;
const shellJs = read(path.join(ROOT, 'assets/shell.js')).replace(
  NAV_HREF_RE,
  (m, q, name) => `href: ${q}#/pages/${name}.html${q}`,
);
let appJs = read(path.join(ROOT, 'assets/app.js'));

/* ---------------------------------------------------------------------------
   3) 逐页抽取：正文 + body 属性 + 页面自己的脚本 + 标题
--------------------------------------------------------------------------- */
function extract(pagePath) {
  const html = read(pagePath);
  const title = (html.match(/<title>([^<]*)<\/title>/) || [, ''])[1];
  const bodyAttr = (html.match(/<body([^>]*)>/) || [, ''])[1].trim();
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || [, ''])[1];

  // 页面自有脚本（排除引外部文件的那些）
  const scripts = [];
  let content = body.replace(/<script([^>]*)>([\s\S]*?)<\/script>/g, (m, attrs, code) => {
    if (/\ssrc=/.test(attrs)) return ''; // app.js / shell.js 由外层提供
    scripts.push(code);
    return '';
  });

  // 站内链接改写为路由 hash；.html 后缀在 hash 里留着，最省事也最可读
  content = content.replace(/href="([^"#][^"]*?)\.html(#[^"]*)?"/g, (m, target, frag) => {
    const t = target.replace(/^\.\.\//, '').replace(/^\.\//, '');
    const normalized = t.startsWith('pages/') || t === 'index' ? t : `pages/${t}`;
    const state = frag ? `?${frag.replace(/^#/, '')}` : '';
    return `href="#/${normalized}.html${state}"`;
  });
  return { title, bodyAttr, content: content.trim(), scripts };
}

const pageFiles = readdirSync(PAGES_DIR).filter((f) => f.endsWith('.html')).sort();
const pages = {};
for (const f of pageFiles) {
  pages[`pages/${f}`] = extract(path.join(PAGES_DIR, f));
}
const indexPage = extract(path.join(ROOT, 'index.html'));
pages['index.html'] = indexPage;

/* 首页 = index.html；没有 data-shell，所以要按它自己的 body 属性渲染 */
const HOME = 'index.html';

/* ---------------------------------------------------------------------------
   4) 截图：转 WebP 内联（PNG 原图 16MB，直接 base64 会到 21MB）
--------------------------------------------------------------------------- */
const SHOT_W = 1440;
const SHOT_Q = 74;
const shotsDir = path.join(ROOT, 'screenshots');
const webpDir = path.join(ROOT, '.shots-webp');
const py = process.env.DSH_PYTHON || 'python3';
const LIGHT = process.argv.includes('--no-shots');
const shotNames = LIGHT ? [] : readdirSync(shotsDir).filter((f) => f.endsWith('.png')).sort();
if (LIGHT) console.log('（轻量模式：跳过截图内联）');

let shotMap = {};
if (shotNames.length) {
  const conv = `
import os, glob
from PIL import Image
src, dst, w, q = ${JSON.stringify(shotsDir)}, ${JSON.stringify(webpDir)}, ${SHOT_W}, ${SHOT_Q}
os.makedirs(dst, exist_ok=True)
for f in sorted(glob.glob(os.path.join(src, '*.png'))):
    im = Image.open(f).convert('RGB')
    if im.width > w:
        im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    out = os.path.join(dst, os.path.splitext(os.path.basename(f))[0] + '.webp')
    im.save(out, 'WEBP', quality=q, method=5)
print(len(glob.glob(os.path.join(dst, '*.webp'))))
`;
  execFileSync(py, ['-c', conv], { stdio: ['ignore', 'pipe', 'inherit'] });
  for (const f of readdirSync(webpDir)) {
    const key = f.replace(/\.webp$/, '');
    shotMap[key] = `data:image/webp;base64,${readFileSync(path.join(webpDir, f)).toString('base64')}`;
  }
}

/* 截图的说明（与 screenshots/README.md 的表一致，用于画廊副标题） */
const SHOT_CAPTIONS = {
  'index-light': '原型门面',
  'system-selector': '选择系统',
  'login-light': '登录页',
  'personal-home-light': '个人首页',
  'personal-screening': '心理筛查 · 作答中',
  'personal-screening-safety': '心理筛查 · 第 9 题安全提示',
  'personal-screening-result': '心理筛查 · 分段结果',
  'personal-collect': '多模态采集 · 语音',
  'personal-collect-image': '多模态采集 · 图像',
  'personal-retrieval-light': '检索与分析',
  'personal-rag': 'RAG 分析结果',
  'personal-alerts': '预警中心',
  'personal-profile': '我的档案',
  'admin-dashboard': '数据概览',
  'admin-screenings': '筛查管理',
  'admin-collect': '采集审阅 · 文本',
  'admin-collect-image': '采集审阅 · 图像',
  'admin-retrieval': '管理端检索与分析',
  'admin-alerts': '预警管理',
  'admin-cases': '案例管理',
  'admin-agent': '预警研判台',
  'admin-dashboard-dark': '数据概览（深色）',
  'personal-home-dark': '个人首页（深色）',
  'personal-rag-dark': 'RAG 分析结果（深色）',
  'admin-agent-dark': '预警研判台（深色）',
  'bundle-light': '单文件版 · 数据概览（浅色）',
  'bundle-dark': '单文件版 · RAG 分析结果（深色）',
};

/* ---------------------------------------------------------------------------
   5) 拼装
--------------------------------------------------------------------------- */
const meta = {};
for (const [k, v] of Object.entries(pages)) {
  meta[k] = { title: v.title, bodyAttr: v.bodyAttr };
}
/* 正文单独一份：里面全是 HTML 片段（引号、尖括号），和脚本里其它 JSON 放一起
   容易看花眼，拆开也更方便 diff */
const contents = {};
for (const [k, v] of Object.entries(pages)) contents[k] = v.content;
const scriptsByPage = {};
for (const [k, v] of Object.entries(pages)) scriptsByPage[k] = v.scripts || [];

const shell = `<!doctype html>
<html lang="zh-CN" data-mode="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>心理筛查预警系统 · 前端原型（单文件版）</title>
<style>
${fontInline}
${css}
/* 单文件版专用：换页时给舞台一个最小高度，避免切换瞬间滚动条跳动 */
#stage:empty { display: block; min-height: 60vh; }
.bundlebar { position: fixed; inset-inline: 0; bottom: 0; z-index: 90; display: flex; align-items: center; gap: 8px;
  padding: 7px 12px; background: var(--bg-card); border-top: 1px solid var(--line); font-size: var(--fs-meta); color: var(--txt-3);
  flex-wrap: nowrap; }
.bundlebar__pill { flex: none; max-width: 34vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 2px 8px; border: 1px solid var(--line); border-radius: var(--r-chrome); color: var(--txt-2); }
.bundlebar__spacer { margin-inline-start: auto; }
.bundlebar button { flex: none; font: inherit; color: var(--accent); background: none; border: 0; cursor: pointer; padding: 2px 3px; white-space: nowrap; }
/* 手机上这条工具条不该占掉两行：说明文字直接隐藏，按钮改用短标签 */
@media (max-width: 560px) {
  .bundlebar { padding: 6px 10px; gap: 6px; }
  .bundlebar #bb-hint { display: none; }
  .bundlebar button { padding: 2px; }
}
/* 工具条是 fixed 的，给内容留出高度，别压住最后一屏 */
body { padding-bottom: 38px; }
.bb-short { display: none; }
@media (max-width: 560px) {
  .bb-full { display: none; }
  .bb-short { display: inline; }
}
.shotgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--sp-7, 14px); }
.shotgrid figure { margin: 0; border: 1px solid var(--line); border-radius: var(--r-card); overflow: hidden; background: var(--bg-card); }
.shotgrid img { display: block; width: 100%; height: auto; background: var(--bg-inset); }
.shotgrid figcaption { padding: 8px 10px; font-size: var(--fs-label); color: var(--txt-2); border-top: 1px solid var(--line); }
</style>
</head>
<body>
<div id="stage"></div>
<div class="bundlebar">
  <span class="bundlebar__pill" id="bb-page">—</span>
  <span id="bb-hint">单文件原型：所有页面与截图都已内联，断网可用</span>
  <span class="bundlebar__spacer"></span>
  <button type="button" id="bb-home"><span class="bb-full">返回目录</span><span class="bb-short">目录</span></button>
  <button type="button" id="bb-shots"><span class="bb-full">全部截图</span><span class="bb-short">截图</span></button>
  <button type="button" id="bb-mode">切换深色</button>
</div>
<script>
/* ============================ 数据 ============================ */
var BUNDLE_PAGES = ${safeJson(meta)};
var BUNDLE_CONTENT = ${safeJson(contents)};
var BUNDLE_SCRIPTS = ${safeJson(scriptsByPage)};
var BUNDLE_HOME = ${safeJson(HOME)};
var BUNDLE_SHOTS = ${safeJson(shotMap)};
var BUNDLE_CAPTIONS = ${safeJson(SHOT_CAPTIONS)};

/* ============================ 外壳脚本 ============================ */
${shellJs}

${appJs}

/* ============================ 路由 ============================ */
(function () {
  'use strict';
  var stage = document.getElementById('stage');
  var root = document.documentElement;

  function parseHash() {
    var raw = decodeURIComponent(location.hash.replace(/^#/, '')).replace(/^\\/+/, '');
    if (!raw) return { page: BUNDLE_HOME, state: '' };
    var q = raw.indexOf('?');
    var page = q < 0 ? raw : raw.slice(0, q);
    var state = q < 0 ? '' : raw.slice(q + 1);
    /* 允许 #/?shots 这种目录内的子视图 */
    if (!page) page = BUNDLE_HOME;
    return { page: page, state: state };
  }

  function applyBody(page) {
    var m = BUNDLE_PAGES[page];
    var attrs = m ? m.bodyAttr : '';
    document.body.removeAttribute('data-surface');
    var surface = /data-surface="([^"]*)"/.exec(attrs);
    if (surface) document.body.setAttribute('data-surface', surface[1]);
  }

  function renderShots() {
    var keys = Object.keys(BUNDLE_SHOTS);
    var html = '<div class="content"><div class="content__inner">' +
      '<div class="pagehead"><div><h1>全部截图</h1>' +
      '<p class="pagehead__desc">共 ' + keys.length + ' 张，1440 宽，按文件名排序。深色模式的 4 张在最后。</p></div>' +
      '<div class="pagehead__actions"><a class="btn" href="#/' + BUNDLE_HOME + '">返回目录</a></div></div>' +
      '<div class="shotgrid">';
    keys.forEach(function (k) {
      html += '<figure><img src="' + BUNDLE_SHOTS[k] + '" alt="' + (BUNDLE_CAPTIONS[k] || k) + '" loading="lazy">' +
        '<figcaption>' + (BUNDLE_CAPTIONS[k] || k) + ' · <span class="mono">' + k + '.png</span></figcaption></figure>';
    });
    html += '</div></div></div>';
    stage.innerHTML = html;
  }

  var lastPage = null;
  function render() {
    var r = parseHash();
    var page = r.page;
    /* 兼容：允许只写文件名 */
    if (!BUNDLE_PAGES[page]) {
      var hit = Object.keys(BUNDLE_PAGES).filter(function (k) {
        return k === 'pages/' + page || k.endsWith('/' + page);
      })[0];
      if (hit) page = hit;
    }
    if (r.state === 'shots') { applyBody(BUNDLE_HOME); renderShots(); lastPage = '__shots'; return; }
    var m = BUNDLE_PAGES[page];
    if (!m) { page = BUNDLE_HOME; m = BUNDLE_PAGES[page]; }
    applyBody(page);
    /* 换页前先收起移动端抽屉：否则导航后抽屉仍盖住新页面，看起来像「点了没反应」 */
    if (window.PROTO_SET_DRAWER) window.PROTO_SET_DRAWER(false);
    stage.innerHTML = BUNDLE_CONTENT[page] || '';
    try { window.PROTO.render(); } catch (e) { console.error('外壳渲染失败', e); }
    (BUNDLE_SCRIPTS[page] || []).forEach(function (code) {
      try { new Function(code)(); } catch (e) { console.error('页面脚本执行失败', e); }
    });
    /* 换页后 .app 是新元素，必须重新绑定抽屉/折叠/分段控件，
       否则单文件版翻到第二页起交互全失效（手机端表现为抽屉打不开） */
    if (window.PROTO_REBIND) window.PROTO_REBIND();
    lastPage = page;
    window.scrollTo(0, 0);
    document.getElementById('bb-page').textContent = m.title.replace(/ · .*$/, '');
    document.title = m.title;
  }

  /* 模式：单文件版统一由这里决定，换页不再被上一次的偏好覆盖 */
  function applyMode(mode) {
    root.setAttribute('data-mode', mode);
    try { localStorage.setItem('proto-mode', mode); } catch (e) {}
    var btn = document.getElementById('bb-mode');
    if (btn) btn.textContent = mode === 'dark' ? '切换浅色' : '切换深色';
    document.querySelectorAll('[data-mode-toggle]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(mode === 'dark'));
    });
    /* 重渲染图表类内容不需要，颜色全走 CSS 变量 */
  }
  var forced = /(^|[,#?])(light|dark)([,#?]|$)/.exec(location.hash);
  var stored = null;
  try { stored = localStorage.getItem('proto-mode'); } catch (e) {}
  applyMode((forced && forced[2]) || stored || 'light');

  document.getElementById('bb-mode').addEventListener('click', function () {
    applyMode(root.getAttribute('data-mode') === 'dark' ? 'light' : 'dark');
  });
  document.getElementById('bb-home').addEventListener('click', function () { location.hash = '#/' + BUNDLE_HOME; });
  document.getElementById('bb-shots').addEventListener('click', function () { location.hash = '#/' + BUNDLE_HOME + '?shots'; });

  /* 页面内的深浅切换按钮 → 交给单文件版统一处理 */
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest && ev.target.closest('[data-mode-toggle]');
    if (!t) return;
    ev.preventDefault();
    applyMode(root.getAttribute('data-mode') === 'dark' ? 'light' : 'dark');
  }, true);

  window.addEventListener('hashchange', render);
  render();
})();
</script>
</body>
</html>
`;

writeFileSync(OUT, shell, 'utf8');
const kb = (readFileSync(OUT).length / 1048576).toFixed(2);
console.log(`已生成 ${path.relative(process.cwd(), OUT)}`);
console.log(`  页面 ${Object.keys(pages).length - 1} 个 + 目录页`);
console.log(`  截图 ${Object.keys(shotMap).length} 张（WebP 内联）`);
console.log(`  体积 ${kb} MB`);
