import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App'

// 使用 HashRouter：路由在 URL hash 中（/#/auth），GitHub Pages 下刷新/直达
// 深层路由不再返回 404（避免 SPA 路由 404 状态码问题）。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
