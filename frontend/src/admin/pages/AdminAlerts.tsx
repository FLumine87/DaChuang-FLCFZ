import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type AlertRecord } from '../data/adminMockData';
import { getAdminAlerts } from '../../services/mockApi';
import AdminAlertBadge from '../components/AdminAlertBadge';
import AdminStatusBadge from '../components/AdminStatusBadge';

/** 状态筛选。取值必须与 AlertRecord['status'] 一致：
 *  'pending' | 'processing' | 'resolved' | 'closed'（标签见 AdminStatusBadge）。
 * 值本身同时用于网址参数，便于从其它页面直接跳进某个筛选视图。 */
const STATUS_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待处理' },
  { value: 'processing', label: '处理中' },
  { value: 'resolved', label: '已解决' },
  { value: 'closed', label: '已关闭' },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]['value'];

export default function AdminAlerts() {
  // 筛选写进网址（?status=pending）：管理端概览的「处理待处理预警」按钮可直接跳进来
  const [params, setParams] = useSearchParams();
  const raw = params.get('status');
  const statusFilter: StatusFilter = STATUS_FILTERS.some((f) => f.value === raw)
    ? (raw as StatusFilter)
    : 'all';

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [alertRecords, setAlertRecords] = useState<AlertRecord[]>([]);
  const [, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await getAdminAlerts();
        setAlertRecords(data);
      } catch (e) {
        console.error('加载预警失败', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = alertRecords.filter(
    (a) => statusFilter === 'all' || a.status === statusFilter
  );
  // 详情面板：优先看当前筛选里的记录，其次回退到全部（避免切换筛选后详情突然空掉）
  const selected =
    filtered.find((a) => a.id === selectedId) ?? alertRecords.find((a) => a.id === selectedId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => {
          const active = statusFilter === f.value;
          const count =
            f.value === 'all'
              ? alertRecords.length
              : alertRecords.filter((a) => a.status === f.value).length;
          return (
            <button
              key={f.value}
              aria-pressed={active}
              onClick={() => {
                setSelectedId(null);
                setParams(f.value === 'all' ? {} : { status: f.value }, { replace: true });
              }}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                active
                  ? 'border-primary-500 bg-primary-50 font-medium text-primary-600'
                  : 'border-slate-200 text-slate-600 hover:border-primary-300 hover:text-primary-600'
              }`}
            >
              {f.label}
              <span className="text-xs tabular-nums text-slate-400">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          {filtered.length === 0 && (
            <div className="ui-card text-center py-12 text-sm text-slate-400">
              {alertRecords.length === 0
                ? '还没有预警记录。当学生出现分级预警时，会在这里显示并等待处置。'
                : '当前筛选下没有预警记录，切换到「全部」可查看其它状态。'}
            </div>
          )}
          {filtered.map((alert) => (
            <div
              key={alert.id}
              onClick={() => setSelectedId(alert.id)}
              className={`bg-white rounded-2xl border p-5 cursor-pointer transition-colors ${
                selectedId === alert.id ? 'border-primary-500 ring-1 ring-primary-200' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-3">
                  <AdminAlertBadge level={alert.level} />
                  <div>
                    <p className="text-sm font-medium text-slate-800">{alert.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{alert.id} · {alert.screeningId}</p>
                  </div>
                </div>
                <AdminStatusBadge status={alert.status} />
              </div>
              <p className="text-sm text-slate-600">{alert.description}</p>
            </div>
          ))}
        </div>

        <div className="ui-card p-5 h-fit">
          {selected ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-800">{selected.id}</h3>
                <AdminAlertBadge level={selected.level} />
              </div>
              <p className="text-sm text-slate-600">{selected.trigger}</p>
              <p className="text-sm text-slate-600">{selected.description}</p>
              <div className="text-xs text-slate-400 space-y-1">
                <p>创建：{selected.createdAt}</p>
                <p>更新：{selected.updatedAt}</p>
                <p>处理人：{selected.assignee}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">选择一条预警查看详情</p>
          )}
        </div>
      </div>
    </div>
  );
}
