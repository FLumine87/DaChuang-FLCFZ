import { useState } from 'react';
import { Filter, ChevronDown, Clock, AlertTriangle, ShieldAlert } from 'lucide-react';
import { warningEvents } from '../data/mockData';
import AlertBadge from '../components/AlertBadge';
import StatusBadge from '../components/StatusBadge';

export default function Alerts() {
  const [filterLevel, setFilterLevel] = useState<'all' | 'red' | 'orange' | 'yellow' | 'green'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'new' | 'tracking' | 'resolved'>('all');
  const [selectedAlert, setSelectedAlert] = useState<string | null>(null);

  const filtered = warningEvents.filter((a) => {
    const matchLevel = filterLevel === 'all' || a.level === filterLevel;
    const matchStatus = filterStatus === 'all' || a.status === filterStatus;
    return matchLevel && matchStatus;
  });

  const selected = warningEvents.find((a) => a.id === selectedAlert);

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-base font-semibold text-slate-800">个人预警中心</h3>
        <p className="text-sm text-slate-500 mt-2">
          当模型检测到“情绪持续下行、压力过载或睡眠显著下降”时，将在这里推送分级预警与可执行建议。
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: '新触发', count: warningEvents.filter((a) => a.status === 'new').length, color: 'text-danger-600 bg-danger-50' },
          { label: '跟踪中', count: warningEvents.filter((a) => a.status === 'tracking').length, color: 'text-blue-600 bg-blue-50' },
          { label: '已缓解', count: warningEvents.filter((a) => a.status === 'resolved').length, color: 'text-success-600 bg-success-50' },
          { label: '高风险', count: warningEvents.filter((a) => a.level === 'red').length, color: 'text-orange-600 bg-orange-50' },
        ].map((item) => (
          <div key={item.label} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <p className="text-sm text-slate-500">{item.label}</p>
            <p className={`text-2xl font-bold mt-1 ${item.color.split(' ')[0]}`}>{item.count}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value as 'all' | 'red' | 'orange' | 'yellow' | 'green')}
            className="pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-sm bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
          >
            <option value="all">全部等级</option>
            <option value="red">危险</option>
            <option value="orange">警告</option>
            <option value="yellow">关注</option>
            <option value="green">稳定</option>
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
        <div className="relative">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as 'all' | 'new' | 'tracking' | 'resolved')}
            className="px-4 pr-8 py-2 border border-slate-200 rounded-lg text-sm bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
          >
            <option value="all">全部状态</option>
            <option value="new">新触发</option>
            <option value="tracking">跟踪中</option>
            <option value="resolved">已缓解</option>
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Alert List */}
        <div className="lg:col-span-2 space-y-3">
          {filtered.map((alert) => (
            <div
              key={alert.id}
              onClick={() => setSelectedAlert(alert.id)}
              className={`bg-white rounded-xl border p-4 shadow-sm cursor-pointer transition-colors ${
                selectedAlert === alert.id
                  ? 'border-primary-500 ring-1 ring-primary-200'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-3">
                  <AlertBadge level={alert.level} />
                  <div>
                    <p className="text-sm font-medium text-slate-800">{alert.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{alert.id}</p>
                  </div>
                </div>
                <StatusBadge status={alert.status} />
              </div>
              <p className="text-sm text-slate-600 mb-2">{alert.reason}</p>
              <div className="flex items-center gap-4 text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> 风险提示：{alert.title}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {alert.createdAt}
                </span>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-12 text-slate-400 text-sm bg-white rounded-xl border border-slate-200">
              暂无匹配的预警记录
            </div>
          )}
        </div>

        {/* Alert Detail Panel */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 h-fit sticky top-6">
          {selected ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-800">{selected.id}</h3>
                <AlertBadge level={selected.level} />
              </div>
              <div className="space-y-3">
                {[
                  ['预警标题', selected.title],
                  ['触发原因', selected.reason],
                  ['创建时间', selected.createdAt],
                  ['更新时间', selected.updatedAt],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between text-sm">
                    <span className="text-slate-400">{label}</span>
                    <span className="text-slate-700 font-medium">{value}</span>
                  </div>
                ))}
                <div>
                  <span className="text-sm text-slate-400">状态</span>
                  <div className="mt-1"><StatusBadge status={selected.status} /></div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100">
                <p className="text-sm text-slate-400 mb-1">建议动作</p>
                <p className="text-sm text-slate-700">{selected.suggestion}</p>
              </div>
              <div className="flex gap-2 pt-2">
                {selected.status === 'new' && (
                  <button className="flex-1 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 cursor-pointer">
                    标记为跟踪中
                  </button>
                )}
                {selected.status === 'tracking' && (
                  <button className="flex-1 py-2 bg-success-600 text-white rounded-lg text-sm font-medium hover:bg-success-500 cursor-pointer">
                    标记为已缓解
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-slate-400 text-sm">
              <ShieldAlert className="w-8 h-8 mx-auto mb-2 text-slate-200" />
              选择一条预警查看详情
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
