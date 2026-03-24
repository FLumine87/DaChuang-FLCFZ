import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Screening from './pages/Screening';
import DataCollection from './pages/DataCollection';
import Retrieval from './pages/Retrieval';
import Alerts from './pages/Alerts';
import Cases from './pages/Cases';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="screening" element={<Screening />} />
        <Route path="data-collection" element={<DataCollection />} />
        <Route path="retrieval" element={<Retrieval />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="cases" element={<Cases />} />
      </Route>
    </Routes>
  );
}
