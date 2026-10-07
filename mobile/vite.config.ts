import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))

/**
 * 移动端 Vite 配置。
 *
 * 关键点：**不复制一份前端代码**——通过 `@shared` 别名直接复用
 * `../frontend/src` 里的数据层（services / auth / data）与通用组件，
 * 移动端只自带一套为触屏重做的 UI。
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_DEV_PROXY_TARGET || 'http://localhost:8000'

  return {
    base: '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@shared': fileURLToPath(new URL('../frontend/src', import.meta.url)),
      },
    },
    server: {
      port: 5273,
      host: true,
      // 允许访问项目根之外的 ../frontend/src
      fs: { allow: [here, fileURLToPath(new URL('..', import.meta.url))] },
      proxy: {
        '/api': { target: proxyTarget, changeOrigin: true, secure: false },
      },
    },
  }
})
