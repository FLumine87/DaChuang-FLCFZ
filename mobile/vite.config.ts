import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
// 2026-10-07：数据层已内置到 mobile/src/shared（原样副本），
// 不再引用 ../frontend/src —— 分支因此自包含，可独立克隆构建。
const sharedDir = fileURLToPath(new URL('./src/shared', import.meta.url))
const nm = (p: string) => fileURLToPath(new URL(`./node_modules/${p}`, import.meta.url))

/**
 * 移动端 Vite 配置。
 *
 * 关键点一：**工程自包含**。
 * 数据层（services / auth / data / hooks / utils）与通用组件以**原样副本**
 * 放在 `mobile/src/shared/`，`@shared` 别名指向它 —— 不再引用 `../frontend/src`。
 * 因此单独克隆本分支即可构建，且相对 main 的改动只剩 `mobile/**`。
 * 上游同步方式见 `mobile/scripts-sync-shared.mjs`。
 *
 * 关键点二（2026-10-07 白屏根因）：**React 必须单实例**。
 * 历史上 `@shared` 指向 `../frontend/src` 时，那里的文件按自身位置解析 `react`，
 * 会拿到 `frontend/node_modules/react`(19.2.4)，与 mobile 侧 19.3.0 形成两个实例
 * → 共享 hook 跨实例调用抛 "Invalid hook call" → 采集页/检索页白屏。
 * 副本内置后此问题已从结构上消失；下面的 alias + dedupe 作为**双保险**保留。
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
