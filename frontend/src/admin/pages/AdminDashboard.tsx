import {
  Users,
  ClipboardCheck,
  AlertTriangle,
  TrendingUp,
  Plus,
  FileText,
  ArrowRight,
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
import { trendData, alertDistribution, alertRecords } from '../data/adminMockData';
import AdminAlertBadge from '../components/AdminAlertBadge';

const stats = [
  { label: '总筛查人数', value: '1,247', icon: Users, color: 'bg-primary-50 text-primary-600', trend: '+12%' },
  { label: '本月筛查', value: '156', icon: ClipboardCheck, color: 'bg-success-50 text-success-600', trend: '+8%' },
  { label: '待处理预警', value: '9', icon: AlertTriangle, color: 'bg-danger-50 text-danger-600', trend: '-3%' },
  { label: '本月完成率', value: '87%', icon: TrendingUp, color: 'bg-warning-50 text-warning-600', trend: '+5%' },
];

export default function AdminDashboard() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">{stat.label}</p>
                  <p className="text-2xl font-bold text-slate-800 mt-1">{stat.value}</p>
                </div>
                <div className={`w-12 h-12 rounded-xl ${stat.color} flex items-center justify-center`}>
                  <Icon className="w-6 h-6" />
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-3">
                较上月 <span className={stat.trend.startsWith('+') ? 'text-success-600' : 'text-danger-600'}>{stat.trend}</span>
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex gap-3">
        <Link
          to="/admin/screening"
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> 新建筛查
        </Link>
        <Link
          to="/admin/alerts"
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium"
        >
          <AlertTriangle className="w-4 h-4" /> 查看预警
        </Link>
        <Link
          to="/admin/retrieval"
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium"
        >
          <FileText className="w-4 h-4" /> 导出报告
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-800 mb-4">近期筛查趋势</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }} />
              <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="筛查数" />
              <Line type="monotone" dataKey="alerts" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} name="预警数" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-800 mb-4">预警等级分布</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={alertDistribution} cx="50%" cy="45%" innerRadius={55} outerRadius={85} paddingAngle={4} dataKey="value">
                {alertDistribution.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }} />
              <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '12px' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-800">最新预警</h3>
          <Link to="/admin/alerts" className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1">
            查看全部 <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="divide-y divide-slate-100">
          {alertRecords.slice(0, 4).map((alert) => (
            <div key={alert.id} className="flex items-center justify-between px-5 py-3.5">
              <div className="flex items-center gap-4">
                <AdminAlertBadge level={alert.level} />
                <div>
                  <p className="text-sm font-medium text-slate-800">{alert.name}</p>
                  <p className="text-xs text-slate-400">{alert.trigger}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400">{alert.createdAt}</p>
                <p className="text-xs text-slate-500 mt-0.5">{alert.assignee}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
