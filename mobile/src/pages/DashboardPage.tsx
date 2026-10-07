import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ChevronRight, ClipboardList, Sparkles } from 'lucide-react';
import { getDashboardData, type DashboardResponse } from '@shared/services/mockApi';
import { getCurrentSession } from '@shared/auth/session';
import AlertBadge from '@shared/components/AlertBadge';
import { Banner, Card, EmptyState, SectionTitle, Spinner } from '../components/ui';
import { getMode } from '../platform/mode';

const LEVEL_TEXT: Record<string, string> = {
  green: '状态稳定',
  yellow: '需要关注',
  orange: '建议干预',
  red: '请尽快联系咨询师',
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const session = getCurrentSession();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getDashboardData()
      .then((res) => alive && setData(res))
      .catch((e) => alive && setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <Spinner label="正在加载个人首页…" />;
  if (error) return <Banner kind="error">加载失败：{error}</Banner>;
  if (!data) return <EmptyState title="暂无数据" />;

  const latest = data.screeningRecords?.[0];
  const pendingWarnings = (data.warningEvents ?? []).filter((w) => w.status !== 'resolved');
  const trend = data.moodTrend ?? [];
  const last = trend[trend.length - 1];

  const hour = new Date().getHours();
  const greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';

  return (
    <div className="space-y-4">
      {/* 问候 + 状态 */}
      <Card className="p-4 bg-gradient-to-br from-emerald-50 to-white">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] text-slate-500">
              {greeting}，{session?.username ?? data.userProfile?.name ?? '同学'}
            </p>
            <p className="text-lg font-semibold text-slate-800 mt-0.5 truncate">
              {LEVEL_TEXT[latest?.level ?? 'green']}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">
              {getMode() === 'mock' ? '离线演示数据' : '实机数据'}
              {latest ? ` · 最近筛查 ${latest.date}` : ''}
            </p>
          </div>
          {latest && <AlertBadge level={latest.level} size="sm" />}
        </div>
      </Card>

      {/* 预警提示 */}
      {pendingWarnings.length > 0 && (
        <Card className="p-3.5 border-l-4 border-l-orange-400" onClick={() => navigate('/app/alerts')}>
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[14px] text-slate-800 font-medium">
                {pendingWarnings.length} 条预警待处理
              </p>
              <p className="text-xs text-slate-400 mt-0.5 truncate">{pendingWarnings[0].title}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
          </div>
        </Card>
      )}

      {/* 关键指标 */}
      <div className="grid grid-cols-3 gap-2.5">
        {[
          { label: '情绪指数', value: last?.mood ?? '—', unit: '/5', color: 'text-emerald-600' },
          { label: '压力水平', value: last?.stress ?? '—', unit: '/5', color: 'text-orange-500' },
          { label: '睡眠质量', value: last?.sleep ?? '—', unit: '/5', color: 'text-primary-600' },
        ].map((m) => (
          <Card key={m.label} className="p-3 text-center">
            <p className="text-[11px] text-slate-400">{m.label}</p>
            <p className={`text-xl font-bold mt-1 ${m.color}`}>
              {m.value}
              <span className="text-[11px] font-normal text-slate-300 ml-0.5">{m.unit}</span>
            </p>
          </Card>
        ))}
      </div>

      {/* 趋势 */}
      <div>
        <SectionTitle title="近 7 天心理趋势" />
        <Card className="p-3 pt-4">
          <div style={{ width: '100%', height: 170 }}>
            <ResponsiveContainer>
              <AreaChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
                <defs>
                  <linearGradient id="moodFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 5]} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #e2e8f0' }}
                  labelStyle={{ color: '#64748b' }}
                />
                <Area type="monotone" dataKey="mood" name="情绪" stroke="#10b981" strokeWidth={2} fill="url(#moodFill)" />
                <Area type="monotone" dataKey="stress" name="压力" stroke="#f97316" strokeWidth={1.6} fillOpacity={0} />
                <Area type="monotone" dataKey="sleep" name="睡眠" stroke="#3b82f6" strokeWidth={1.6} fillOpacity={0} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* 行动计划 */}
      {(data.actionPlan ?? []).length > 0 && (
        <div>
          <SectionTitle title="我的行动计划" />
          <Card className="divide-y divide-slate-100">
            {data.actionPlan.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] text-slate-800 truncate">{p.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{p.duration}</p>
                </div>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${
                    p.status === 'resolved'
                      ? 'bg-success-50 text-success-600'
                      : p.status === 'tracking'
                        ? 'bg-primary-50 text-primary-600'
                        : 'bg-warning-50 text-warning-600'
                  }`}
                >
                  {p.status === 'resolved' ? '已完成' : p.status === 'tracking' ? '进行中' : '待开始'}
                </span>
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* 最近筛查 */}
      <div>
        <SectionTitle
          title="最近筛查记录"
          action="去筛查"
          onAction={() => navigate('/app/screening')}
        />
        <Card className="divide-y divide-slate-100">
          {(data.screeningRecords ?? []).slice(0, 3).map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center shrink-0">
                <ClipboardList className="w-4 h-4 text-slate-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] text-slate-800 truncate">{r.questionnaire}</p>
                <p className="text-xs text-slate-400 mt-0.5">{r.date}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[13px] font-semibold text-slate-700">
                  {r.score}
                  <span className="text-[11px] text-slate-300">/{r.maxScore}</span>
                </p>
              </div>
              <AlertBadge level={r.level} size="sm" />
            </div>
          ))}
          {(data.screeningRecords ?? []).length === 0 && (
            <EmptyState title="还没有筛查记录" hint="去「筛查」做一份量表吧" />
          )}
        </Card>
      </div>
    </div>
  );
}
