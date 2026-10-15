import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, type ReactElement } from 'react';
import Layout from './components/Layout';
import ScrollToTop from './components/ScrollToTop';
import ScrollHint from './components/ScrollHint';
import Dashboard from './pages/Dashboard';
import DashboardV2 from './pages/DashboardV2';
import Screening from './pages/Screening';
import DataCollection from './pages/DataCollection';
import Retrieval from './pages/Retrieval';
import Alerts from './pages/Alerts';
import Cases from './pages/Cases';
import SystemSelector from './pages/SystemSelector';
import AdminLayout from './admin/components/AdminLayout';
import AdminDashboard from './admin/pages/AdminDashboard';
import AdminScreening from './admin/pages/AdminScreening';
import AdminDataCollection from './admin/pages/AdminDataCollection';
import AdminRetrieval from './admin/pages/AdminRetrieval';
import AdminAlerts from './admin/pages/AdminAlerts';
import AdminCases from './admin/pages/AdminCases';
/* 管理端「预警处置工作台」：团队 main 用 AgentWorkspaceV2 取代了旧的
   AdminAgentWorkbench（旧文件已随本合并删除），这里指向 V2，路由地址不变。 */
import AdminAgentWorkspace from './admin/pages/AgentWorkspaceV2';
import AdminJudgement from './admin/pages/AdminJudgement';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import WelcomePage from './pages/WelcomePage';
import FirstRunQuestionnaire from './pages/first/FirstRunQuestionnaire';
import FirstRunSupplement from './pages/first/FirstRunSupplement';
import FirstRunResult from './pages/first/FirstRunResult';
/* 「智能心理助手」三件套按需加载。
   它们各自 280–410 行，且挂载时要读 localStorage、组装本机图谱 ——
   之前是直接 import，全站打成一个 1.22 MB 的 bundle，点进去同步挂载就卡一下。
   拆出去之后：首屏包变小，这三个页面各自一小块，切换时先出占位再填内容。 */
const ChatPage = lazy(() => import('./pages/me/ChatPage'));
const KgPage = lazy(() => import('./pages/me/KgPage'));
const FeedPage = lazy(() => import('./pages/me/FeedPage'));
import { getCurrentSession } from './auth/session';

function RequireRole({ role, children }: { role: 'admin' | 'user'; children: ReactElement }) {
  const session = getCurrentSession();
  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  if (session.role !== role) {
    return <Navigate to={session.role === 'admin' ? '/admin/dashboard' : '/personal/dashboard'} replace />;
  }

  return children;
}

/** 按需加载的占位：给一块与页面同色的骨架，避免切换时闪白 */
function RouteFallback() {
  return (
    <div className="grid min-h-[60vh] place-items-center bg-page">
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-transparent" />
        正在打开…
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
    {/* 路由切换即滚回顶部：单页应用不会自动复位滚动位置，
        否则从翻到中间的页面点进登录/首次引导/量表页，会停在上一页的高度上。
        放在 Suspense 内、Routes 之前，保证每次路径变化都执行。 */}
    <ScrollToTop />
    {/* 「下面还有内容」的底部提醒，仅手机端显示；滚到底自动消失 */}
    <ScrollHint />
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      {/* 旧地址兼容：原 /auth 是「介绍 + 登录」合页，现统一到登录页 */}
      <Route path="/auth" element={<Navigate to="/login" replace />} />
      <Route path="/selector" element={<SystemSelector />} />

      {/* 个人端首次登录的欢迎页：独立成页（不带侧栏，与登录页同一套顶栏）。
          只在账号第一次登录时由登录页跳进来；主页空状态的入口也会走到这里，
          所以它本身不做"是不是首次"的判断，随时可以当"选量表"页用。 */}
      <Route
        path="/personal/welcome"
        element={
          <RequireRole role="user">
            <WelcomePage />
          </RequireRole>
        }
      />

      {/* 首次引导的三步向导：01 逐题作答 → 02 补充记录（可选）→ 03 本次结果。
          同样是独立成页（与欢迎页共用外壳），不走工作台的侧栏布局。 */}
      <Route
        path="/personal/first/questionnaire"
        element={
          <RequireRole role="user">
            <FirstRunQuestionnaire />
          </RequireRole>
        }
      />
      <Route
        path="/personal/first/supplement"
        element={
          <RequireRole role="user">
            <FirstRunSupplement />
          </RequireRole>
        }
      />
      <Route
        path="/personal/first/result"
        element={
          <RequireRole role="user">
            <FirstRunResult />
          </RequireRole>
        }
      />

      <Route path="/personal" element={<RequireRole role="user"><Layout /></RequireRole>}>
        <Route index element={<Navigate to="/personal/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="dashboard-v2" element={<DashboardV2 />} />
        <Route path="screening" element={<Screening />} />
        <Route path="data-collection" element={<DataCollection />} />
        <Route path="retrieval" element={<Retrieval />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="cases" element={<Cases />} />
        {/* 智能心理助手（个人端 Agent + 知识图谱） */}
        <Route path="me/chat" element={<ChatPage />} />
        <Route path="me/kg" element={<KgPage />} />
        <Route path="me/feed" element={<FeedPage />} />
        <Route path="*" element={<Navigate to="/personal/dashboard" replace />} />
      </Route>

      <Route path="/admin" element={<RequireRole role="admin"><AdminLayout /></RequireRole>}>
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboard />} />
        <Route path="me/chat" element={<ChatPage />} />
        <Route path="me/kg" element={<KgPage />} />
        <Route path="me/feed" element={<FeedPage />} />
        <Route path="screening" element={<AdminScreening />} />
        <Route path="data-collection" element={<AdminDataCollection />} />
        <Route path="retrieval" element={<AdminRetrieval />} />
        <Route path="alerts" element={<AdminAlerts />} />
        <Route path="cases" element={<AdminCases />} />
        <Route path="judgement" element={<AdminJudgement />} />
        <Route path="agent-workbench" element={<AdminAgentWorkspace />} />
        <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
