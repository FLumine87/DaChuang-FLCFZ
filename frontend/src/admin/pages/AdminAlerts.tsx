import { useState } from 'react';
import { alertRecords } from '../data/adminMockData';
import AdminAlertBadge from '../components/AdminAlertBadge';
import AdminStatusBadge from '../components/AdminStatusBadge';

export default function AdminAlerts() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = alertRecords.find((a) => a.id === selectedId);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-3">
        {alertRecords.map((alert) => (
          <div
            key={alert.id}
            onClick={() => setSelectedId(alert.id)}
            className={`bg-white rounded-xl border p-4 shadow-sm cursor-pointer transition-colors ${
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

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-fit">
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
  );
}
