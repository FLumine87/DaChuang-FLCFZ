import { useState, useEffect, useMemo } from 'react';
import {
  ChevronDown, ChevronRight, Clock, Filter, ShieldAlert,
} from 'lucide-react';
import { type WarningEvent } from '../data/mockData';
import { getWarnings, updateWarningStatus } from '../services/mockApi';
import AlertBadge from '../components/AlertBadge';
import StatusBadge from '../components/StatusBadge';
import { MasterDetail, DetailPanel } from '../components/MasterDetail';

/**
 * 个人端 · 预警中心
 *
 * 评审问题 5：「不点案例的话没人知道右边可以显示文字」。
 * 根因不是“缺空态”，而是空态被网格拉高、垂直居中到了首屏之外，右侧看着就是一整块空白。
 * 现在按邮箱/工单类界面的通行做法处理：
 *   · 首屏默认选中当前筛选下的第一条（筛选变化时同步修正选中项）；
 *   · 右侧详情栏粘顶、限高内滚，列表再长也不会“点完看不到”；
 *   · 未选中（比如用户主动关掉详情、或筛选后没有数据）时，空态贴顶显示，
 *     并明确写出「左侧每一条都能点开」。
 */
export default function Alerts() {
  const [filterLevel, setFilterLevel] = useState<'all' | 'red' | 'orange' | 'yellow' | 'green'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'new' | 'tracking' | 'resolved'>('all');
  const [selectedAlert, setSelectedAlert] = useState<string | null>(null);
  const [warningEvents, setWarningEvents] = useState<WarningEvent[]>([]);
  const [statusNotice, setStatusNotice] = useState<{ kind: 'busy' | 'ok' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await getWarnings();
        setWarningEvents(data);
      } catch (e) {
        console.error('加载预警失败', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(
    () =>
      warningEvents.filter((a) => {
        const matchLevel = filterLevel === 'all' || a.level === filterLevel;
        const matchStatus = filterStatus === 'all' || a.status === filterStatus;
        return matchLevel && matchStatus;
      }),
    [warningEvents, filterLevel, filterStatus],
  );

  /* 默认选中第一条：右侧首屏就有内容，“点卡片 → 右侧变化”这层关系才看得见。
     筛选后如果当前选中的已经不在列表里，就顺延到新列表的第一条。 */
  useEffect(() => {
    if (loading) return;
    if (filtered.length === 0) {
      if (selectedAlert) setSelectedAlert(null);
      return;
    }
    if (!filtered.some((a) => a.id === selectedAlert)) {
      setSelectedAlert(filtered[0].id);
    }
  }, [loading, filtered, selectedAlert]);

  const selected = warningEvents.find((a) => a.id === selectedAlert);

  /**
   * 标记预警状态。先做乐观更新让界面立刻响应，失败则回滚并明确播报
   * （静默回滚会让用户以为成功了，是最坏的结果）。
   */
  const handleStatusChange = async (next: 'tracking' | 'resolved') => {
    if (!selected) return;
    const prev = selected;
    setStatusNotice({ kind: 'busy', text: '正在同步…' });
    setWarningEvents((list) =>
      list.map((a) =>
        a.id === prev.id
          ? { ...a, status: next, updatedAt: new Date().toLocaleString('sv-SE').slice(0, 16) }
          : a
      )
    );
    try {
      await updateWarningStatus(prev.id, next);
      setStatusNotice({ kind: 'ok', text: next === 'tracking' ? '已标记为跟踪中' : '已标记为已缓解' });
    } catch (e) {
      setWarningEvents((list) => list.map((a) => (a.id === prev.id ? prev : a)));
      setStatusNotice({ kind: 'error', text: `同步失败，已回滚：${(e as Error).message}` });
    }
  };

  const stats = [
    { label: '新触发', count: warningEvents.filter((a) => a.status === 'new').length, tone: 'text-danger-600' },
    { label: '跟踪中', count: warningEvents.filter((a) => a.status === 'tracking').length, tone: 'text-primary-600' },
    { label: '已缓解', count: warningEvents.filter((a) => a.status === 'resolved').length, tone: 'text-success-600' },
    { label: '高风险', count: warningEvents.filter((a) => a.level === 'red').length, tone: 'text-orange-600' },
  ];

  const filterSelect = 'cursor-pointer appearance-none rounded-lg border border-slate-200 bg-white py-2 pr-8 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-500';

  return (
    <div className="space-y-5">
      {/* 统计：原来的四张卡各占一行高度，把下面的“列表 + 详情”挤到首屏之外；
          改成同一张卡里四格，省下约 70px，也是这里最要紧的纵向空间。 */}
      <div className="ui-card grid grid-cols-2 divide-slate-100 p-0 sm:grid-cols-4 sm:divide-x">
        {stats.map((item) => (
          <div key={item.label} className="px-5 py-4">
            <p className="text-sm text-slate-500">{item.label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${item.tone}`}>{item.count}</p>
          </div>
        ))}
      </div>

      {/* 筛选 + 结果计数 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <select
            aria-label="按等级筛选"
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value as 'all' | 'red' | 'orange' | 'yellow' | 'green')}
            className={`${filterSelect} pl-9`}
          >
            <option value="all">全部等级</option>
            <option value="red">危险</option>
            <option value="orange">警告</option>
            <option value="yellow">关注</option>
            <option value="green">稳定</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>
        <div className="relative">
          <select
            aria-label="按状态筛选"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as 'all' | 'new' | 'tracking' | 'resolved')}
            className={`${filterSelect} pl-3.5`}
          >
            <option value="all">全部状态</option>
            <option value="new">新触发</option>
            <option value="tracking">跟踪中</option>
            <option value="resolved">已缓解</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>
        <span className="ml-auto text-xs text-slate-400">
          共 {filtered.length} 条
          {filtered.length > 0 && filtered.length !== warningEvents.length
            ? `（全部 ${warningEvents.length} 条）`
            : ''}
        </span>
      </div>

      <MasterDetail
        width="md"
        list={
          <div className="space-y-3">
            {loading && (
              <div className="space-y-3" role="status" aria-label="正在加载预警">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-[116px] animate-pulse rounded-2xl border border-slate-200 bg-white" />
                ))}
              </div>
            )}
            {!loading &&
              filtered.map((alert) => {
                const isSelected = selectedAlert === alert.id;
                return (
                  <button
                    type="button"
                    key={alert.id}
                    onClick={() => {
                      setSelectedAlert(alert.id);
                      setStatusNotice(null);
                    }}
                    aria-pressed={isSelected}
                    className={`group w-full cursor-pointer rounded-2xl border bg-white p-4 text-left shadow-sm transition ${
                      isSelected
                        ? 'border-primary-500 ring-1 ring-primary-200'
                        : 'border-slate-200 hover:border-primary-300 hover:shadow'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <AlertBadge level={alert.level} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-800">{alert.title}</p>
                          <p className="mt-0.5 text-xs text-slate-400">{alert.id}</p>
                        </div>
                      </div>
                      <StatusBadge status={alert.status} />
                    </div>
                    <p className="mt-2.5 line-clamp-2 text-sm leading-6 text-slate-600">{alert.reason}</p>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1 text-slate-400">
                        <Clock className="h-3 w-3" /> {alert.createdAt}
                      </span>
                      {/* 明确写出“可以点开” —— 评审说不知道右边会有内容，问题就出在这 */}
                      <span className="inline-flex items-center gap-0.5 font-medium text-primary-600">
                        {isSelected ? '正在查看' : '查看详情'}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  </button>
                );
              })}
            {!loading && filtered.length === 0 && (
              <div className="ui-card px-6 py-12 text-center">
                <ShieldAlert className="mx-auto h-8 w-8 text-slate-200" />
                <p className="mt-3 text-sm font-medium text-slate-600">
                  {warningEvents.length === 0 ? '还没有预警记录' : '当前筛选条件下没有预警'}
                </p>
                <p className="mx-auto mt-1.5 max-w-[300px] text-xs leading-5 text-slate-400">
                  {warningEvents.length === 0
                    ? '系统检测到“情绪持续下行、压力过载或睡眠显著下降”时，会在这里推送分级预警与建议。'
                    : '试试把「等级」或「状态」改成全部。'}
                </p>
              </div>
            )}
          </div>
        }
        detail={
          <DetailPanel
            selectionKey={selectedAlert}
            title={selected?.title}
            subtitle={selected ? `${selected.id} · ${selected.createdAt}` : undefined}
            meta={selected ? <AlertBadge level={selected.level} /> : undefined}
            onClose={() => {
              setSelectedAlert(null);
              setStatusNotice(null);
            }}
            emptyIcon={<ShieldAlert className="h-6 w-6" />}
            emptyTitle={warningEvents.length === 0 ? '暂时没有预警' : '选择一条预警查看详情'}
            emptyDescription={
              warningEvents.length === 0
                ? '出现需要关注的信号时，这里会显示触发原因、建议动作，并支持标记为跟踪中或已缓解。'
                : '左侧每一条都能点开：查看触发原因与建议动作，并标记为跟踪中或已缓解。'
            }
          >
            {selected && (
              <div className="space-y-4">
                <div className="rounded-xl bg-slate-50 p-3.5">
                  <p className="text-xs text-slate-400">触发原因</p>
                  <p className="mt-1 text-sm leading-6 text-slate-700">{selected.reason}</p>
                </div>

                <dl className="space-y-2.5 text-sm">
                  {[
                    ['预警编号', selected.id],
                    ['创建时间', selected.createdAt],
                    ['更新时间', selected.updatedAt],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-4">
                      <dt className="text-slate-400">{label}</dt>
                      <dd className="font-medium text-slate-700">{value}</dd>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-slate-400">状态</dt>
                    <dd><StatusBadge status={selected.status} /></dd>
                  </div>
                </dl>

                <div className="border-t border-slate-100 pt-3.5">
                  <p className="text-xs text-slate-400">建议动作</p>
                  <p className="mt-1 text-sm leading-6 text-slate-700">{selected.suggestion}</p>
                </div>

                <div className="flex gap-2">
                  {selected.status === 'new' && (
                    <button
                      onClick={() => handleStatusChange('tracking')}
                      disabled={statusNotice?.kind === 'busy'}
                      className="flex-1 cursor-pointer rounded-lg bg-primary-500 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      标记为跟踪中
                    </button>
                  )}
                  {selected.status === 'tracking' && (
                    <button
                      onClick={() => handleStatusChange('resolved')}
                      disabled={statusNotice?.kind === 'busy'}
                      className="flex-1 cursor-pointer rounded-lg bg-success-600 py-2 text-sm font-medium text-white transition-colors hover:bg-success-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      标记为已缓解
                    </button>
                  )}
                  {selected.status === 'resolved' && (
                    <p className="w-full rounded-lg bg-success-50 px-3 py-2 text-xs leading-5 text-success-600">
                      这条预警已缓解。如仍有不适，可以回到「心理筛查」重新做一次记录。
                    </p>
                  )}
                </div>

                {statusNotice && (
                  <p
                    className={`text-xs ${
                      statusNotice.kind === 'error'
                        ? 'text-danger-600'
                        : statusNotice.kind === 'ok'
                          ? 'text-success-600'
                          : 'text-slate-500'
                    }`}
                    role="status"
                  >
                    {statusNotice.text}
                  </p>
                )}
              </div>
            )}
          </DetailPanel>
        }
      />
    </div>
  );
}
