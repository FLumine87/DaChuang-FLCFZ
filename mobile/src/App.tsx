import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import type { ReactElement } from 'react';
import { getCurrentSession } from '@shared/auth/session';
import MobileLayout from './components/MobileLayout';
import ModeSelectPage from './pages/ModeSelectPage';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import ScreeningPage from './pages/ScreeningPage';
import DataCollectionPage from './pages/DataCollectionPage';
import RetrievalPage from './pages/RetrievalPage';
import AlertsPage from './pages/AlertsPage';
import CasesPage from './pages/CasesPage';
import MePage from './pages/MePage';
import SettingsPage from './pages/SettingsPage';
import { isModeChosen } from './platform/mode';

/** 首启模式选择：没选过模式就不放行到登录页 */
function RequireMode({ children }: { children: ReactElement }) {
  if (!isModeChosen()) return <Navigate to="/mode" replace />;
  return children;
}

function RequireSession({ children }: { children: ReactElement }) {
  const session = getCurrentSession();
  if (!session) return <Navigate to="/auth" replace />;
  return children;
}

/** 登录后 / 冷启动后的落点 */
function Entry() {
  const navigate = useNavigate();
  if (!isModeChosen()) return <Navigate to="/mode" replace />;
  const session = getCurrentSession();
  if (!session) return <Navigate to="/auth" replace />;
  if (session.role === 'admin') {
    // 移动端只做学生端；管理端账号引导回 Web
    return <Navigate to="/app/me" replace />;
  }
  void navigate;
  return <Navigate to="/app/dashboard" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Entry />} />
      <Route path="/mode" element={<ModeSelectPage />} />
      <Route
        path="/auth"
        element={
          <RequireMode>
            <AuthPage />
          </RequireMode>
        }
      />

      <Route
        path="/app"
        element={
          <RequireMode>
            <RequireSession>
              <MobileLayout />
            </RequireSession>
          </RequireMode>
        }
      >
        <Route index element={<Navigate to="/app/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="screening" element={<ScreeningPage />} />
        <Route path="collection" element={<DataCollectionPage />} />
        <Route path="retrieval" element={<RetrievalPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="cases" element={<CasesPage />} />
        <Route path="me" element={<MePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
