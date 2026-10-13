import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* 独立的预览应用：只服务 design/home-react/，不碰 frontend/ 里的任何东西。
   样式与脚本用 public/ 里的副本（从 prototype/assets/ 同步），
   这样才能逐像素复现 design/home-redesign/ 下的样张。 */
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5181, strictPort: true },
});
