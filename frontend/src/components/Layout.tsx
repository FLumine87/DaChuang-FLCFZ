import AppShell from './AppShell';

/* 个人端外壳：侧栏、顶栏、导航分组、深浅色都在 AppShell 里数据驱动地实现，
   这里只声明"这是个人端"。合并团队 main 时，他们自建的 emerald 侧栏整段丢弃——
   个人端新增的「AI 陪伴对话 / 我的知识图谱 / 个性化推送」三个页面
   改由 AppShell 的导航表登记（见 AppShell.tsx 的 items）。

   今日问询弹窗**挂在外壳上会被每个页面都弹一遍**（用户在首页、量表页也被打断）。
   2026-11-07 改为挂在「AI 陪伴对话」页内（见 pages/me/ChatPage.tsx）：
   只在用户打开对话页时自动弹出，时机与"想聊两句"的意图对齐。 */
export default function Layout() {
  return <AppShell mode="personal" />;
}
