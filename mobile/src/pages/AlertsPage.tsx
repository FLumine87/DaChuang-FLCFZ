import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { getWarnings } from '@shared/services/mockApi';
import type { WarningEvent } from '@shared/data/mockData';
import AlertBadge from '@shared/components/AlertBadge';
import { Banner, Card, Chip, EmptyState, Spinner } from '../components/ui';

const LEVELS = [
  { value: 'all', label: '全部' },
  { value: 'red', label: '危险' },
  { value: 'orange', label: '警告' },
  { value: 'yellow', label: '关注' },
  { value: 'green', label: '稳定' },
] as const;

const STATUS_TEXT: Record<string, string> = {
  new: '待处理',
  tracking: '跟踪中',
  resolved: '已解决',
};

export default function AlertsPage() {
  const [list, setList] = useState<WarningEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [level, setLevel] = useState<(typeof LEVELS)[number]['value']>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getWarnings()
      .then((res) => alive && setList(res))
      .catch((e) => alive && setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <Spinner label="正在加载预警…" />;
  if (error) return <Banner kind="error">加载失败：{error}</Banner>;

  const filtered = level === 'all' ? list : list.filter((w) => w.level === level);

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-1 px-1 pb-0.5">
        {LEVELS.map((l) => (
          <Chip key={l.value} active={level === l.value} onClick={() => setLevel(l.value)}>
            {l.label}
            {l.value === 'all' ? ` (${list.length})` : ''}
          </Chip>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<AlertTriangle className="w-10 h-10" />}
            title="当前没有这一类预警"
            hint="保持规律作息，情绪波动时及时倾诉"
          />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((w) => {
            const open = openId === w.id;
            return (
              <Card key={w.id} className="overflow-hidden">
                <button
                  onClick={() => setOpenId(open ? null : w.id)}
                  className="w-full text-left p-4 active:bg-slate-50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[15px] font-medium text-slate-800">{w.title}</span>
                        <AlertBadge level={w.level} size="sm" />
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                          {STATUS_TEXT[w.status] ?? w.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">{w.createdAt}</p>
                    </div>
                    {open ? (
                      <ChevronUp className="w-4 h-4 text-slate-300 shrink-0 mt-1" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-300 shrink-0 mt-1" />
                    )}
                  </div>
                </button>
                {open && (
                  <div className="px-4 pb-4 space-y-2.5 border-t border-slate-100 pt-3">
                    <div>
                      <p className="text-[11px] text-slate-400 mb-1">触发原因</p>
                      <p className="text-[13px] text-slate-600 leading-6">{w.reason}</p>
                    </div>
                    <div className="rounded-xl bg-emerald-50 p-3">
                      <p className="text-[11px] text-emerald-600 mb-1">建议措施</p>
                      <p className="text-[13px] text-emerald-800 leading-6">{w.suggestion}</p>
                    </div>
                    {w.updatedAt && (
                      <p className="text-[11px] text-slate-400">最近更新：{w.updatedAt}</p>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
