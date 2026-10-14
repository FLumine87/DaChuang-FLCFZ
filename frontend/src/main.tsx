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

/* 首次加载的进场动画（.page-enter）只在这一次播。
   挂载 400ms 后打上标记，之后客户端路由切换重新挂载的页面就不再命中那条规则
   —— 否则每次切页整页（含顶栏）都会从 opacity:0 再淡入一遍，
   连点按钮时看着像抽搐（详见 index.css 里 .page-enter 那段说明）。 */
window.setTimeout(() => document.documentElement.classList.add('app-booted'), 400)

/* 关于「手机端 / 桌面端」视图切换：
   这个功能已按用户要求移除。它把按钮常驻在顶栏右上角，而那里正是
   「登录 / 主题切换」的位置 —— 为了给它让位，顶栏得补一段右内边距，
   结果那排控件的间距和位置都变了。
   用户："说了这个删掉，旁边两个按钮回到原来的位置。"
   移除后顶栏与整个应用都回到加这个功能之前的状态。
   需要恢复的话，代码在 git 历史里（9687fb4 引入，f688370 是最后一版）。 */
