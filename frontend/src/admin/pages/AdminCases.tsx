import { useState, useEffect, useCallback } from 'react';
import { type CaseRecord } from '../data/adminMockData';
import { getAdminCases } from '../../services/mockApi';
import AdminAlertBadge from '../components/AdminAlertBadge';
import AdminStatusBadge from '../components/AdminStatusBadge';
import Pagination from '../components/Pagination';
import { Search, Filter, Loader2, AlertCircle, ChevronDown } from 'lucide-react';

const PAGE_SIZE = 12;

export default function AdminCases() {
  const [keyword, setKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [level, setLevel] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<CaseRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchCases = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getAdminCases({
        page,
        page_size: PAGE_SIZE,
        keyword: keyword.trim(),
        level,
      });
      setItems(res.items);
      setTotal(res.total);
      setTotalPages(res.total_pages);
    } catch (e) {
      console.error('加载案例失败', e);
      setError('加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [page, keyword, level]);

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  // 搜索输入防抖：停止输入 350ms 后才发请求
  useEffect(() => {
    const t = setTimeout(() => {
      setKeyword(searchInput);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex flex-wrap gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="搜索姓名、编号或院系..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9 pr-4 py-2 w-72 border border-slate-200 rounded-lg text-sm bg-white
                         focus:outline-none focus:ring-2 focus:ring-primary-500 w-full sm:w-auto"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <select
              value={level}
              onChange={(e) => {
                setLevel(e.target.value);
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
            onClick={fetchCases}
            className="mt-3 text-sm text-primary-600 hover:text-primary-700 cursor-pointer"
          >
            点击重试
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((item) => (
              <div key={item.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-medium text-slate-800">{item.name}</p>
                  <AdminAlertBadge level={item.alertLevel} size="sm" />
                </div>
                <p className="text-xs text-slate-400">{item.id} · {item.department}</p>
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-sm text-slate-600">筛查 {item.screeningCount} 次</p>
                  <AdminStatusBadge status={item.status} />
                </div>
              </div>
            ))}
          </div>

          {!loading && items.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 text-sm">
              暂无匹配的案例
            </div>
          )}

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
