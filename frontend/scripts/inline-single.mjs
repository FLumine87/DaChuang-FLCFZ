/**
 * 把 dist-single/ 的产物**真正合成一个 HTML 文件**。
 *
 * 为什么需要这一步：vite 的 `assetsInlineLimit` 只内联"被引用的静态资源"
 * （图片、字体），**不会内联入口 chunk 的 JS 和 CSS** —— 它们永远作为
 * 独立文件输出。所以只靠 vite 配置拿不到单文件，必须构建后自己搬进去。
 *
 * 做三件事：
 *   1. <script type="module" src="./assets/xxx.js"> → <script type="module">…源码…</script>
 *   2. <link rel="stylesheet" href="./assets/xxx.css"> → <style>…</style>
 *   3. 删掉 assets/ 目录，只留 index.html
 *
 * 转义注意：JS 源码里若出现 `</script`，直接内联会提前闭合标签，必须替换成
 * `<\/script`（在 JS 字符串/正则里等价，但 HTML 解析器不再认为是结束标签）。
 */
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist-single');
const htmlPath = join(dist, 'index.html');

if (!existsSync(htmlPath)) {
  console.error('[inline-single] 找不到 dist-single/index.html，先跑 vite build');
  process.exit(1);
}

let html = readFileSync(htmlPath, 'utf8');
const inlined = [];

/* 1. 内联 JS：<script ... src="./assets/x.js"></script> */
html = html.replace(
  /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g,
  (whole, src) => {
    const file = join(dist, src.replace(/^\.?\//, ''));
    if (!existsSync(file)) return whole;
    const code = readFileSync(file, 'utf8').replace(/<\/script/gi, '<\\/script');
    inlined.push(src);
    return `<script type="module">\n${code}\n</script>`;
  },
);

/* 2. 内联 CSS：<link rel="stylesheet" href="./assets/x.css"> */
html = html.replace(
  /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g,
  (whole, href) => {
    const file = join(dist, href.replace(/^\.?\//, ''));
    if (!existsSync(file)) return whole;
    const css = readFileSync(file, 'utf8');
    inlined.push(href);
    return `<style>\n${css}\n</style>`;
  },
);

/* 3. favicon 也内联成 data URI，免得 file:// 下 404 一个空图标请求 */
const favicon = join(dist, 'favicon.svg');
if (existsSync(favicon)) {
  const svg = readFileSync(favicon, 'utf8');
  const uri = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  html = html.replace(/(<link\b[^>]*\brel="icon"[^>]*\bhref=")[^"]*(")/, `$1${uri}$2`);
}

writeFileSync(htmlPath, html, 'utf8');

/* 4. 清掉 assets/：已经没用了 */
const assetsDir = join(dist, 'assets');
if (existsSync(assetsDir)) rmSync(assetsDir, { recursive: true, force: true });

const left = readdirSync(dist).filter((n) => n !== 'index.html' && n !== 'login.html');
const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
console.log(`[inline-single] 已内联 ${inlined.length} 个资源 → index.html 单文件 ${kb} KB`);
if (left.length) console.log(`[inline-single] dist-single/ 下仍有其他条目：${left.join(', ')}`);
