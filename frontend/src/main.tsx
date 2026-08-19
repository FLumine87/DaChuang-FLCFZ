import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'

// React Router basename 与 vite base 保持一致：
// - 本地开发（base='/'）→ basename='/'；
// - GitHub Pages 子路径（如 /repo-name/）→ basename='/repo-name'，刷新/直达子路由不 404。
const basename = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
