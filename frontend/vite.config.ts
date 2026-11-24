import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_DEV_PROXY_TARGET || 'http://localhost:8000'
  /* /api/v1/* 的归属：
       原设计里这一组属于独立的 personal-backend（KG/Agent 服务，默认 8001），
       但本仓库已在主 backend 实现了个人端需要的那部分（/api/v1/steward/graph），
       而 compose 里并没有第三个服务 —— 若仍指向 8001，浏览器会连不上，
       页面表现为"档案关系暂时无法读取"、图谱只剩星空（实测就是这个问题）。
     因此**默认指向主 backend**；真的另起了 personal-backend 时，
     用 VITE_PERSONAL_PROXY_TARGET 覆盖即可。 */
  const personalTarget = env.VITE_PERSONAL_PROXY_TARGET || proxyTarget
  // GitHub Pages 子路径部署时由构建环境注入 base（如 /repo-name/，见 GitHub Actions 配置）；
  // 默认 '/'（本地开发 / 根域名部署）。需与 React Router basename（main.tsx）保持一致。
  const base = env.VITE_BASE_PATH || '/'

  return {
    base,
    plugins: [react(), tailwindcss(), {
      name: 'local-checkout-identity',
      configureServer(server) {
        // Only the local launcher supplies these; never expose checkout paths in builds.
        if (!process.env.LOCAL_DEV_TOKEN || !process.env.LOCAL_DEV_ROOT) return
        server.middlewares.use('/__dev_instance', (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ root: process.env.LOCAL_DEV_ROOT,
            service: 'frontend', token: process.env.LOCAL_DEV_TOKEN }))
        })
      },
    }],
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
        /* 上传的语音/图片由后端 /uploads 静态路由提供，开发环境同样需要代理 */
        '/uploads': {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  }
})
