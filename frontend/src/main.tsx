import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import DemoViewToggle from './components/DemoViewToggle'
import { applyDemoRoute, readDemoPreset } from './demoPreset'

/* 必须在 React 挂载**之前**抓：此时 #root 还是空的，
   抓到的就是"干净的应用源码"，可以直接喂给 iframe 重新跑一遍。 */
const ORIGINAL_HTML = '<!doctype html>' + document.documentElement.outerHTML

/* 演示包预设：单文件打包时会注入 window.__DEMO_PRESET__ 决定从哪一页起步
   （桌面演示从落地页、手机演示直接进登录页）。没有注入时这是空操作。 */
applyDemoRoute()

// 使用 HashRouter：路由在 URL hash 中（/#/auth），GitHub Pages 下刷新/直达
// 深层路由不再返回 404（避免 SPA 路由 404 状态码问题）。
const root = createRoot(document.getElementById('root')!)

/* 演示包可以要求渲染「手机端 / 桌面端」切换外壳。
   两个条件缺一不可：
     · preset.viewToggle —— 只有需要它的演示包才开；
     · window.self === window.top —— iframe 内部不再套娃。
   开发服务器与正式构建都不会带这个开关，行为与原来完全一致。 */
const preset = readDemoPreset()
if (preset.viewToggle && window.self === window.top) {
  root.render(
    <StrictMode>
      <DemoViewToggle appHtml={ORIGINAL_HTML} />
    </StrictMode>,
  )
} else {
  root.render(
    <StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>,
  )
}
