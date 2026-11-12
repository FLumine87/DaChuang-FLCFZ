import { useState, useEffect } from 'react';
import { Search, Filter, Eye, ChevronDown, RefreshCw } from 'lucide-react';
import { type ScreeningRecord } from '../data/adminMockData';
import { getAdminScreeningRecords } from '../../services/mockApi';
import AdminAlertBadge from '../components/AdminAlertBadge';
import AdminStatusBadge from '../components/AdminStatusBadge';
import AdminScreeningDetail from './AdminScreeningDetail';
import AdminSupplements from './AdminSupplements';

export default function AdminScreening() {
  const [mode, setMode] = useState<'questionnaire' | 'multimodal'>('questionnaire');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [screeningRecords, setScreeningRecords] = useState<ScreeningRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const data = await getAdminScreeningRecords();
        if (alive) setScreeningRecords(data);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '筛查记录加载失败，请稍后重试');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [reload]);

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
      <div className="flex gap-3" aria-label="筛查数据类型">
        <button className="ui-button" aria-pressed={mode === 'questionnaire'} onClick={() => setMode('questionnaire')}>问卷筛查</button>
        <button className="ui-button" aria-pressed={mode === 'multimodal'} onClick={() => setMode('multimodal')}>多模态采集与分析</button>
      </div>
      {mode === 'multimodal' ? <AdminSupplements /> : <>
      <div className="flex flex-wrap gap-3 items-center">
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

      <div className="ui-card overflow-hidden">
        <div className="ui-table-scroll"><table className="ui-table">
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
            {loading && (
              <tr>
                <td colSpan={8} className="px-5 py-12 text-center text-sm text-slate-400">
                  正在加载筛查记录…
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={8} className="px-5 py-12 text-center text-sm">
                  <p className="font-medium text-rose-700">筛查记录加载失败</p>
                  <p className="mt-1 text-slate-500">{error}</p>
                  <p className="mt-1 text-xs text-slate-400">这不等于没有记录，可能是网络或后端暂时不可用。</p>
                  <button
                    type="button"
                    onClick={() => setReload((value) => value + 1)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    重试
                  </button>
                </td>
              </tr>
            )}
            {!loading && !error && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-12 text-center text-sm text-slate-400">
                  当前筛选条件下没有筛查记录。试试清空搜索词，或把等级筛选改成全部。
                </td>
              </tr>
            )}
            {!loading && !error && filtered.map((record) => (
              <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-5 py-3.5 text-sm font-mono text-slate-500">{record.id}</td>
                <td className="px-5 py-3.5 text-sm text-slate-700">{record.name}</td>
                <td className="px-5 py-3.5 text-sm text-slate-600">{record.questionnaire}</td>
                <td className="px-5 py-3.5 text-sm text-slate-700">{record.score}/{record.maxScore}</td>
                <td className="px-5 py-3.5"><AdminAlertBadge level={record.alertLevel} size="sm" /></td>
                <td className="px-5 py-3.5"><AdminStatusBadge status={record.status} /></td>
                <td className="px-5 py-3.5 text-sm text-slate-500">{record.date}</td>
                <td className="px-5 py-3.5">
                  <button onClick={() => setSelectedId(record.id)} aria-label={`查看 ${record.name} 的筛查详情`} className="text-primary-600 hover:text-primary-700 cursor-pointer">
                    <Eye className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      </>}
    </div>
  );
}
