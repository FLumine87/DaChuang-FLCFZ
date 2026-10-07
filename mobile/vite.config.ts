import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const sharedDir = fileURLToPath(new URL('../frontend/src', import.meta.url))
const nm = (p: string) => fileURLToPath(new URL(`./node_modules/${p}`, import.meta.url))

/**
 * 移动端 Vite 配置。
 *
 * 关键点一：**不复制一份前端代码**——通过 `@shared` 别名复用
 * `../frontend/src` 的数据层（services / auth / data）与通用组件，
 * 移动端只自带一套为触屏重做的 UI。
 *
 * 关键点二（2026-10-07 修白屏）：**React 必须单实例**。
 * `../frontend/src` 位于 mobile 工程之外，其中的文件若按自身位置解析 `react`，
 * 会拿到 `frontend/node_modules/react`（19.2.4），而移动端页面用的是
 * `mobile/node_modules/react`（19.3.0）→ 两份 React 同时进包 →
 * 共享 hook（`@shared/hooks/useAudioRecorder`）抛 "Invalid hook call" →
 * React 卸载整棵树 → **采集页 / 检索页白屏**（其余页面只用了纯数据，所以正常）。
 * 解决：alias + dedupe 双保险，全部指向 mobile 自己那一份。
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_DEV_PROXY_TARGET || 'http://localhost:8000'
  const reactDir = nm('react')
  const reactDomDir = nm('react-dom')

  return {
    base: '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: [
        { find: /^@shared\/(.*)$/, replacement: `${sharedDir}/$1` },
        // 精确匹配，避免误伤 react-router / react-dom 等子路径
        { find: /^react$/, replacement: reactDir },
        { find: /^react\/jsx-runtime$/, replacement: `${reactDir}/jsx-runtime.js` },
        { find: /^react\/jsx-dev-runtime$/, replacement: `${reactDir}/jsx-dev-runtime.js` },
        { find: /^react-dom$/, replacement: reactDomDir },
        { find: /^react-dom\/client$/, replacement: `${reactDomDir}/client.js` },
      ],
      dedupe: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'scheduler'],
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
