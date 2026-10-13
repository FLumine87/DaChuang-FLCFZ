import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_DEV_PROXY_TARGET || 'http://localhost:8000'
  /* 个人端 KG/Agent 服务（personal-backend）跑在另一个端口上：
     它和主 backend 都占 /api，但主 backend 没有 /api/v1/*，
     所以把 /api/v1 单独指过去——两个服务因此能在本机同时跑，互不抢占 8000。
     默认取 personal-backend 自己的默认端口 8001；可用 VITE_PERSONAL_PROXY_TARGET 覆盖。 */
  const personalTarget =
    env.VITE_PERSONAL_PROXY_TARGET || proxyTarget.replace(/:\d+$/, ':8001')
  // GitHub Pages 子路径部署时由构建环境注入 base（如 /repo-name/，见 GitHub Actions 配置）；
  // 默认 '/'（本地开发 / 根域名部署）。需与 React Router basename（main.tsx）保持一致。
  const base = env.VITE_BASE_PATH || '/'

  return {
    base,
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        /* 更具体的键在前：/api/v1/* → personal-backend */
        '/api/v1': {
          target: personalTarget,
          changeOrigin: true,
          secure: false,
        },
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  }
})
