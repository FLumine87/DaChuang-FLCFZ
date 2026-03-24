import { Routes, Route, Navigate } from 'react-router-dom';
import type { ReactElement } from 'react';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
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
import AuthPage from './pages/AuthPage';
import { getCurrentSession } from './auth/mockAuth';

function RedirectBySession() {
  const session = getCurrentSession();
  if (!session) return <Navigate to="/auth" replace />;
  return <Navigate to={session.role === 'admin' ? '/admin/dashboard' : '/personal/dashboard'} replace />;
}

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

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RedirectBySession />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/selector" element={<SystemSelector />} />

      <Route path="/personal" element={<RequireRole role="user"><Layout /></RequireRole>}>
        <Route index element={<Navigate to="/personal/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="screening" element={<Screening />} />
        <Route path="data-collection" element={<DataCollection />} />
        <Route path="retrieval" element={<Retrieval />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="cases" element={<Cases />} />
        <Route path="*" element={<Navigate to="/personal/dashboard" replace />} />
      </Route>

      <Route path="/admin" element={<RequireRole role="admin"><AdminLayout /></RequireRole>}>
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboard />} />
        <Route path="screening" element={<AdminScreening />} />
        <Route path="data-collection" element={<AdminDataCollection />} />
        <Route path="retrieval" element={<AdminRetrieval />} />
        <Route path="alerts" element={<AdminAlerts />} />
        <Route path="cases" element={<AdminCases />} />
        <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/auth" replace />} />
    </Routes>
  );
}
