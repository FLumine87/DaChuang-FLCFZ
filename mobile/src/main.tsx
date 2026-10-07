import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { installErrorTrap } from './platform/errorTrap'

// 白屏救援：任何未捕获错误都显示成可读浮层（真机调试用）
installErrorTrap()

// HashRouter：与 Web 端保持一致，Capacitor WebView 下刷新/直达不会 404
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
)
