import { useState, useEffect } from 'react';
import { Filter, ChevronDown, Clock, User, AlertTriangle } from 'lucide-react';
import { alertRecords } from '../data/mockData';
import { getAlertList } from '../services/api';
import AlertBadge from '../components/AlertBadge';
import StatusBadge from '../components/StatusBadge';

export default function Alerts() {
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedAlert, setSelectedAlert] = useState<string | null>(null);
  const [alerts, setAlerts] = useState(alertRecords);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        setLoading(true);
        const data = await getAlertList();
        setAlerts(data);
      } catch (error) {
        console.error('Failed to fetch alerts:', error);
        // 使用 mock 数据作为 fallback
        setAlerts(alertRecords);
      } finally {
        setLoading(false);
      }
    };

    fetchAlerts();
  }, []);

  const filtered = alerts.filter((a) => {
    const matchLevel = filterLevel === 'all' || a.level === filterLevel;
    const matchStatus = filterStatus === 'all' || a.status === filterStatus;
    return matchLevel && matchStatus;
  });

  const selected = alerts.find((a) => a.id === selectedAlert);

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: '待处理', count: alerts.filter((a) => a.status === 'pending').length, color: 'text-danger-600 bg-danger-50' },
          { label: '处理中', count: alerts.filter((a) => a.status === 'processing').length, color: 'text-blue-600 bg-blue-50' },
          { label: '已解决', count: alerts.filter((a) => a.status === 'resolved').length, color: 'text-success-600 bg-success-50' },
          { label: '已关闭', count: alerts.filter((a) => a.status === 'closed').length, color: 'text-slate-500 bg-slate-100' },
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
            onChange={(e) => setFilterLevel(e.target.value)}
            className="pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-sm bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
          >
            <option value="all">全部等级</option>
            <option value="red">危险</option>
            <option value="orange">警告</option>
            <option value="yellow">关注</option>
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
        <div className="relative">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 pr-8 py-2 border border-slate-200 rounded-lg text-sm bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
          >
            <option value="all">全部状态</option>
            <option value="pending">待处理</option>
            <option value="processing">处理中</option>
            <option value="resolved">已解决</option>
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Alert List */}
        <div className="lg:col-span-2 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <p className="text-slate-500">加载中...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-10">
              <p className="text-slate-500">暂无预警数据</p>
            </div>
          ) : (
            filtered.map((alert) => (
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
                      <p className="text-sm font-medium text-slate-800">{alert.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{alert.alert_id}</p>
                    </div>
                  </div>
                  <StatusBadge status={alert.status} />
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {alert.trigger}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {alert.created_at}
                  </span>
                  <span className="flex items-center gap-1">
                    <User className="w-3 h-3" /> {alert.assignee_name || '未分配'}
                  </span>
                </div>
              </div>
            ))
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
                  ['被筛查者', selected.name],
                  ['触发条件', selected.trigger],
                  ['关联筛查', selected.screeningId],
                  ['处理人', selected.assignee],
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
                <p className="text-sm text-slate-400 mb-1">描述</p>
                <p className="text-sm text-slate-700">{selected.description}</p>
              </div>
              <div className="flex gap-2 pt-2">
                {selected.status === 'pending' && (
                  <button className="flex-1 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 cursor-pointer">
                    开始处理
                  </button>
                )}
                {selected.status === 'processing' && (
                  <button className="flex-1 py-2 bg-success-600 text-white rounded-lg text-sm font-medium hover:bg-success-500 cursor-pointer">
                    标记解决
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-slate-400 text-sm">
              <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-slate-200" />
              选择一条预警查看详情
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
