import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { applyDemoRoute } from './demoPreset'

/* 演示包预设：单文件打包时会注入 window.__DEMO_PRESET__ 决定从哪一页起步
   （桌面演示从落地页、手机演示直接进登录页）。没有注入时这是空操作。 */
applyDemoRoute()

// 使用 HashRouter：路由在 URL hash 中（/#/auth），GitHub Pages 下刷新/直达
// 深层路由不再返回 404（避免 SPA 路由 404 状态码问题）。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
