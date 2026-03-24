import { useState, useEffect } from 'react';
import { Search, Filter, Plus, Eye, ChevronDown } from 'lucide-react';
import { getScreeningList } from '../services/api';
import AlertBadge from '../components/AlertBadge';
import StatusBadge from '../components/StatusBadge';
import ScreeningDetail from './ScreeningDetail';

export default function Screening() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [screenings, setScreenings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRecord, setSelectedRecord] = useState<any>(null);

  useEffect(() => {
    async function fetchScreenings() {
      try {
        setLoading(true);
        const data = await getScreeningList();
        setScreenings(data);
      } catch (error) {
        console.error('Failed to fetch screenings:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchScreenings();
  }, []);

  const filtered = screenings.filter((r) => {
    const matchesSearch = r.name.includes(searchTerm) || r.id.toString().includes(searchTerm);
    const matchesLevel = filterLevel === 'all' || r.alert_level === filterLevel;
    return matchesSearch && matchesLevel;
  });

  if (selectedId && selectedRecord) {
    return <ScreeningDetail record={selectedRecord} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
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
        <button className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium cursor-pointer">
          <Plus className="w-4 h-4" /> 新建筛查
        </button>
      </div>

      {/* Table */}
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
            {loading ? (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-slate-500">
                  加载中...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-slate-500">
                  暂无筛查数据
                </td>
              </tr>
            ) : (
              filtered.map((record) => (
                <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5 text-sm font-mono text-slate-500">SCR-{record.id.toString().padStart(3, '0')}</td>
                  <td className="px-5 py-3.5">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{record.name}</p>
                      <p className="text-xs text-slate-400">{record.gender} · {record.age}岁</p>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-slate-600">{record.questionnaire_name}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800">{record.score}</span>
                      <span className="text-xs text-slate-400">/ {record.max_score}</span>
                      <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            record.alert_level === 'red' ? 'bg-danger-500' :
                            record.alert_level === 'orange' ? 'bg-orange-500' :
                            record.alert_level === 'yellow' ? 'bg-warning-500' : 'bg-success-500'
                          }`}
                          style={{ width: `${(record.score / record.max_score) * 100}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <AlertBadge level={record.alert_level} />
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={record.status} />
                  </td>
                  <td className="px-5 py-3.5 text-sm text-slate-500">{record.created_at}</td>
                  <td className="px-5 py-3.5">
                    <button
                      onClick={async () => {
                        try {
                          const detail = await import('./ScreeningDetail');
                          setSelectedRecord(record);
                          setSelectedId(record.id);
                        } catch (error) {
                          console.error('Failed to load detail:', error);
                        }
                      }}
                      className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-700 text-sm font-medium transition-colors"
                    >
                      <Eye className="w-4 h-4" /> 查看
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-12 text-slate-400 text-sm">暂无匹配的筛查记录</div>
        )}
      </div>
    </div>
  );
}
