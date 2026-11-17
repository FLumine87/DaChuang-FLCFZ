import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Loader2, Search, Sparkles, X } from 'lucide-react';
/* 走 adminApi 的分页接口：后端 /api/admin/cases 返回的是 { items, total, page, pageSize }
   信封，不是裸数组。以前这里用 mockApi.getAdminCases()，它把这个对象直接当数组返回，
   页面再 .filter() 就抛 "caseRecords.filter is not a function"，整页白屏。 */
import {
  addAdminCaseEvent, getAdminCase, listAdminCases, updateAdminCase, USE_MOCK,
  type AdminCaseDetail, type Page,
} from '../../services/adminApi';
import type { CaseRecord } from '../data/adminMockData';
import { analyseCase, loadCase, type CaseDetail as AgentCaseDetail } from '../../services/workspaceApi';
import AdminAlertBadge from '../components/AdminAlertBadge';
import AdminStatusBadge from '../components/AdminStatusBadge';
import UnsavedChangesDialog from '../../components/UnsavedChangesDialog';

/* 案例管理（2026-11-07 按设计稿改版）
   结构从「左列表 + 右详情」改成：
     · 整宽一张「案例列表」卡：标题 + 条数、筛选、表格、分页；
     · 点「查看详情」从右侧滑出 660px 抽屉（带遮罩、Esc / 点遮罩 / × 关闭）；
     · 抽屉里是资料区 + 两个页签「筛查记录 / 跟进记录」，
       筛查记录带前端分页与「查看」弹窗，跟进记录里保留原来的预警历史、
       案例维护（状态 / 备注）、新增跟进与时间线。

   原先把详情固定在右侧有个反复被提的问题：列表一宽，详情就只剩一条，
   不点不知道右边有内容；改成抽屉之后列表是主角，详情是「点开才有」的次要层。 */

const statusLabel: Record<CaseRecord['status'], string> = {
  active: '活跃', monitoring: '监控中', closed: '已关闭',
};
const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const SCREENING_PAGE_SIZE = 7;

/** 页码列表：总页数 ≤5 全列，否则围绕当前页取 5 个 */
function pageList(current: number, total: number): number[] {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  const start = Math.min(Math.max(current - 2, 1), total - 4);
  return Array.from({ length: 5 }, (_, i) => start + i);
}

const AI_STATUS_LABEL: Record<string, string> = {
  generated: 'AI 已生成', disabled: '模型未开启', not_configured: '未配置密钥',
  unavailable: 'AI 暂不可用', live_rules: '仅规则',
};

function AiStatusBadge({ status }: { status?: string }) {
  const key = status || 'unavailable';
  const tone = key === 'generated'
    ? 'bg-emerald-50 text-emerald-700'
    : key === 'unavailable'
      ? 'bg-amber-50 text-amber-700'
      : 'bg-slate-100 text-slate-500';
  return <span className={`rounded-full px-2 py-0.5 text-[11px] ${tone}`}>{AI_STATUS_LABEL[key] || 'AI 暂不可用'}</span>;
}

function AiList({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <h4 className="text-xs font-medium text-slate-500">{title}</h4>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-sm leading-6 text-slate-700">
        {items.map((item, index) => <li key={index}>{item}</li>)}
      </ul>
    </div>
  );
}

export default function AdminCases() {
  /* ── 列表 ─────────────────────────────────────────────────────────── */
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<Page<CaseRecord> | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');

  /* ── 抽屉 ─────────────────────────────────────────────────────────── */
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminCaseDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [tab, setTab] = useState<'screening' | 'follow'>('screening');
  /** 关闭动画期间仍保留 DOM，200ms 后再卸载 */
  const [drawerClosing, setDrawerClosing] = useState(false);
  const [screeningPage, setScreeningPage] = useState(1);
  const [viewing, setViewing] = useState<AdminCaseDetail['screenings'][number] | null>(null);
  /* ── AI 个案分析（与「预警研判与处置」共用同一套后端研判） ─────────── */
  const [aiCase, setAiCase] = useState<AgentCaseDetail | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');

  /* ── 维护 / 跟进 ──────────────────────────────────────────────────── */
  const [editStatus, setEditStatus] = useState<CaseRecord['status']>('active');
  const [notes, setNotes] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [eventSaving, setEventSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingLeave, setPendingLeave] = useState<
    { type: 'close' } | { type: 'switch'; id: string } | null
  >(null);
  const actionRef = useRef(false);

  /* 备注/状态改动，或跟进标题/内容写了一半，都算未保存。
     「保存并离开」只有在跟进标题和内容同时填写（或都没填）时才可点。 */
  const eventDirty = Boolean(eventTitle.trim() || eventDescription.trim());
  const dirty = Boolean(
    detail && (editStatus !== detail.status || notes.trim() !== detail.notes),
  );
  const unsaved = dirty || eventDirty;
  const canSaveBeforeLeave = !eventDirty || Boolean(eventTitle.trim() && eventDescription.trim());
  /** 案例在 Agent 工作台里的主体标识；后端也接受直接用 case_id 查询 */
  const aiSubject = detail?.agentSubject || detail?.id || '';
  const canRunAi = Boolean(aiSubject) && (detail?.screenings.length ?? 0) > 0;

  useEffect(() => {
    let active = true;
    listAdminCases({ keyword: keyword.trim(), status, page })
      .then((items) => { if (active) { setResult(items); setListError(''); } })
      .catch((reason: unknown) => {
        if (active) { setResult(null); setListError(reason instanceof Error ? reason.message : '加载失败'); }
      })
      .finally(() => { if (active) setListLoading(false); });
    return () => { active = false; };
  }, [keyword, status, page, reload]);

  useEffect(() => {
    if (!openId) { setDetail(null); return; }
    let active = true;
    getAdminCase(openId).then((item) => {
      if (!active) return;
      setDetail(item); setEditStatus(item.status); setNotes(item.notes); setDetailError('');
    }).catch((reason: unknown) => {
      if (active) { setDetail(null); setDetailError(reason instanceof Error ? reason.message : '详情加载失败'); }
    }).finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [openId, reload]);

  /* 打开案例时取最近一次 AI 研判；没做过或该案例没有已完成筛查时保持空态。 */
  useEffect(() => {
    if (!aiSubject) { setAiCase(null); return; }
    let active = true;
    loadCase('live', aiSubject)
      .then((item) => { if (active) setAiCase(item); })
      .catch(() => { if (active) setAiCase(null); });
    return () => { active = false; };
  }, [aiSubject]);

  /* 抽屉打开时锁住页面滚动，Esc 逐层关闭（先关弹窗，再关抽屉） */
  useEffect(() => {
    if (!openId) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (viewing) setViewing(null);
      else closeCase();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
    // closeCase 会读取最新的未保存状态，所以 dirty/eventDirty 变化时重注册
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, viewing, dirty, eventDirty]);

  function openCaseNow(id: string) {
    setOpenId(id); setDetail(null); setDetailLoading(true); setDetailError('');
    setTab('screening'); setScreeningPage(1); setViewing(null); setDrawerClosing(false);
    setEditStatus('active'); setNotes(''); setActionError(''); setNotice('');
    setEventTitle(''); setEventDescription('');
    setAiError('');
  }

  async function runAi() {
    if (!canRunAi || aiBusy) return;
    setAiBusy(true);
    setAiError('');
    try {
      const result = await analyseCase('live', aiSubject);
      setAiCase(result);
    } catch (reason) {
      setAiError(reason instanceof Error ? reason.message : 'AI 分析失败，请稍后重试');
    } finally {
      setAiBusy(false);
    }
  }

  function openCase(id: string) {
    if (openId === id) return;
    if (openId && unsaved) {
      setPendingLeave({ type: 'switch', id });
      return;
    }
    openCaseNow(id);
  }

  function closeCase() {
    if (!openId) return;
    if (unsaved) {
      setPendingLeave({ type: 'close' });
      return;
    }
    setDrawerClosing(true);
  }

  /* 关闭动画结束后再卸载，避免抽屉"啪"地消失 */
  useEffect(() => {
    if (!drawerClosing) return;
    const timer = window.setTimeout(() => {
      setOpenId(null); setDetail(null); setViewing(null); setDrawerClosing(false);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [drawerClosing]);

  function cancel() {
    if (!detail) return;
    setEditStatus(detail.status); setNotes(detail.notes);
    setActionError(''); setNotice('已取消未保存的修改');
  }

  async function saveCase(): Promise<boolean> {
    if (!detail || actionRef.current) return false;
    actionRef.current = true; setSaving(true); setActionError(''); setNotice('');
    try {
      const updated = await updateAdminCase(detail.id, { status: editStatus, notes: notes.trim() });
      setDetail(updated); setEditStatus(updated.status); setNotes(updated.notes);
      setNotice('案例信息已保存'); setListLoading(true); setReload((value) => value + 1);
      return true;
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '保存失败，请稍后重试');
      return false;
    } finally { actionRef.current = false; setSaving(false); }
  }

  async function addEvent(): Promise<boolean> {
    if (!detail || actionRef.current) return false;
    if (!eventTitle.trim() || !eventDescription.trim()) {
      setActionError('请填写跟进标题和内容'); return false;
    }
    actionRef.current = true; setEventSaving(true); setActionError(''); setNotice('');
    try {
      const updated = await addAdminCaseEvent(detail.id, {
        title: eventTitle.trim(), description: eventDescription.trim(),
      });
      setDetail(updated); setEventTitle(''); setEventDescription('');
      setNotice('跟进记录已添加');
      return true;
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '添加失败，请稍后重试');
      return false;
    } finally { actionRef.current = false; setEventSaving(false); }
  }

  /** 离开前把能保存的都保存：案例状态/备注，以及写了一半但已填完整的跟进。 */
  async function saveAndLeave() {
    if (!pendingLeave) return;
    if (dirty && !(await saveCase())) return;
    if (eventDirty) {
      if (!canSaveBeforeLeave) return;
      if (!(await addEvent())) return;
    }
    const target = pendingLeave;
    setPendingLeave(null);
    if (target.type === 'close') setDrawerClosing(true);
    else openCaseNow(target.id);
  }

  function discardAndLeave() {
    if (!pendingLeave) return;
    const target = pendingLeave;
    setPendingLeave(null);
    if (target.type === 'close') setDrawerClosing(true);
    else openCaseNow(target.id);
  }
  const total = result?.total ?? 0;
  const pageSize = result?.pageSize ?? 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasMore = page * pageSize < total;

  const screenings = detail?.screenings ?? [];
  const screeningPages = Math.max(1, Math.ceil(screenings.length / SCREENING_PAGE_SIZE));
  const currentScreenings = screenings.slice(
    (screeningPage - 1) * SCREENING_PAGE_SIZE,
    screeningPage * SCREENING_PAGE_SIZE,
  );
  const followCount = (detail?.alerts.length ?? 0) + (detail?.timeline.length ?? 0);

  return <div className="space-y-5">
    {/* 整宽列表卡 */}
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
        <h2 className="text-lg font-semibold text-slate-900">案例列表</h2>
        <span className="text-xs text-slate-400">共 {total} 个案例</span>
        {USE_MOCK && <span className="ml-auto rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">演示数据，操作仅在本页有效</span>}
      </div>

      <div className="flex flex-wrap gap-3 px-5 py-4">
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">搜索姓名或案例编号</span>
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className={inputClass + ' pl-9'}
            value={keyword}
            onChange={(event) => { setKeyword(event.target.value); setPage(1); setListLoading(true); }}
            placeholder="搜索姓名或案例编号"
          />
        </label>
        <label className="sm:w-56">
          <span className="sr-only">案例状态</span>
          <select
            className={inputClass}
            value={status}
            onChange={(event) => { setStatus(event.target.value); setPage(1); setListLoading(true); }}
          >
            <option value="">全部案例状态</option>
            {Object.entries(statusLabel).map(([value, label]) =>
              <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>

      {listError && <div role="alert" className="mx-5 mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
        案例列表加载失败：{listError} <button type="button" className="ml-2 underline"
          onClick={() => { setListLoading(true); setReload((value) => value + 1); }}>重试</button>
      </div>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500">
              <th className="px-5 py-3">姓名 / 案例编号</th>
              <th className="px-5 py-3">所属院系</th>
              <th className="px-5 py-3">关注等级</th>
              <th className="px-5 py-3">案例状态</th>
              <th className="px-5 py-3">筛查次数</th>
              <th className="px-5 py-3">最近筛查</th>
              <th className="px-5 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {listLoading && (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-slate-400">正在加载案例…</td></tr>
            )}
            {!listLoading && result?.items.length === 0 && (
              <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-500">当前条件下没有案例记录。</td></tr>
            )}
            {!listLoading && result?.items.map((item) => (
              <tr
                key={item.id}
                onClick={() => openCase(item.id)}
                className="cursor-pointer transition-colors hover:bg-slate-50/70"
              >
                <td className="px-5 py-3.5">
                  <div className="font-medium text-slate-900">{item.name || '未填写姓名'}</div>
                  <div className="mt-0.5 text-xs text-slate-400">{item.id}</div>
                </td>
                <td className="px-5 py-3.5 text-slate-600">{item.department || '未填写院系'}</td>
                <td className="px-5 py-3.5"><AdminAlertBadge level={item.alertLevel} size="sm" /></td>
                <td className="px-5 py-3.5"><AdminStatusBadge status={item.status} /></td>
                <td className="px-5 py-3.5 text-slate-600">{item.screeningCount} 次</td>
                <td className="px-5 py-3.5 text-slate-600">{item.lastScreening || '暂无'}</td>
                <td className="px-5 py-3.5 text-right">
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); openCase(item.id); }}
                    className="inline-flex cursor-pointer items-center gap-0.5 text-sm font-medium text-primary-600 hover:underline"
                  >
                    查看详情
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
        <span>共 {total} 条 · 第 {page} 页</span>
        <div className="flex items-center gap-1.5">
          <button type="button" disabled={page <= 1}
            onClick={() => { setPage((value) => value - 1); setListLoading(true); }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1 disabled:opacity-40">上一页</button>
          {pageList(page, totalPages).map((number) => (
            <button
              key={number}
              type="button"
              onClick={() => { setPage(number); setListLoading(true); }}
              aria-current={number === page ? 'page' : undefined}
              className={`grid h-8 min-w-8 cursor-pointer place-items-center rounded-lg border px-2 ${
                number === page
                  ? 'border-primary-500 bg-primary-50 font-medium text-primary-600'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
              }`}
            >
              {number}
            </button>
          ))}
          <button type="button" disabled={!hasMore}
            onClick={() => { setPage((value) => value + 1); setListLoading(true); }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1 disabled:opacity-40">下一页</button>
        </div>
      </div>
    </div>

    {/* 右侧抽屉 */}
    {openId && (
      <div className="fixed inset-0 z-50">
        {/* 遮罩：淡入/淡出；点它关闭 */}
        <div
          className={`absolute inset-0 bg-slate-900/40 ${drawerClosing ? 'case-scrim-out' : 'case-scrim-in'}`}
          onClick={closeCase}
          aria-hidden="true"
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="案例详情"
          className={`absolute inset-y-0 right-0 flex w-full max-w-[660px] flex-col overflow-hidden rounded-l-[20px] bg-page shadow-[-24px_0_48px_-32px_rgba(15,23,42,0.35)] ${
            drawerClosing ? 'case-drawer-out' : 'case-drawer-in'
          }`}
        >
          <header className="flex items-start justify-between gap-4 border-b border-slate-200/70 bg-white/85 px-6 py-4 backdrop-blur">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">案例详情</h2>
              <p className="mt-1 text-xs text-slate-400">查看案例资料与筛查记录</p>
            </div>
            <button
              type="button"
              onClick={closeCase}
              title="关闭详情"
              aria-label="关闭详情"
              className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className="app-scrollbar flex-1 overflow-y-auto px-4 pb-3">
            {detailLoading && (
              <div className="mt-4 space-y-4 rounded-2xl border border-slate-200/70 bg-white p-5" role="status" aria-label="正在加载详情">
                <div className="h-7 w-40 animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
                <div className="grid grid-cols-2 gap-4">
                  {[0, 1, 2, 3].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-slate-100" />)}
                </div>
                <div className="h-24 animate-pulse rounded-xl bg-slate-50" />
              </div>
            )}
            {detailError && (
              <p role="alert" className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                详情加载失败：{detailError}
              </p>
            )}

            {detail && !detailLoading && <>
              {/* 资料卡 */}
              <section className="mt-4 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h3 className="text-[26px] font-semibold leading-tight text-slate-900">{detail.name || '未填写姓名'}</h3>
                  <AdminAlertBadge level={detail.alertLevel} />
                  <AdminStatusBadge status={detail.status} />
                </div>
                <p className="mt-1 text-sm text-slate-400">{detail.id}</p>

                <dl className="mt-4 grid gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2">
                  {[
                    ['年龄', detail.age == null ? '未记录' : `${detail.age} 岁`],
                    ['性别', detail.gender || '未记录'],
                    ['所属院系', detail.department || '未记录'],
                    ['标签', detail.tags.length > 0 ? detail.tags.join('、') : '无'],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-4">
                      <dt className="shrink-0 text-slate-400">{label}</dt>
                      <dd className="min-w-0 truncate text-right text-slate-700">{value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-3 flex flex-wrap items-center gap-6 text-sm text-slate-500">
                  <span>累计筛查 <strong className="font-semibold text-slate-900">{detail.screeningCount}</strong> 次</span>
                  <span>最近筛查 <strong className="font-medium text-slate-900">{detail.lastScreening || '暂无'}</strong></span>
                </div>

                {detail.userId == null && (
                  <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                    该案例尚未关联账号。为避免同名记录混入，历史筛查与预警暂不自动汇总。
                  </p>
                )}
              </section>

              {/* AI 个案分析：与「预警研判与处置」共用同一套后端研判与模型开关 */}
              <section className="mt-4 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <Sparkles className="h-4 w-4 text-primary-600" /> AI 个案分析
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-slate-400">
                      基于问卷历史与多模态材料摘要生成，仅供人工复核参考；运行后会保存研判，并可能生成待审核任务草案。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void runAi()}
                    disabled={aiBusy || !canRunAi}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary-500 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {aiBusy ? '正在分析…' : aiCase?.assessment ? '重新运行' : '运行 AI 分析'}
                  </button>
                </div>

                {aiError && (
                  <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{aiError}</p>
                )}

                {aiCase?.assessment ? (
                  <div className="mt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <AiStatusBadge status={aiCase.assessment.model_status} />
                      {aiCase.assessment.ai_model && (
                        <span className="text-[11.5px] text-slate-400">
                          {aiCase.assessment.ai_model} · {aiCase.assessment.ai_latency_ms ?? 0}ms
                        </span>
                      )}
                    </div>
                    {aiCase.assessment.model_draft ? (
                      <>
                        <p className="mt-3 text-sm leading-6 text-slate-700">{aiCase.assessment.model_draft.summary}</p>
                        <div className="mt-3 grid gap-4 sm:grid-cols-2">
                          <AiList title="观察" items={aiCase.assessment.model_draft.observations} />
                          <AiList title="多模态材料说明" items={aiCase.assessment.model_draft.multimodal_notes} />
                          <AiList title="需核对的风险点" items={aiCase.assessment.model_draft.risk_points} />
                          <AiList title="处置建议" items={aiCase.assessment.model_draft.recommendations} />
                        </div>
                        {!!aiCase.assessment.model_draft.evidence_refs.length && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {aiCase.assessment.model_draft.evidence_refs.map((ref) => (
                              <span key={ref} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">{ref}</span>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="mt-3 text-sm leading-6 text-slate-600">{aiCase.assessment.summary}</p>
                    )}
                    <p className="mt-3 text-[11.5px] text-slate-400">
                      保存于 {aiCase.assessment.created_at} · 不构成诊断，处置由工作人员决定
                    </p>
                  </div>
                ) : (
                  !aiBusy && <p className="mt-3 text-xs text-slate-400">
                    {detail.screenings.length
                      ? '尚未运行。点击右上角按钮生成 AI 分析。'
                      : '该案例暂无已完成筛查，无法运行 AI 分析。'}
                  </p>
                )}
              </section>

              {/* 页签 + 内容卡 */}
              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
                <div className="flex gap-6 border-b border-slate-100 px-5">
                  {([
                    ['screening', '筛查记录', detail.screenings.length],
                    ['follow', '跟进记录', followCount],
                  ] as const).map(([value, label, count]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => { setTab(value); setActionError(''); setNotice(''); }}
                      aria-current={tab === value ? 'page' : undefined}
                      className={`-mb-px cursor-pointer border-b-2 pb-2.5 pt-3 text-sm transition-colors ${
                        tab === value
                          ? 'border-primary-500 font-medium text-primary-600'
                          : 'border-transparent text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {label}
                      <span className={`ml-1.5 text-xs ${tab === value ? 'text-primary-500' : 'text-slate-400'}`}>{count}</span>
                    </button>
                  ))}
                </div>

                <div className="px-5 py-4">
                  {tab === 'screening' ? (
                    <div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-slate-50/80 text-left text-xs font-medium text-slate-500">
                              <th className="rounded-l-lg px-4 py-2">筛查时间</th>
                              <th className="px-4 py-2">量表 / 得分</th>
                              <th className="rounded-r-lg px-4 py-2 text-right">操作</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {currentScreenings.map((item) => (
                              <tr key={item.id} className="transition-colors hover:bg-slate-50/60">
                                <td className="px-4 py-2.5 text-slate-600">{item.date}</td>
                                <td className="px-4 py-2.5">
                                  <span className="text-slate-700">{item.questionnaire || '未知量表'}</span>
                                  <span className="ml-2 text-xs text-slate-500">
                                    {item.score == null ? '无得分' : `${item.score}/${item.maxScore}`}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5 text-right">
                                  <button
                                    type="button"
                                    onClick={() => setViewing(item)}
                                    className="cursor-pointer text-sm font-medium text-primary-600 hover:underline"
                                  >
                                    查看
                                  </button>
                                </td>
                              </tr>
                            ))}
                            {screenings.length === 0 && (
                              <tr><td colSpan={3} className="px-4 py-10 text-center text-sm text-slate-500">暂无关联筛查。</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
                        <span>共 {screenings.length} 条</span>
                        <div className="flex items-center gap-1.5">
                          <button type="button" disabled={screeningPage <= 1}
                            onClick={() => setScreeningPage((value) => value - 1)}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 disabled:opacity-40">上一页</button>
                          {pageList(screeningPage, screeningPages).map((number) => (
                            <button
                              key={number}
                              type="button"
                              onClick={() => setScreeningPage(number)}
                              aria-current={number === screeningPage ? 'page' : undefined}
                              className={`grid h-7 min-w-7 cursor-pointer place-items-center rounded-lg border px-1.5 ${
                                number === screeningPage
                                  ? 'border-primary-500 bg-primary-50 font-medium text-primary-600'
                                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                              }`}
                            >
                              {number}
                            </button>
                          ))}
                          <button type="button" disabled={screeningPage === screeningPages}
                            onClick={() => setScreeningPage((value) => value + 1)}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 disabled:opacity-40">下一页</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      <section>
                        <h4 className="text-sm font-medium text-slate-900">预警历史</h4>
                        {detail.alerts.length === 0 ? (
                          <p className="mt-2 text-sm text-slate-500">暂无关联预警。</p>
                        ) : (
                          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-100">
                            {detail.alerts.map((item) => (
                              <li key={item.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs text-slate-600">
                                <AdminAlertBadge level={item.level as CaseRecord['alertLevel']} size="sm" />
                                <span>{item.createdAt}</span>
                                <span className="text-slate-400">{item.id}</span>
                                <span className="ml-auto text-slate-500">
                                  {item.status === 'pending' ? '待处理' : item.status === 'processing' ? '处理中' : item.status === 'resolved' ? '已解决' : '已关闭'}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>

                      <section className="border-t border-slate-100 pt-4">
                        <h4 className="text-sm font-medium text-slate-900">案例维护</h4>
                        <div className="mt-3 space-y-3">
                          <label className="block text-sm text-slate-600">状态
                            <select className={inputClass + ' mt-1'} value={editStatus}
                              onChange={(event) => setEditStatus(event.target.value as CaseRecord['status'])}>
                              {Object.entries(statusLabel).map(([value, label]) =>
                                <option key={value} value={value}>{label}</option>)}
                            </select>
                          </label>
                          <label className="block text-sm text-slate-600">案例备注
                            <textarea className={inputClass + ' mt-1 min-h-24'} value={notes}
                              onChange={(event) => setNotes(event.target.value)}
                              placeholder="记录案例背景或长期跟进说明" />
                          </label>
                          <div className="flex gap-2">
                            <button type="button" onClick={saveCase} disabled={!dirty || saving || eventSaving}
                              className="cursor-pointer rounded-lg bg-primary-600 px-4 py-2 text-sm text-white disabled:opacity-40">
                              {saving ? '保存中…' : '保存案例'}
                            </button>
                            <button type="button" onClick={cancel} disabled={!dirty || saving || eventSaving}
                              className="cursor-pointer rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 disabled:opacity-40">取消修改</button>
                          </div>
                        </div>
                      </section>

                      <section className="border-t border-slate-100 pt-4">
                        <h4 className="text-sm font-medium text-slate-900">新增跟进</h4>
                        <div className="mt-3 space-y-3">
                          <label className="block text-sm text-slate-600">标题
                            <input className={inputClass + ' mt-1'} value={eventTitle}
                              onChange={(event) => setEventTitle(event.target.value)} placeholder="例如：首次回访" />
                          </label>
                          <label className="block text-sm text-slate-600">内容
                            <textarea className={inputClass + ' mt-1 min-h-24'} value={eventDescription}
                              onChange={(event) => setEventDescription(event.target.value)} placeholder="填写实际跟进情况" />
                          </label>
                          <div className="flex gap-2">
                            <button type="button" onClick={addEvent}
                              disabled={eventSaving || saving || !eventTitle.trim() || !eventDescription.trim()}
                              className="cursor-pointer rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40">
                              {eventSaving ? '添加中…' : '添加跟进'}
                            </button>
                            <button type="button"
                              onClick={() => { setEventTitle(''); setEventDescription(''); setActionError(''); }}
                              disabled={eventSaving || saving}
                              className="cursor-pointer rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 disabled:opacity-40">清空</button>
                          </div>
                          {actionError && <p role="alert" className="text-sm text-rose-700">{actionError}</p>}
                          {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
                        </div>
                      </section>

                      <section className="border-t border-slate-100 pt-4">
                        <h4 className="text-sm font-medium text-slate-900">案例时间线</h4>
                        {detail.timeline.length === 0 ? (
                          <p className="mt-2 text-sm text-slate-500">暂无筛查、预警或跟进记录。</p>
                        ) : (
                          <ol className="mt-3 space-y-3">
                            {detail.timeline.map((event) => (
                              <li key={event.id} className="border-l-2 border-primary-200 pl-3 text-xs text-slate-600">
                                <p className="font-medium text-slate-900">{event.title}</p>
                                <p>{event.date}</p>
                                <p className="mt-1 whitespace-pre-wrap">{event.description}</p>
                              </li>
                            ))}
                          </ol>
                        )}
                      </section>
                    </div>
                  )}
                </div>
              </div>
            </>}
          </div>

          <footer className="border-t border-slate-200/70 bg-white/85 px-6 py-3 backdrop-blur">
            <div className="flex justify-end">
              <button type="button" onClick={closeCase}
                className="cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50">
                关闭详情
              </button>
            </div>
          </footer>
        </aside>
      </div>
    )}

    {/* 筛查记录「查看」弹窗 */}
    {viewing && (
      <div className="fixed inset-0 z-[60] grid place-items-center p-4">
        <div className="case-scrim-in absolute inset-0 bg-slate-900/40" onClick={() => setViewing(null)} aria-hidden="true" />
        <div role="dialog" aria-modal="true" aria-label="筛查记录" className="case-modal-in relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">筛查记录</h3>
              <p className="mt-1 text-xs text-slate-400">{viewing.id}</p>
            </div>
            <button type="button" onClick={() => setViewing(null)} aria-label="关闭"
              className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <dl className="mt-5 space-y-2.5 text-sm">
            {[
              ['筛查日期', viewing.date],
              ['量表', viewing.questionnaire || '未知量表'],
              ['得分', viewing.score == null ? '无得分' : `${viewing.score} / ${viewing.maxScore}`],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-4">
                <dt className="text-slate-400">{label}</dt>
                <dd className="text-slate-700">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 flex justify-end">
            <button type="button" onClick={() => setViewing(null)}
              className="cursor-pointer rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">关闭</button>
          </div>
        </div>
      </div>
    )}

    <UnsavedChangesDialog
      open={Boolean(pendingLeave)}
      saving={saving || eventSaving}
      canSave={canSaveBeforeLeave}
      saveDisabledHint="跟进标题和内容需要同时填写才能保存；也可以选择继续编辑或放弃修改。"
      description={
        pendingLeave?.type === 'switch'
          ? '案例备注、状态或跟进内容还没有保存。直接切换记录会丢失这些修改。'
          : '案例备注、状态或跟进内容还没有保存。直接关闭详情会丢失这些修改。'
      }
      onSave={() => void saveAndLeave()}
      onDiscard={discardAndLeave}
      onContinue={() => setPendingLeave(null)}
    />
  </div>;
}
