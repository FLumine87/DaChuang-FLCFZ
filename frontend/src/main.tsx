import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import ViewModeSwitcher from './components/ViewModeSwitcher'
import { applyDemoRoute } from './demoPreset'

/* 必须在 React 挂载**之前**抓：此时 #root 还是空的，
   抓到的就是"干净的应用源码"，可以直接喂给 iframe 重新跑一遍。 */
const ORIGINAL_HTML = '<!doctype html>' + document.documentElement.outerHTML

/* 演示包预设：单文件打包时会注入 window.__DEMO_PRESET__ 决定从哪一页起步
   （桌面演示从落地页、手机演示直接进登录页）。没有注入时这是空操作。 */
applyDemoRoute()

// 使用 HashRouter：路由在 URL hash 中（/#/auth），GitHub Pages 下刷新/直达
// 深层路由不再返回 404（避免 SPA 路由 404 状态码问题）。
const root = createRoot(document.getElementById('root')!)

/* 应用本体 */
const app = (
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
)

/* 手机端 / 桌面端 视图切换（按钮固定在右上角）。
   桌面模式下 children 就是原样渲染的应用，不受影响；
   切到手机模式时才把应用放进 390px 的 iframe 里重新跑一遍
   —— iframe 内部的媒体查询按 390px 求值，所以是真·手机版式，不用复制任何 CSS。
   VITE_VIEW_SWITCHER=false 可整个关掉。 */
/* 按钮显不显示由组件内部按真实设备判断（手机/平板上自动隐藏），
   构建时不再做任何假设。这里只留一个整体开关供需要时关掉。 */
const switcherOn = String(import.meta.env.VITE_VIEW_SWITCHER ?? 'true').toLowerCase() !== 'false'

root.render(
  switcherOn
    ? <ViewModeSwitcher appHtml={ORIGINAL_HTML}>{app}</ViewModeSwitcher>
    : app,
)
