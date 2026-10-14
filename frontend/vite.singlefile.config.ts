/* 一次性配置：把整个应用打成**单个 HTML 文件**（便于直接双击打开 / 发给别人）。
   与正式构建的区别：
     · mode 强制为 demo —— 见下方长注释，这是**关键**。
     · inlineDynamicImports —— 关掉代码分割，按需加载的三个页面也并进主包，
       否则 file:// 下动态 import 会被浏览器拦。
     · assetsInlineLimit 拉满 —— CSS/图片/SVG 全部内联，不产生额外文件。
     · 输出到 dist-single/，不影响 dist/ 的正式产物。
   注意：基础配置是 defineConfig(callback) 形式，必须先调用它拿到对象再 merge，
   直接 mergeConfig(base, …) 会报 "Cannot merge config in form of callback"。 */
import { defineConfig, mergeConfig, type UserConfig } from 'vite';
import base from './vite.config';

export default defineConfig(async (env) => {
  /* 强制走 demo 模式（对应 .env.demo 的 VITE_USE_MOCK=true）。
     ⚠ 注意：真正决定 import.meta.env 的是**命令行的 --mode**，
     不是这里传进去的 env（那个只影响本配置内 loadEnv 读哪些文件）。
     所以 package.json 的 build:single 里必须带 --mode demo，
     否则构建仍按 production 走，读到 .env.production 的
     VITE_USE_MOCK=false + Worker 域名，手机上登录必然超时。
     为什么必须：这个包是给"双击打开 / 发到手机上用 file:// 打开"的，
     根本没有任何后端可连。而原先没指定 mode，构建默认走 production，
     于是读到 .env.production 的 VITE_USE_MOCK=false + 一个 Cloudflare Worker
     域名 —— 手机上连不上那个域名，登录就卡在 axios 的 15s 超时上，
     报 "timeout of 15000ms exceeded"（2026-10-14 真机反馈）。
     demo 模式下所有数据来自内置 mock，页面全都能点开、有内容，
     这才符合"单文件演示包"的用途。 */
  const demoEnv = { ...env, mode: 'demo' };
  const resolved = (typeof base === 'function' ? await base(demoEnv) : base) as UserConfig;
  return mergeConfig(
    resolved,
    defineConfig({
      /* base 必须是相对路径 './'。
         默认的 '/' 会让产物引用 /assets/xxx.js —— 在 file:// 下解析到文件系统根目录，
         直接 ERR_FILE_NOT_FOUND，整页白屏（2026-10-14 实测）。
         路由用的是 HashRouter 且没设 basename，所以改 base 不影响跳转。 */
      base: './',
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
