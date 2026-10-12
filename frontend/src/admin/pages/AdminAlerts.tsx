import { useState, useEffect, useCallback } from 'react';
import { type AlertRecord } from '../data/adminMockData';
import { getAdminAlerts } from '../../services/mockApi';
import AdminAlertBadge from '../components/AdminAlertBadge';
import AdminStatusBadge from '../components/AdminStatusBadge';
import AlertDetailPanel from '../components/AlertDetailPanel';
import Drawer from '../components/Drawer';
import Pagination from '../components/Pagination';
import { Search, Filter, Loader2, AlertCircle, ChevronDown, Inbox } from 'lucide-react';

const PAGE_SIZE = 12;

export default function AdminAlerts() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [level, setLevel] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AlertRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getAdminAlerts({
        page,
        page_size: PAGE_SIZE,
        keyword: keyword.trim(),
        level,
      });
      setItems(res.items);
      setTotal(res.total);
      setTotalPages(res.total_pages);
    } catch (e) {
      console.error('加载预警失败', e);
      setError('加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [page, keyword, level]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  useEffect(() => {
    const t = setTimeout(() => {
      setKeyword(searchInput);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const selected = items.find((a) => a.id === selectedId) ?? null;

  /** 处置成功后：局部更新，避免整页重载导致滚动位置丢失 */
  const handleUpdated = ({
    status,
    assignee,
  }: {
    status: AlertRecord['status'];
    assignee: string;
  }) => {
    setItems((prev) =>
      prev.map((a) => (a.id === selectedId ? { ...a, status, assignee } : a))
    );
  };

  // 切换筛选条件时关闭抽屉，避免显示已不在结果集中的预警
  useEffect(() => {
    setSelectedId(null);
  }, [page, keyword, level]);

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex flex-wrap gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="搜索姓名或预警编号..."
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
              onChange={(e) => setLevel(e.target.value)}
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
            onClick={fetchAlerts}
            className="mt-3 text-sm text-primary-600 hover:text-primary-700 cursor-pointer"
          >
            点击重试
          </button>
        </div>
      ) : (
        <>
          {/* 预警列表：整宽两列 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {items.map((alert) => (
              <button
                key={alert.id}
                onClick={() => setSelectedId(alert.id)}
                className="bg-white rounded-xl border border-slate-200 p-4 text-left
                           shadow-sm hover:border-primary-300 hover:shadow-md
                           transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <AdminAlertBadge level={alert.level} />
                    <span className="text-sm font-medium text-slate-800 truncate">
                      {alert.name}
                    </span>
                  </div>
                  <AdminStatusBadge status={alert.status} />
                </div>

                <p className="text-sm text-slate-600 line-clamp-2 leading-6">
                  {alert.description}
                </p>

                <div className="flex items-center justify-between mt-3 text-xs text-slate-400">
                  <span className="font-mono">{alert.id}</span>
                  <span>
                    {alert.assignee !== '未分配' && `${alert.assignee} · `}
                    {alert.createdAt}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {!loading && items.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-200 py-16 text-center">
              <Inbox className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-sm text-slate-500 mt-3">暂无匹配的预警</p>
              <p className="text-xs text-slate-400 mt-1">试试调整搜索词或筛选条件</p>
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

      {/* 详情抽屉：点击后从右侧滑出 */}
      <Drawer
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title="预警详情与处置"
      >
        {selected && (
          <div className="p-4">
            <AlertDetailPanel alert={selected} onUpdated={handleUpdated} />
          </div>
        )}
      </Drawer>
    </div>
  );
}
