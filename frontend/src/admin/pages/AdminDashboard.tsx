import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  Flame,
  CalendarDays,
  ShieldCheck,
  Siren,
  Plus,
  FileText,
  ArrowRight,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { Link } from 'react-router-dom';
import { getAdminDashboardData, getDashboardStats, type DashboardStats } from '../../services/mockApi';
import AdminAlertBadge from '../components/AdminAlertBadge';
import type { AlertRecord } from '../data/adminMockData';

interface AdminDashboardData {
  trendData: { date: string; count: number; alerts: number }[];
  alertDistribution: { name: string; value: number; color: string }[];
  alertRecords: AlertRecord[];
}

/** 管理端配色：与深蓝侧边栏同一色系（青/ 橙） */
const CHART = {
  screening: '#22d3ee',
  alert: '#f97316',
  grid: 'rgba(148, 163, 184, 0.18)',
  axis: '#94a3b8',
};

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm animate-pulse">
      <div className="h-3 w-20 bg-slate-200 rounded" />
      <div className="h-7 w-14 bg-slate-200 rounded mt-2" />
      <div className="h-2.5 w-24 bg-slate-100 rounded mt-2" />
    </div>
  );
}

export default function AdminDashboard() {
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // 两个接口并行；单个失败不阻塞整体渲染
      const [dash, st] = await Promise.allSettled([
        getAdminDashboardData(),
        getDashboardStats(),
      ]);
      if (dash.status === 'fulfilled') setData(dash.value as AdminDashboardData);
      if (st.status === 'fulfilled') setStats(st.value);
      if (dash.status === 'rejected' && st.status === 'rejected') {
        throw new Error('all failed');
      }
    } catch (e) {
      console.error('加载仪表盘失败', e);
      setError('数据加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-10 flex items-center justify-center gap-2 text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">正在加载仪表盘数据...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-danger-200 p-10 text-center">
        <AlertCircle className="w-7 h-7 text-danger-500 mx-auto" />
        <p className="text-sm text-slate-600 mt-2">{error}</p>
        <button onClick={load} className="mt-3 text-sm text-primary-600 hover:text-primary-700 cursor-pointer">
          点击重试
        </button>
      </div>
    );
  }

  const { trendData, alertDistribution, alertRecords } = data ?? {
    trendData: [],
    alertDistribution: [],
    alertRecords: [],
  };

  // 高危占比：由真实等级分布计算得出，不写死
  const dist = stats?.alert_distribution;
  const distTotal = dist ? Object.values(dist).reduce((a, b) => a + b, 0) : 0;
  const criticalRate = distTotal > 0 && dist ? Math.round((dist.red / distTotal) * 100) : null;

  // 主指标：浅色主卡；不设彩条/分隔线，语义全由数字颜色承担（避免多重分隔打架）
  const heroStats = [
    {
      label: '总筛查人数',
      value: stats ? stats.total_screenings.toLocaleString() : '—',
      tone: 'text-slate-800',
      sub: '累计建档',
    },
    {
      label: '待处理预警',
      value: stats ? stats.pending_alerts.toLocaleString() : '—',
      tone: (stats?.pending_alerts ?? 0) > 0 ? 'text-danger-600' : 'text-success-600',
      sub: (stats?.pending_alerts ?? 0) > 0 ? '需优先处置' : '暂无待办',
    },
    {
      label: '筛查完成率',
      value: stats ? `${stats.completion_rate}%` : '—',
      tone: 'text-success-700',
      sub: '已出具结论',
    },
  ];

  // 次要指标：4 张小卡，语义色左边条 + 数字着色；0 值时变灰并给友好文案
  const minorStats = [
    {
      label: '高危占比',
      value: criticalRate === null ? '—' : `${criticalRate}%`,
      hint: distTotal > 0 && dist ? `危险 ${dist.red} / 共 ${distTotal} 条` : '暂无数据',
      icon: Flame,
      bar: 'bg-orange-500',
      valueClass:
        criticalRate === null || criticalRate === 0 ? 'text-slate-400' : 'text-orange-600',
      muted: false,
    },
    {
      label: '本月筛查',
      value: stats ? stats.monthly_screenings.toLocaleString() : '—',
      hint:
        stats && stats.monthly_screenings === 0
          ? '本月暂无新筛查记录'
          : `当月新增 ${stats?.monthly_screenings ?? 0} 例`,
      icon: CalendarDays,
      bar: 'bg-primary-500',
      valueClass: stats?.monthly_screenings ? 'text-slate-800' : 'text-slate-400',
      muted: stats?.monthly_screenings === 0,
    },
    {
      label: '危险预警',
      value: dist ? dist.red.toLocaleString() : '—',
      hint: dist && dist.red > 0 ? '需 24 小时内处置' : '当前无危险预警',
      icon: Siren,
      bar: 'bg-danger-500',
      valueClass: dist && dist.red > 0 ? 'text-danger-600' : 'text-slate-400',
      muted: dist?.red === 0,
    },
    {
      label: '预警总量',
      value: distTotal > 0 ? distTotal.toLocaleString() : '—',
      hint: stats ? `${stats.pending_alerts} 条待处理` : '暂无数据',
      icon: ShieldCheck,
      bar: 'bg-emerald-500',
      valueClass: distTotal > 0 ? 'text-slate-800' : 'text-slate-400',
      muted: distTotal === 0,
    },
  ];

  return (
    <div className="space-y-4">
      {/* 主指标区：一张大卡 —— 左侧 3 个核心指标（靠数字色表语义），右侧操作按钮 */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-stretch">
          {/* 指标区：无彩条，仅浅分隔线；语义由数字颜色承担 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 flex-1">
            {heroStats.map((s, i) => (
              <div
                key={s.label}
                className={`px-5 py-4 ${
                  i > 0 ? 'border-t sm:border-t-0 sm:border-l border-slate-100' : ''
                }`}
              >
                <p className="text-xs text-slate-500">{s.label}</p>
                <p className={`text-2xl font-bold mt-0.5 tabular-nums ${s.tone}`}>{s.value}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{s.sub}</p>
              </div>
            ))}
          </div>

          {/* 操作区：与指标同处一张卡，靠右对齐 */}
          <div
            className="flex flex-wrap items-center gap-2 px-5 py-4
                       lg:border-l border-slate-100 bg-white/60 lg:rounded-r-xl"
          >
            <Link
              to="/admin/alerts"
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-danger-500 hover:bg-danger-600
                         text-white rounded-lg transition-colors text-xs font-medium shadow-sm"
            >
              <AlertTriangle className="w-3.5 h-3.5" /> 处理预警
              {stats && stats.pending_alerts > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 bg-white/25 text-white rounded-full text-[10px] tabular-nums">
                  {stats.pending_alerts}
                </span>
              )}
            </Link>
            <Link
              to="/admin/screening"
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50
                         border border-slate-200 text-slate-700 rounded-lg transition-colors text-xs font-medium"
            >
              <Plus className="w-3.5 h-3.5" /> 新建筛查
            </Link>
            <Link
              to="/admin/retrieval"
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50
                         border border-slate-200 text-slate-700 rounded-lg transition-colors text-xs font-medium"
            >
              <FileText className="w-3.5 h-3.5" /> 检索分析
            </Link>
          </div>
        </div>
      </div>

      {/* 次要指标：4 张小卡（左边语义色条 + 数字着色） */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {minorStats.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.label}
              className={`relative bg-white rounded-xl border border-slate-200 p-4 shadow-sm
                          overflow-hidden transition-shadow hover:shadow-md ${
                            c.muted ? 'opacity-70' : ''
                          }`}
            >
              <span className={`absolute left-0 top-0 bottom-0 w-1 ${c.bar}`} aria-hidden="true" />
              <div className="flex items-start justify-between gap-2 pl-2">
                <div className="min-w-0">
                  <p className="text-xs text-slate-500">{c.label}</p>
                  <p className={`text-2xl font-bold mt-0.5 tabular-nums ${c.valueClass}`}>
                    {c.value}
                  </p>
                </div>
                <span
                  className={`w-8 h-8 rounded-lg bg-slate-50 ${c.valueClass} flex items-center justify-center shrink-0`}
                >
                  <Icon className="w-4 h-4" />
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5 truncate pl-2" title={c.hint}>
                {c.hint}
              </p>
            </div>
          );
        })}
      </div>

      {/* 图表 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">近 12 天筛查与预警趋势</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                stroke={CHART.axis}
                tickLine={false}
                axisLine={{ stroke: CHART.grid }}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke={CHART.axis}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 8,
                  border: '1px solid #e2e8f0',
                  fontSize: 12,
                  boxShadow: '0 4px 12px rgba(0,0,0,.08)',
                }}
              />
              <Line
                type="monotone"
                dataKey="count"
                name="筛查数"
                stroke={CHART.screening}
                strokeWidth={2}
                dot={{ r: 2.5, fill: CHART.screening }}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="alerts"
                name="预警数"
                stroke={CHART.alert}
                strokeWidth={2}
                dot={{ r: 2.5, fill: CHART.alert }}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">预警等级分布</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={alertDistribution}
                cx="50%"
                cy="46%"
                innerRadius={48}
                outerRadius={76}
                paddingAngle={3}
                dataKey="value"
                stroke="none"
              >
                {alertDistribution.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
              />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                iconSize={7}
                wrapperStyle={{ fontSize: 11 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 最新预警 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800">最新预警</h3>
          <Link
            to="/admin/alerts"
            className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
          >
            全部预警 <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        {alertRecords.length === 0 ? (
          <p className="text-center py-10 text-slate-400 text-sm">暂无预警记录</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {alertRecords.slice(0, 5).map((alert) => (
              <Link
                key={alert.id}
                to="/admin/alerts"
                className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <AdminAlertBadge level={alert.level} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{alert.name}</p>
                    <p className="text-xs text-slate-400 truncate">{alert.trigger}</p>
                  </div>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="text-xs text-slate-400">{alert.createdAt}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{alert.assignee}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}