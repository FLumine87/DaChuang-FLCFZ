/**
 * 把 dist-single/index.html（真·单文件产物）复制成两份演示包：
 *
 *   demo-desktop.html —— 桌面端演示：从落地页进入，**并带「手机端 / 桌面端」切换按钮**
 *                      （一台电脑上就能同时演示两种版式）。
 *   demo-mobile.html  —— 手机端演示：直接进登录页，并**预填演示账号**
 *                        （手机上打两遍账号密码很烦，现场常是"把手机递给别人看"）。
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
    file: 'demo-desktop.html',
    label: '桌面端演示',
    preset: { route: '#/', viewToggle: true },
  },
  {
    file: 'demo-mobile.html',
    label: '手机端演示',
    preset: { route: '#/login', prefill: { username: 'xiaoyu', password: '123456' } },
  },
];

for (const v of variants) {
  const out = join(root, 'dist-single', v.file);
  writeFileSync(out, inject(html, v.preset), 'utf8');
  const kb = (Buffer.byteLength(readFileSync(out), 'utf8') / 1024).toFixed(0);
  console.log(`[demo-variants] ${v.label.padEnd(6)} → dist-single/${v.file}  ${kb} KB  预设=${JSON.stringify(v.preset)}`);
}
