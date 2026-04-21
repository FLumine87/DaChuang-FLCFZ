import { useState, useEffect } from 'react';
import {
  ClipboardCheck,
  AlertTriangle,
  Activity,
  Moon,
  Sparkles,
  Plus,
  ArrowRight,
  Loader2,
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
import { getDashboardData } from '../services/mockApi';
import AlertBadge from '../components/AlertBadge';
import StatusBadge from '../components/StatusBadge';
import type { MoodTrendPoint, WarningEvent, PersonalScreeningRecord, UserProfile } from '../data/mockData';

interface DashboardData {
  moodTrend: MoodTrendPoint[];
  warningDistribution: { name: string; value: number; color: string }[];
  warningEvents: WarningEvent[];
  actionPlan: { id: string; title: string; duration: string; status: 'new' | 'tracking' | 'resolved' }[];
  screeningRecords: PersonalScreeningRecord[];
  userProfile: UserProfile;
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-3 w-24 bg-slate-200 rounded" />
          <div className="h-7 w-16 bg-slate-200 rounded" />
        </div>
        <div className="w-12 h-12 bg-slate-200 rounded-xl" />
      </div>
      <div className="h-3 w-32 bg-slate-100 rounded mt-3" />
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboardData().then((res) => {
      setData(res as DashboardData);
      setLoading(false);
    });
  }, []);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-sm flex items-center justify-center gap-3 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">正在加载仪表盘数据...</span>
        </div>
      </div>
    );
  }

  const { moodTrend, warningDistribution, warningEvents, actionPlan, screeningRecords, userProfile } = data;

  const activeWarnings = warningEvents.filter((w) => w.status !== 'resolved').length;
  const latestSleep = moodTrend[moodTrend.length - 1]?.sleep ?? 0;
  const lastRecord = screeningRecords.find((r) => r.status === 'completed');

  const stats = [
    { label: '连续打卡', value: '12 天', icon: ClipboardCheck, color: 'bg-success-50 text-success-600', hint: '较上周 +3 天' },
    { label: '最近一次筛查', value: lastRecord ? `${lastRecord.questionnaire} ${lastRecord.score}分` : '暂无', icon: Activity, color: 'bg-warning-50 text-warning-600', hint: lastRecord ? lastRecord.moodTag : '' },
    { label: '活跃预警', value: `${activeWarnings} 条`, icon: AlertTriangle, color: 'bg-danger-50 text-danger-600', hint: activeWarnings > 0 ? '需优先处理红色预警' : '暂无活跃预警' },
    { label: '最近睡眠均值', value: `${latestSleep} 小时`, icon: Moon, color: 'bg-primary-50 text-primary-600', hint: '建议提升至 6.5h+' },
  ];

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
              <p className="text-xs text-slate-400 mt-3">{stat.hint}</p>
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-800">欢迎回来，{userProfile.name}</h3>
            <p className="text-sm text-slate-500 mt-1">
              {userProfile.stage} · {userProfile.major} · {userProfile.campus}
            </p>
            <p className="text-xs text-slate-400 mt-2">
              当前重点：先稳定睡眠，再降低学习压力峰值，最后恢复社交节奏。
            </p>
          </div>
          <Link
            to="/personal/retrieval"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
          >
            <Sparkles className="w-4 h-4" /> 查看最新 RAG 建议
          </Link>
        </div>
      </div>

      <div className="flex gap-3">
        <Link
          to="/personal/screening"
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> 开始今日筛查
        </Link>
        <Link
          to="/personal/alerts"
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium"
        >
          <AlertTriangle className="w-4 h-4" /> 查看我的预警
        </Link>
        <Link
          to="/personal/retrieval"
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium"
        >
          <Sparkles className="w-4 h-4" /> 生成建议报告
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-800 mb-4">最近 10 天情绪与压力趋势</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={moodTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" />
              <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }} />
              <Line type="monotone" dataKey="mood" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="情绪指数" />
              <Line type="monotone" dataKey="stress" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} name="压力指数" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-800 mb-4">历史风险分布</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={warningDistribution} cx="50%" cy="45%" innerRadius={55} outerRadius={85} paddingAngle={4} dataKey="value">
                {warningDistribution.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }} />
              <Legend verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '12px' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="p-5 border-b border-slate-100">
            <h3 className="text-base font-semibold text-slate-800">今日行动计划</h3>
          </div>
          <div className="p-5 space-y-3">
            {actionPlan.map((plan) => (
              <div key={plan.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-50">
                <div>
                  <p className="text-sm font-medium text-slate-800">{plan.title}</p>
                  <p className="text-xs text-slate-400 mt-1">建议时长：{plan.duration}</p>
                </div>
                <StatusBadge status={plan.status} />
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="p-5 border-b border-slate-100">
            <h3 className="text-base font-semibold text-slate-800">最近筛查记录</h3>
          </div>
          <div className="p-5 space-y-3">
            {screeningRecords.slice(0, 3).map((item) => (
              <div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-50">
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {item.questionnaire}：{item.score}/{item.maxScore}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">{item.date} · {item.moodTag}</p>
                </div>
                <AlertBadge level={item.level} size="sm" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-800">最新预警提醒</h3>
          <Link to="/personal/alerts" className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1">
            查看全部 <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="divide-y divide-slate-100">
          {warningEvents.map((alert) => (
            <div key={alert.id} className="flex items-center justify-between px-5 py-3.5">
              <div className="flex items-center gap-4">
                <AlertBadge level={alert.level} />
                <div>
                  <p className="text-sm font-medium text-slate-800">{alert.title}</p>
                  <p className="text-xs text-slate-400">{alert.reason}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400">{alert.createdAt}</p>
                <p className="text-xs text-slate-500 mt-0.5">{alert.status}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
