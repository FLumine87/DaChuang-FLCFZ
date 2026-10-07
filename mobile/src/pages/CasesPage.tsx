import { useEffect, useState } from 'react';
import { CalendarDays, ClipboardList, User } from 'lucide-react';
import { getCases } from '@shared/services/mockApi';
import type {
  PersonalScreeningRecord,
  PersonalTimelineEvent,
  UserProfile,
  WarningEvent,
} from '@shared/data/mockData';
import AlertBadge from '@shared/components/AlertBadge';
import { Banner, Card, EmptyState, SectionTitle, Spinner } from '../components/ui';

interface CaseBundle {
  screeningRecords: PersonalScreeningRecord[];
  warningEvents: WarningEvent[];
  userProfile: UserProfile;
  personalTimeline: PersonalTimelineEvent[];
}

const TYPE_TEXT: Record<string, string> = {
  screening: '筛查',
  warning: '预警',
  collection: '采集',
  plan: '计划',
};

export default function CasesPage() {
  const [data, setData] = useState<CaseBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    getCases()
      .then((res) => alive && setData(res as CaseBundle))
      .catch((e) => alive && setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <Spinner label="正在加载档案…" />;
  if (error) return <Banner kind="error">加载失败：{error}</Banner>;
  if (!data) return <EmptyState title="暂无档案数据" />;

  const p = data.userProfile;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
            <User className="w-6 h-6 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <p className="text-[16px] font-semibold text-slate-800">{p?.name ?? '—'}</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {[p?.gender, p?.age ? `${p.age} 岁` : '', p?.stage].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-4 pt-4 border-t border-slate-100">
          {[
            ['校区', p?.campus],
            ['专业', p?.major],
            ['紧急联系人', p?.emergencyContact],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0">
              <p className="text-[11px] text-slate-400">{k}</p>
              <p className="text-[13px] text-slate-700 truncate">{v || '—'}</p>
            </div>
          ))}
        </div>
      </Card>

      <div>
        <SectionTitle title="筛查记录" />
        <Card className="divide-y divide-slate-100">
          {data.screeningRecords.length === 0 ? (
            <EmptyState title="暂无筛查记录" />
          ) : (
            data.screeningRecords.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                <ClipboardList className="w-4 h-4 text-slate-300 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] text-slate-800 truncate">{r.questionnaire}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {r.date} · {r.moodTag}
                  </p>
                </div>
                <span className="text-[13px] font-semibold text-slate-700 shrink-0">
                  {r.score}
                  <span className="text-[11px] text-slate-300">/{r.maxScore}</span>
                </span>
                <AlertBadge level={r.level} size="sm" />
              </div>
            ))
          )}
        </Card>
      </div>

      <div>
        <SectionTitle title="时间线" />
        <Card className="p-4">
          {data.personalTimeline.length === 0 ? (
            <EmptyState title="暂无事件" />
          ) : (
            <ol className="relative border-l border-slate-200 ml-2 space-y-4">
              {data.personalTimeline.map((e, i) => (
                <li key={`${e.date}-${i}`} className="ml-4">
                  <span className="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <div className="flex items-center gap-2">
                    <CalendarDays className="w-3.5 h-3.5 text-slate-300" />
                    <span className="text-[11px] text-slate-400">{e.date}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                      {TYPE_TEXT[e.type] ?? e.type}
                    </span>
                  </div>
                  <p className="text-[14px] text-slate-800 mt-1">{e.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-5">{e.detail}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
