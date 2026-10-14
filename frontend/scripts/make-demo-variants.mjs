/**
 * 把 dist-single/index.html（真·单文件产物）复制成两份演示包：
 *
 *   demo.html —— 落地页起步，右上角常驻「桌面 / 手机」切换（应用自带功能）。
 *
 * 两份内容完全同源，只在 </body> 前多注入一段
 *   <script>window.__DEMO_PRESET__ = {...}</script>
 * 应用启动时读它（见 src/demoPreset.ts）。classic script 会在 module script
 * 之前执行，所以注入位置只要在文档里就行。
 *
 * 不注入时（开发服务器、正式构建）应用行为与原来完全一致。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'dist-single', 'index.html');

if (!existsSync(src)) {
  console.error('[demo-variants] 找不到 dist-single/index.html，先跑 build:single');
  process.exit(1);
}

const html = readFileSync(src, 'utf8');

/** 把预设脚本插到 </body> 前；找不到 </body> 就退化为追加到末尾 */
function inject(source, preset) {
  const tag = `  <script>window.__DEMO_PRESET__ = ${JSON.stringify(preset)};</script>\n`;
  const at = source.lastIndexOf('</body>');
  return at === -1 ? source + tag : source.slice(0, at) + tag + source.slice(at);
}

const variants = [
  {
    /* 一个包就够了：右上角的视图切换常驻，桌面端为默认。
       不再分"桌面包/手机包"—— 那是按"文件会在什么设备上打开"做的假设，
       而构建时根本无从得知（用户已指出过这一点）。 */
    file: 'demo.html',
    label: '演示包',
    preset: { route: '#/' },
  },
];

for (const v of variants) {
  const out = join(root, 'dist-single', v.file);
  writeFileSync(out, inject(html, v.preset), 'utf8');
  const kb = (Buffer.byteLength(readFileSync(out), 'utf8') / 1024).toFixed(0);
  console.log(`[demo-variants] ${v.label.padEnd(6)} → dist-single/${v.file}  ${kb} KB  预设=${JSON.stringify(v.preset)}`);
}
