import { useState } from 'react';
import { Search, Filter, Eye, ChevronDown } from 'lucide-react';
import { screeningRecords } from '../data/adminMockData';
import AdminAlertBadge from '../components/AdminAlertBadge';
import AdminStatusBadge from '../components/AdminStatusBadge';
import AdminScreeningDetail from './AdminScreeningDetail';

export default function AdminScreening() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = screeningRecords.filter((r) => {
    const matchesSearch = r.name.includes(searchTerm) || r.id.includes(searchTerm);
    const matchesLevel = filterLevel === 'all' || r.alertLevel === filterLevel;
    return matchesSearch && matchesLevel;
  });

  if (selectedId) {
    const record = screeningRecords.find((r) => r.id === selectedId);
    if (record) {
      return <AdminScreeningDetail record={record} onBack={() => setSelectedId(null)} />;
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="搜索姓名或编号..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent w-64"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
            className="pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-sm bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
          >
            <option value="all">全部等级</option>
            <option value="red">危险</option>
            <option value="orange">警告</option>
            <option value="yellow">关注</option>
            <option value="green">正常</option>
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">编号</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">姓名</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">问卷</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">得分</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">预警等级</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">状态</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">日期</th>
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((record) => (
              <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-5 py-3.5 text-sm font-mono text-slate-500">{record.id}</td>
                <td className="px-5 py-3.5 text-sm text-slate-700">{record.name}</td>
                <td className="px-5 py-3.5 text-sm text-slate-600">{record.questionnaire}</td>
                <td className="px-5 py-3.5 text-sm text-slate-700">{record.score}/{record.maxScore}</td>
                <td className="px-5 py-3.5"><AdminAlertBadge level={record.alertLevel} size="sm" /></td>
                <td className="px-5 py-3.5"><AdminStatusBadge status={record.status} /></td>
                <td className="px-5 py-3.5 text-sm text-slate-500">{record.date}</td>
                <td className="px-5 py-3.5">
                  <button onClick={() => setSelectedId(record.id)} className="text-primary-600 hover:text-primary-700 cursor-pointer">
                    <Eye className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
