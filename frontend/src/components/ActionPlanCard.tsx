import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { usePageActive } from '../services/pageActivity';
import { CalendarClock, Check, Clock, Loader2, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import {
  completePersonalPlan,
  createPersonalPlan,
  deletePersonalPlan,
  getPersonalPlans,
  restorePersonalPlan,
  type ActionPlanItem,
  type PersonalPlansResponse,
} from '../services/mockApi';

/*
 * 今日行动计划
 * ============
 * 一张卡承担四件事：
 *   1. 系统按条件自动生成的提醒（两周没做量表、一周没记录、有未处置预警……）
 *   2. 用户自己写进去的计划
 *   3. 待进行 / 归档 两个分区：待进行按截止时间升序，归档按完成时间倒序
 *   4. 手动标注完成 → 从待进行消失、进归档
 *
 * 为什么不再显示「新触发 / 跟踪中 / 已缓解」这类状态气泡：
 * 那是**预警**的处置流转状态，搬到行动计划上既重复又误导 —— 一条待办只有
 * 「还没做 / 做完了」两种状态，而"做完了"的归宿就是归档。
 *
 * 数据来自后端 action_plans 表（不是每次现算），所以"完成"能持久化，
 * 刷新后不会又冒出来。
 */

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** 把 `YYYY-MM-DD HH:MM` 解析成 Date；解析失败返回 null */
function parsePlanTime(raw?: string): Date | null {
  if (!raw) return null;
  const s = String(raw).replace('T', ' ').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  const d = new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0,
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 截止时间的人话版本：今天 / 明天 / 已逾期 / X 月 X 日（周几） */
function dueLabel(raw?: string): { text: string; tone: string } {
  const d = parsePlanTime(raw);
  if (!d) return { text: '未设截止', tone: 'text-slate-400' };
  const now = new Date();
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((dd - day0) / 86400000);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  if (diff < 0) {
    return { text: `已逾期 ${-diff} 天（${d.getMonth() + 1}/${d.getDate()} ${hhmm}）`, tone: 'text-danger-600 font-medium' };
  }
  if (diff === 0) return { text: `今天 ${hhmm} 前`, tone: 'text-orange-600 font-medium' };
  if (diff === 1) return { text: `明天 ${hhmm} 前`, tone: 'text-orange-600' };
  return {
    text: `${d.getMonth() + 1} 月 ${d.getDate()} 日（周${WEEKDAYS[d.getDay()]}）${hhmm}`,
    tone: 'text-slate-500',
  };
}

/** 制定时间：只要到分钟 */
function createdLabel(raw?: string): string {
  const d = parsePlanTime(raw);
  if (!d) return '时间未知';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 默认截止：三天后的此时（日期控件只吃 YYYY-MM-DD） */
function defaultDue(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function ActionPlanCard() {
  const pageActive=usePageActive();
  const [plans, setPlans] = useState<PersonalPlansResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [finishing, setFinishing] = useState<{item: ActionPlanItem; height: number} | null>(null);
  const completionLock = useRef(false);
  const loadSequence = useRef(0);
  const [completionNotice, setCompletionNotice] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(defaultDue);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [archiveOpen, setArchiveOpen] = useState(false);
  /** 正在等待二次确认永久删除的那条（null = 没有）。
   *  不用 window.confirm：部分浏览器/环境会拦截原生对话框，confirm() 直接返回
   *  false，表现就是"点了没反应"。改成页面内的确认条，行为确定、样式也统一。 */
  const [confirmPurgeId, setConfirmPurgeId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    const sequence=++loadSequence.current;
    try {
      const data = await getPersonalPlans();
      if(sequence !== loadSequence.current)return;
      setPlans(data);
      setError(null);
    } catch (e) {
      if(sequence !== loadSequence.current)return;
      setError(e instanceof Error ? e.message : '读取计划失败');
    } finally {
      if(sequence === loadSequence.current)setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (pageActive) void reload();
    const updated = () => { if (pageActive) void reload(); };
    window.addEventListener('steward-plans-changed',updated);
    return () => window.removeEventListener('steward-plans-changed',updated);
  }, [reload,pageActive]);

  const archived = plans?.archived ?? [];

  /* 排一次序：有截止的按时间升序在前，没设截止的沉底。
     后端已排过，这里再排一道是防止个别数据 due_at 为空串导致顺序不稳。 */
  const sortedPending = useMemo(() => {
    const pending=plans?.pending ?? [];
    const visible = finishing && !pending.some(p=>p.id===finishing.item.id) ? [...pending,finishing.item] : pending;
    return [...visible].sort((a, b) => {
      const da = parsePlanTime(a.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const db = parsePlanTime(b.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (da !== db) return da - db;
      return a.id - b.id;
    });
  }, [plans,finishing]);

  /*
   * 操作失败时的统一善后。
   *
   * 关键点：**先 reload 再显示错误**。
   * 常见的一种失败是"计划不存在"（后端 404）—— 说明本地这份列表已经过期了
   * （比如同一账号在另一个标签页删过、或数据被重置）。此时如果只弹一句错误、
   * 列表原样不动，用户会反复点同一个不存在的条目，怎么点都没反应。
   * 重新拉一次列表，过期的条目就自己消失了，界面回到服务端真相。
   */
  const settleFailure = async (e: unknown, fallback: string) => {
    const msg = e instanceof Error ? e.message : fallback;
    setConfirmPurgeId(null);
    try {
      await reload();           // reload 成功会把 error 清空
    } catch {
      /* reload 自己的错误已经在 reload 里处理了 */
    }
    setError(
      msg.includes('不存在')
        ? '这条计划已经不存在了（可能在别处被删除或数据已重置），列表已刷新'
        : msg,
    );
  };

  const handleComplete = async (item: ActionPlanItem, input: HTMLInputElement) => {
    if (busyId !== null || completionLock.current) return;
    completionLock.current=true;
    const height=input.closest('li')?.getBoundingClientRect().height ?? 160;
    setBusyId(item.id);
    setError(null);
    try {
      const completed=await completePersonalPlan(item.id);
      loadSequence.current++;
      setFinishing({item,height});
      setPlans(previous=>previous ? {...previous,pending:previous.pending.filter(p=>p.id!==item.id),archived:[{...item,...completed,status:'done',completedAt:completed?.completedAt || new Date().toISOString()},...previous.archived.filter(p=>p.id!==item.id)]} : previous);
      setCompletionNotice(`已完成：${item.title}`);
      await new Promise(resolve=>setTimeout(resolve,window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 120 : 1150));
      await reload();
    } catch (e) {
      await settleFailure(e, '完成状态未保存，请重试');
    } finally {
      setFinishing(null);
      completionLock.current=false;
      setBusyId(null);
    }
  };

  const handleDelete = async (item: ActionPlanItem) => {
    if (busyId !== null) return;
    setBusyId(item.id);
    setError(null);
    try {
      await deletePersonalPlan(item.id);
      await reload();
    } catch (e) {
      await settleFailure(e, '删除失败');
    } finally {
      setBusyId(null);
    }
  };

  /** 归档 → 退回待进行（点错了"完成"的后悔药） */
  const handleRestore = async (item: ActionPlanItem) => {
    if (busyId !== null) return;
    setBusyId(item.id);
    setError(null);
    try {
      await restorePersonalPlan(item.id);
      await reload();
    } catch (e) {
      await settleFailure(e, '回归失败');
    } finally {
      setBusyId(null);
    }
  };

  /** 归档 → 永久删除（不可恢复）。先记下 id，页面上出现确认条，点"确定删除"才真删。 */
  const handlePurge = async (item: ActionPlanItem) => {
    if (busyId !== null) return;
    setBusyId(item.id);
    setError(null);
    try {
      await deletePersonalPlan(item.id);
      setConfirmPurgeId(null);
      await reload();
    } catch (e) {
      await settleFailure(e, '永久删除失败');
    } finally {
      setBusyId(null);
    }
  };

  const handleCreate = async () => {
    const t = title.trim();
    if (!t) {
      setFormError('写一句要做的事');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await createPersonalPlan({ title: t, dueAt: due || undefined });
      setTitle('');
      setDue(defaultDue());
      setFormOpen(false);
      await reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '添加计划失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="ui-card p-4 sm:p-5">
      <p className="sr-only" role="status" aria-live="polite">{completionNotice}</p>
      {/* 头部：只有标题与一句说明。
          「计划制定时间」不放这里 —— 它是**每条计划各自的属性**，
          统一挂在卡片右上角会让人误以为是整张卡的刷新时间。
          每条条目的右上角单独显示它自己的制定时刻（精确到分）。 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold text-slate-900">今日行动计划</h2>
          <p className="mt-1 text-[13px] text-slate-500">
            按截止时间排，做完一件就少一件
          </p>
        </div>
        <span className="shrink-0 text-[12.5px] tabular-nums text-slate-400">
          待进行 {sortedPending.length - (finishing ? 1 : 0)} 项
        </span>
      </div>

      {/* 自己写计划：按钮 ↔ 表单 */}
      <div className="mt-4">
        {formOpen ? (
          <div className="rounded-xl border border-primary-200 bg-primary-50/50 p-3">
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate();
                if (e.key === 'Escape') setFormOpen(false);
              }}
              maxLength={200}
              placeholder="要做的这件事，一句话写清楚"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13.5px] text-slate-700 outline-none focus:border-primary-400"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[12.5px] text-slate-500">
                <CalendarClock className="h-3.5 w-3.5" />
                截止
              </label>
              <input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12.5px] text-slate-600 outline-none focus:border-primary-400"
              />
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setFormOpen(false); setFormError(null); }}
                  className="rounded-lg px-2.5 py-1.5 text-[12.5px] text-slate-500 hover:bg-white"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={saving}
                  className="rounded-lg bg-primary-500 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-primary-600 disabled:opacity-60"
                >
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
            {formError && <p className="mt-2 text-[12px] text-danger-600">{formError}</p>}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[12.5px] font-medium text-slate-600 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-600"
          >
            <Plus className="h-3.5 w-3.5" />
            制定计划
          </button>
        )}
      </div>

      <hr className="my-4 border-slate-100" />

      {/* ---------- 待进行 ---------- */}
      {loading && (
        <p className="py-6 text-center text-[13px] text-slate-400">正在读取计划…</p>
      )}

      {!loading && error && (
        <p className="rounded-lg bg-danger-50 px-3 py-2 text-[12.5px] text-danger-700">{error}</p>
      )}

      {!loading && !error && sortedPending.length === 0 && (
        <div className="plan-empty-state py-6 text-center">
          <p className="text-[13px] text-slate-500">待进行的计划都做完了。</p>
          <p className="mt-1 text-[12px] text-slate-400">
            有新该做的事时会自动出现在这里，也可以自己写一条。
          </p>
        </div>
      )}

      {!loading && sortedPending.length > 0 && (
        <ul className="grid gap-2.5">
          {sortedPending.map((plan) => {
            const d = dueLabel(plan.dueAt);
            const busy = busyId === plan.id;
            const done = finishing?.item.id === plan.id;
            return (
              <li
                key={plan.id}
                className={`group relative flex min-w-0 items-start gap-2.5 rounded-xl border border-slate-100 p-3 transition-colors hover:border-slate-200 ${done ? 'plan-task-completing' : ''}`}
                style={done ? {'--plan-row-height':`${finishing.height}px`} as CSSProperties : undefined}
              >
                <label className="relative -ml-1 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center">
                  <input type="checkbox" aria-label={`完成计划：${plan.title}`} aria-busy={busy && !done} checked={done} disabled={busyId !== null} onChange={e=>{if(e.target.checked) void handleComplete(plan,e.currentTarget);}} className="peer h-5 w-5 cursor-pointer appearance-none rounded-md border-2 border-slate-300 bg-white transition-colors checked:border-primary-500 checked:bg-primary-500 hover:border-primary-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-200 disabled:cursor-wait" />
                  {done && <Check aria-hidden="true" className="pointer-events-none absolute h-3.5 w-3.5 text-white" strokeWidth={3} />}
                  {busy && !done && <Loader2 aria-hidden="true" className="pointer-events-none absolute h-3.5 w-3.5 animate-spin text-primary-500" />}
                  {done && <span className="plan-confetti" aria-hidden="true" data-plan-celebration>{Array.from({length:22},(_,i)=>{
                    const angle=(i/22)*Math.PI*2;
                    return <i key={i} className="plan-confetti-piece" style={{'--confetti-x':`${Math.cos(angle)*(55+(i%4)*17)}px`,'--confetti-y':`${Math.sin(angle)*65-35}px`,'--confetti-spin':`${(i%2?1:-1)*(180+i*31)}deg`,'--confetti-color':['#6366f1','#f59e0b','#ec4899','#14b8a6','#8b5cf6'][i%5],animationDelay:`${(i%4)*20}ms`} as CSSProperties} />;
                  })}</span>}
                </label>
                <div className="min-w-0 flex-1">
                  {/* 标题行：左边是计划内容，右上角挂这条计划**自己的**制定时刻。
                      每条各自标注，不用卡片级别的统一时间 —— 那样看不出哪条是先加的。 */}
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 break-words text-[13.5px] font-medium leading-6 text-slate-700">
                      <span className="plan-task-title">{plan.title}</span>
                    </p>
                    <span
                      className="shrink-0 whitespace-nowrap pt-0.5 text-[10.5px] tabular-nums leading-5 text-slate-400"
                      title={`计划制定于 ${createdLabel(plan.createdAt)}`}
                    >
                      {createdLabel(plan.createdAt)}
                    </span>
                  </div>
                  {plan.detail && (
                    <p className="mt-0.5 break-words text-[12px] leading-5 text-slate-400">
                      {plan.detail}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
                    <span className={`inline-flex items-center gap-1 ${d.tone}`}>
                      <Clock className="h-3 w-3" />
                      截止 {d.text}
                    </span>
                    {plan.source === 'auto' && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">
                        系统提醒
                      </span>
                    )}
                  </div>
                </div>

                {/* 完成由左侧复选框操作，右侧只保留删除。 */}
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {plan.source === 'user' && (
                    <button
                      type="button"
                      onClick={() => void handleDelete(plan)}
                      disabled={busyId !== null}
                      title="删除这条计划"
                      aria-label={`删除计划：${plan.title}`}
                      className="inline-flex items-center gap-0.5 whitespace-nowrap px-1 text-[11px] text-slate-300 opacity-0 transition-opacity hover:text-danger-600 group-hover:opacity-100 focus:opacity-100 disabled:opacity-40"
                    >
                      <Trash2 className="h-3 w-3" />
                      删除
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ---------- 归档入口：浅灰色四个字，点开看历史 ---------- */}
      <div className="mt-4 border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={() => setArchiveOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-400 transition-colors hover:text-slate-600"
          aria-expanded={archiveOpen}
        >
          已完成计划
          {archived.length > 0 && <span className="tabular-nums">({archived.length})</span>}
          <X
            className={`h-3 w-3 transition-transform ${archiveOpen ? 'rotate-0' : 'rotate-45'}`}
            aria-hidden="true"
          />
        </button>

        {archiveOpen && (
          <div className="mt-2.5">
            {archived.length === 0 ? (
              <p className="py-3 text-center text-[12px] text-slate-400">
                还没有已完成的计划。
              </p>
            ) : (
              <ul className="grid gap-2">
                {archived.map((plan) => {
                  const busy = busyId === plan.id;
                  return (
                    <li key={plan.id} className="rounded-lg bg-slate-50 px-3 py-2">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-success-600" strokeWidth={3} />
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-[12.5px] leading-5 text-slate-500 line-through decoration-slate-300">
                            {plan.title}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-400">
                            制定于 {createdLabel(plan.createdAt)}
                            {` · 完成于 ${createdLabel(plan.completedAt)}`}
                            {plan.dueAt && ` · 原定截止 ${createdLabel(plan.dueAt)}`}
                          </p>
                        </div>
                      </div>

                      {/* 归档的两个出口：
                          回归 —— 标错了/想再做一轮，退回待进行（状态改回 pending）；
                          永久删除 —— 真不要了。点第一次出现页面内确认条，
                          点"确定删除"才真删；不依赖 window.confirm。 */}
                      <div className="mt-1.5 ml-6">
                        {confirmPurgeId === plan.id ? (
                          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-danger-50 px-2.5 py-1.5">
                            <span className="text-[11.5px] font-medium text-danger-700">
                              永久删除后无法恢复，确定？
                            </span>
                            <button
                              type="button"
                              onClick={() => void handlePurge(plan)}
                              disabled={busy}
                              className="rounded bg-danger-600 px-2 py-0.5 text-[11.5px] font-medium text-white transition-colors hover:bg-danger-700 disabled:opacity-50"
                            >
                              {busy ? '删除中…' : '确定删除'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmPurgeId(null)}
                              disabled={busy}
                              className="rounded px-2 py-0.5 text-[11.5px] text-slate-500 transition-colors hover:bg-white disabled:opacity-50"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmPurgeId(null);
                                void handleRestore(plan);
                              }}
                              disabled={busy}
                              className="inline-flex items-center gap-1 text-[11.5px] font-medium text-primary-600 transition-colors hover:text-primary-700 disabled:opacity-50"
                            >
                              <RotateCcw className="h-3 w-3" />
                              回归
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmPurgeId(plan.id)}
                              disabled={busy}
                              className="inline-flex items-center gap-1 text-[11.5px] text-slate-400 transition-colors hover:text-danger-600 disabled:opacity-50"
                            >
                              <Trash2 className="h-3 w-3" />
                              永久删除
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
