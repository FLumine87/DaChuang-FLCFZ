/* 一次性配置：把整个应用打成**单个 HTML 文件**（便于直接双击打开 / 发给别人）。
   与正式构建的区别：
     · inlineDynamicImports —— 关掉代码分割，按需加载的三个页面也并进主包，
       否则 file:// 下动态 import 会被浏览器拦。
     · assetsInlineLimit 拉满 —— CSS/图片/SVG 全部内联，不产生额外文件。
     · 输出到 dist-single/，不影响 dist/ 的正式产物。
   注意：基础配置是 defineConfig(callback) 形式，必须先调用它拿到对象再 merge，
   直接 mergeConfig(base, …) 会报 "Cannot merge config in form of callback"。 */
import { defineConfig, mergeConfig, type UserConfig } from 'vite';
import base from './vite.config';

export default defineConfig(async (env) => {
  const resolved = (typeof base === 'function' ? await base(env) : base) as UserConfig;
  return mergeConfig(
    resolved,
    defineConfig({
      build: {
        outDir: 'dist-single',
        emptyOutDir: true,
        cssCodeSplit: false,
        assetsInlineLimit: 100 * 1024 * 1024,
        rollupOptions: { output: { inlineDynamicImports: true } },
      },
    }),
  );
});
