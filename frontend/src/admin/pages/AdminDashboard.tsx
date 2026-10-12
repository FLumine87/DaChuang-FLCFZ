import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, ClipboardCheck, Database, TrendingUp } from 'lucide-react';
import {
  CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Link } from 'react-router-dom';
import { getAdminDashboard, USE_MOCK, type AdminDashboardData } from '../../services/adminApi';
import AdminAlertBadge from '../components/AdminAlertBadge';

const cardStyle = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm';

export default function AdminDashboard() {
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    getAdminDashboard().then((result) => {
      if (active) { setData(result); setError(''); }
    }).catch((reason: unknown) => {
      if (active) { setData(null); setError(reason instanceof Error ? reason.message : '加载失败'); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);

  const refresh = () => { setLoading(true); setReload((value) => value + 1); };
  const stats = data?.stats;
  const cards = [
    { label: '累计筛查记录', value: stats?.totalScreenings ?? 0, icon: Database, color: 'text-sky-600 bg-sky-50' },
    { label: '本月筛查', value: stats?.monthlyScreenings ?? 0, icon: ClipboardCheck, color: 'text-emerald-600 bg-emerald-50' },
    { label: '待跟进预警', value: stats?.openAlerts ?? 0, icon: AlertTriangle, color: 'text-rose-600 bg-rose-50' },
    { label: '筛查完成率', value: (stats?.completionRate ?? 0) + '%', icon: TrendingUp, color: 'text-amber-600 bg-amber-50' },
  ];
  const distribution = data?.alertDistribution ?? [];
  const hasDistribution = distribution.some((item) => item.value > 0);
  const hasTrend = (data?.trendData ?? []).some((item) => item.count > 0 || item.alerts > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">管理概览</h2>
          <p className="mt-1 text-sm text-slate-500">{USE_MOCK ? '当前为演示数据，仅用于体验界面。' : '筛查、预警与跟进情况来自当前数据库。'}</p>
        </div>
        <div className="flex items-center gap-2">
          {USE_MOCK && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">演示数据</span>}
          {!USE_MOCK && (stats?.seedRecords ?? 0) > 0 &&
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">已识别 SEED- 样本 {stats?.seedRecords} 条</span>}
          <button type="button" onClick={refresh} disabled={loading}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            刷新
          </button>
        </div>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        仪表盘加载失败：{error} <button type="button" onClick={refresh} className="ml-2 underline">重试</button>
      </div>}
      {loading && <p role="status" className="text-sm text-slate-500">正在读取统计数据…</p>}

      {!loading && data && <>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => {
            const Icon = card.icon;
            return <div key={card.label} className={cardStyle}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-slate-500">{card.label}</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{card.value}</p>
                </div>
                <div className={'rounded-xl p-3 ' + card.color}><Icon className="h-5 w-5" /></div>
              </div>
            </div>;
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/screening" className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800">查看筛查记录</Link>
          <Link to="/admin/alerts" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">处理预警</Link>
          <Link to="/admin/cases" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">查看案例</Link>
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <section className={cardStyle + ' lg:col-span-2'}>
            <h3 className="font-semibold text-slate-900">近 12 天筛查与预警</h3>
            {hasTrend ? <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" fontSize={12} />
                  <YAxis allowDecimals={false} fontSize={12} />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="#0284c7" name="筛查数" />
                  <Line type="monotone" dataKey="alerts" stroke="#e11d48" name="预警数" />
                </LineChart>
              </ResponsiveContainer>
            </div> : <p className="mt-8 text-sm text-slate-500">近 12 天暂无筛查或预警记录。</p>}
          </section>
          <section className={cardStyle}>
            <h3 className="font-semibold text-slate-900">预警等级分布</h3>
            {hasDistribution ? <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={distribution} dataKey="value" innerRadius={52} outerRadius={82}>
                    {distribution.map((item) => <Cell key={item.name} fill={item.color} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div> : <p className="mt-8 text-sm text-slate-500">暂无预警，分布图将在产生记录后显示。</p>}
          </section>
        </div>
        <section className={cardStyle}>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">最新预警</h3>
            <Link to="/admin/alerts" className="inline-flex items-center gap-1 text-sm text-sky-700 hover:underline">查看全部 <ArrowRight className="h-4 w-4" /></Link>
          </div>
          {data.alertRecords.length === 0 ? <p className="mt-5 text-sm text-slate-500">暂无预警记录。</p> :
            <div className="mt-4 divide-y divide-slate-100">
              {data.alertRecords.slice(0, 5).map((alert) => <div key={alert.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3">
                  <AdminAlertBadge level={alert.level} />
                  <div><p className="text-sm font-medium text-slate-900">{alert.name || '未填写姓名'}</p>
                    <p className="text-xs text-slate-500">{alert.trigger || '未填写触发原因'}</p></div>
                </div>
                <div className="text-right text-xs text-slate-500"><p>{alert.createdAt}</p><p>{alert.assignee}</p></div>
              </div>)}
            </div>}
        </section>
      </>}
    </div>
  );
}
