import { useState, useEffect, useCallback } from 'react';
import { Search, Filter, Eye, ChevronDown, Loader2, AlertCircle } from 'lucide-react';
import { type ScreeningRecord } from '../data/adminMockData';
import { getAdminScreeningRecords } from '../../services/mockApi';
import AdminAlertBadge from '../components/AdminAlertBadge';
import AdminStatusBadge from '../components/AdminStatusBadge';
import Pagination from '../components/Pagination';
import AdminScreeningDetail from './AdminScreeningDetail';

const PAGE_SIZE = 12;

export default function AdminScreening() {
  const [searchInput, setSearchInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [filterLevel, setFilterLevel] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ScreeningRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getAdminScreeningRecords({
        page,
        page_size: PAGE_SIZE,
        keyword: keyword.trim(),
        level: filterLevel,
      });
      setItems(res.items);
      setTotal(res.total);
      setTotalPages(res.total_pages);
    } catch (e) {
      console.error('加载筛查记录失败', e);
      setError('加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [page, keyword, filterLevel]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    const t = setTimeout(() => {
      setKeyword(searchInput);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // 详情页：只在当前页数据中查找
  const record = selectedId ? items.find((r) => r.id === selectedId) : undefined;

  if (selectedId && record) {
    return <AdminScreeningDetail record={record} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex flex-wrap gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="搜索姓名或编号..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9 pr-4 py-2 w-64 border border-slate-200 rounded-lg text-sm bg-white
                         focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <select
              value={filterLevel}
              onChange={(e) => {
                setFilterLevel(e.target.value);
                setPage(1);
              }}
              className="pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-sm bg-white
                         appearance-none focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
            >
              <option value="">全部等级</option>
              <option value="red">危险</option>
              <option value="orange">警告</option>
              <option value="yellow">关注</option>
              <option value="green">正常</option>
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
        </div>
        {loading && <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />}
      </div>

      {error ? (
        <div className="bg-white rounded-xl border border-danger-200 p-8 text-center">
          <AlertCircle className="w-6 h-6 text-danger-500 mx-auto" />
          <p className="text-sm text-slate-600 mt-2">{error}</p>
          <button
            onClick={fetchRecords}
            className="mt-3 text-sm text-primary-600 hover:text-primary-700 cursor-pointer"
          >
            点击重试
          </button>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
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
                  {items.map((record) => (
                    <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5 text-sm font-mono text-slate-500">{record.id}</td>
                      <td className="px-5 py-3.5 text-sm text-slate-700">{record.name}</td>
                      <td className="px-5 py-3.5 text-sm text-slate-600">{record.questionnaire}</td>
                      <td className="px-5 py-3.5 text-sm text-slate-700">{record.score}/{record.maxScore}</td>
                      <td className="px-5 py-3.5"><AdminAlertBadge level={record.alertLevel} size="sm" /></td>
                      <td className="px-5 py-3.5"><AdminStatusBadge status={record.status} /></td>
                      <td className="px-5 py-3.5 text-sm text-slate-500">{record.date}</td>
                      <td className="px-5 py-3.5">
                        <button
                          onClick={() => setSelectedId(record.id)}
                          className="text-primary-600 hover:text-primary-700 cursor-pointer"
                          aria-label="查看详情"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!loading && items.length === 0 && (
              <div className="text-center py-12 text-slate-400 text-sm">暂无匹配的筛查记录</div>
            )}
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}
