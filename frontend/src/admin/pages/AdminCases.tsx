import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
/* 走 adminApi 的分页接口：后端 /api/admin/cases 返回的是 { items, total, page, pageSize }
   信封，不是裸数组。以前这里用 mockApi.getAdminCases()，它把这个对象直接当数组返回，
   页面再 .filter() 就抛 "caseRecords.filter is not a function"，整页白屏。 */
import {
  addAdminCaseEvent, getAdminCase, listAdminCases, updateAdminCase, USE_MOCK,
  type AdminCaseDetail, type Page,
} from '../../services/adminApi';
import type { CaseRecord } from '../data/adminMockData';
import AdminAlertBadge from '../components/AdminAlertBadge';
import AdminStatusBadge from '../components/AdminStatusBadge';

/* 案例管理：列表 + 详情 + 改状态/备注 + 追加跟进 + 时间线。
   这一整套（列表筛选分页、详情抽屉、案例维护、新增跟进、时间线）曾经在
   commit 043cad7 里存在（233 行），后来收敛页面时被砍到只剩 61 行的卡片网格，
   于是四个后端接口 GET/PUT /api/admin/cases/{id}、
   POST /api/admin/cases/{id}/timeline 全成了死代码，管理端也看不到
   筛查、预警和跟进记录。这里把它们接回来，并做两处适配：
     · 配色从旧的 sky-* 统一到项目当前的 primary-*；
     · 保留上面那段分页信封的说明（那正是白屏的根因，别再踩一次）。 */

const statusLabel: Record<CaseRecord['status'], string> = {
  active: '进行中', monitoring: '持续观察', closed: '已结案',
};
const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';

export default function AdminCases() {
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<Page<CaseRecord> | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminCaseDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [editStatus, setEditStatus] = useState<CaseRecord['status']>('active');
  const [notes, setNotes] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [eventSaving, setEventSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  /* 防重复提交：按钮 disabled 是异步生效的，连点两下仍会发两个请求 */
  const actionRef = useRef(false);

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
    if (!selectedId) { setDetail(null); return; }
    let active = true;
    getAdminCase(selectedId).then((item) => {
      if (!active) return;
      setDetail(item); setEditStatus(item.status); setNotes(item.notes); setDetailError('');
    }).catch((reason: unknown) => {
      if (active) { setDetail(null); setDetailError(reason instanceof Error ? reason.message : '详情加载失败'); }
    }).finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId, reload]);

  function choose(id: string) {
    setSelectedId(id); setDetail(null); setDetailLoading(true);
    setActionError(''); setNotice(''); setEventTitle(''); setEventDescription('');
  }

  function cancel() {
    if (!detail) return;
    setEditStatus(detail.status); setNotes(detail.notes);
    setActionError(''); setNotice('已取消未保存的修改');
  }

  async function saveCase() {
    if (!detail || actionRef.current) return;
    actionRef.current = true; setSaving(true); setActionError(''); setNotice('');
    try {
      const updated = await updateAdminCase(detail.id, { status: editStatus, notes: notes.trim() });
      setDetail(updated); setEditStatus(updated.status); setNotes(updated.notes);
      setNotice('案例信息已保存'); setListLoading(true); setReload((value) => value + 1);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '保存失败，请稍后重试');
    } finally { actionRef.current = false; setSaving(false); }
  }

  async function addEvent() {
    if (!detail || actionRef.current) return;
    if (!eventTitle.trim() || !eventDescription.trim()) {
      setActionError('请填写跟进标题和内容'); return;
    }
    actionRef.current = true; setEventSaving(true); setActionError(''); setNotice('');
    try {
      const updated = await addAdminCaseEvent(detail.id, {
        title: eventTitle.trim(), description: eventDescription.trim(),
      });
      setDetail(updated); setEventTitle(''); setEventDescription('');
      setNotice('跟进记录已添加');
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '添加失败，请稍后重试');
    } finally { actionRef.current = false; setEventSaving(false); }
  }

  const dirty = detail && (editStatus !== detail.status || notes.trim() !== detail.notes);
  const hasMore = result ? page * result.pageSize < result.total : false;

  return <div className="space-y-5">
    {/* 不在这里渲染「案例管理」大标题：AppShell.tsx 的 routeMeta 已经统一渲染了
        「案例管理 / 汇集案例资料，持续跟踪干预与恢复进展。」，再写一遍页面上会
        出现两个同名标题（实测截图确认）。被恢复的那版（043cad7）自带标题是因为
        当时 AppShell 还没有 routeMeta。这里只保留演示态的提示条。 */}
    {USE_MOCK && <div className="flex justify-end">
      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">演示数据，操作仅在本页有效</span>
    </div>}
    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2">
      <label className="relative"><span className="sr-only">搜索姓名或案例编号</span>
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input className={inputClass + ' pl-9'} value={keyword}
          onChange={(event) => { setKeyword(event.target.value); setPage(1); setListLoading(true); }}
          placeholder="搜索姓名或案例编号" /></label>
      <label><span className="sr-only">案例状态</span><select className={inputClass} value={status}
        onChange={(event) => { setStatus(event.target.value); setPage(1); setListLoading(true); }}>
        <option value="">全部案例状态</option>{Object.entries(statusLabel).map(([value, label]) =>
          <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    {listError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
      案例列表加载失败：{listError} <button type="button" className="ml-2 underline"
        onClick={() => { setListLoading(true); setReload((value) => value + 1); }}>重试</button></div>}
    {/* 窄屏单列，≥lg 才分左右：详情面板在手机上排到列表下面，而不是被挤成一条 */}
    <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
      <div>
        {listLoading && <p role="status" className="text-sm text-slate-500">正在加载案例…</p>}
        {!listLoading && result?.items.length === 0 &&
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">当前条件下没有案例记录。</div>}
        <div className="grid gap-3 sm:grid-cols-2">
          {!listLoading && result?.items.map((item) => <button type="button" key={item.id} onClick={() => choose(item.id)}
            aria-pressed={selectedId === item.id}
            className={'rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:border-primary-300 ' +
              (selectedId === item.id ? 'border-primary-500 ring-2 ring-primary-100' : 'border-slate-200')}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-slate-900">{item.name || '未填写姓名'}</p>
              <AdminAlertBadge level={item.alertLevel} size="sm" />
            </div>
            <p className="mt-1 text-xs text-slate-500">{item.id} · {item.department || '未填写院系'}</p>
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-slate-600">筛查 {item.screeningCount} 次</p>
              <AdminStatusBadge status={item.status} />
            </div>
            <p className="mt-2 text-xs text-slate-400">最近筛查：{item.lastScreening || '暂无'}</p>
          </button>)}
        </div>
        {!listLoading && result && result.total > 0 && <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>共 {result.total} 条 · 第 {page} 页</span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => { setPage((value) => value - 1); setListLoading(true); }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1 disabled:opacity-40">上一页</button>
            <button type="button" disabled={!hasMore} onClick={() => { setPage((value) => value + 1); setListLoading(true); }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1 disabled:opacity-40">下一页</button>
          </div>
        </div>}
      </div>
      <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {!selectedId && <p className="text-sm text-slate-500">选择一个案例查看筛查、预警和跟进时间线。</p>}
        {selectedId && <button type="button" onClick={() => { setSelectedId(null); setDetail(null); }}
          className="mb-4 inline-flex items-center gap-1 text-sm text-primary-700 hover:underline"><ArrowLeft className="h-4 w-4" /> 返回列表</button>}
        {detailLoading && <p role="status" className="text-sm text-slate-500">正在加载详情…</p>}
        {detailError && <p role="alert" className="text-sm text-rose-700">详情加载失败：{detailError}</p>}
        {detail && !detailLoading && <>
          <div className="flex items-start justify-between gap-2">
            <div><h3 className="font-semibold text-slate-900">{detail.name || detail.id}</h3>
              <p className="text-xs text-slate-500">{detail.id}</p></div>
            <AdminStatusBadge status={detail.status} />
          </div>
          <p className="mt-3 text-sm text-slate-600">
            {detail.age == null ? '年龄未记录' : detail.age + ' 岁'} · {detail.gender || '性别未记录'} · {detail.department || '院系未记录'}
          </p>
          {detail.tags.length > 0 && <p className="mt-2 text-xs text-slate-500">标签：{detail.tags.join('、')}</p>}
          {detail.userId == null && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            该案例尚未关联账号。为避免同名记录混入，历史筛查与预警暂不自动汇总。
          </p>}

          <section className="mt-5 border-t border-slate-100 pt-4">
            <h4 className="font-medium text-slate-900">筛查记录</h4>
            {detail.screenings.length === 0 ? <p className="mt-2 text-sm text-slate-500">暂无关联筛查。</p> :
              <ul className="mt-2 divide-y divide-slate-100">{detail.screenings.map((item) =>
                <li key={item.id} className="py-2 text-xs text-slate-600">{item.date} · {item.questionnaire || '未知量表'} ·
                  {item.score == null ? '无得分' : ' ' + item.score + '/' + item.maxScore} · {item.id}</li>)}</ul>}
          </section>
          <section className="mt-5 border-t border-slate-100 pt-4">
            <h4 className="font-medium text-slate-900">预警历史</h4>
            {detail.alerts.length === 0 ? <p className="mt-2 text-sm text-slate-500">暂无关联预警。</p> :
              <ul className="mt-2 divide-y divide-slate-100">{detail.alerts.map((item) =>
                <li key={item.id} className="flex items-center gap-2 py-2 text-xs text-slate-600">
                  <AdminAlertBadge level={item.level as CaseRecord['alertLevel']} size="sm" />
                  <span>{item.createdAt} · {item.id} · {item.status === 'pending' ? '待处理' : item.status === 'processing' ? '处理中' : item.status === 'resolved' ? '已解决' : '已关闭'}</span>
                </li>)}</ul>}
          </section>
          <section className="mt-5 space-y-3 border-t border-slate-100 pt-4">
            <h4 className="font-medium text-slate-900">案例维护</h4>
            <label className="block text-sm text-slate-600">状态<select className={inputClass + ' mt-1'} value={editStatus}
              onChange={(event) => setEditStatus(event.target.value as CaseRecord['status'])}>
              {Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label className="block text-sm text-slate-600">案例备注<textarea className={inputClass + ' mt-1 min-h-24'} value={notes}
              onChange={(event) => setNotes(event.target.value)} placeholder="记录案例背景或长期跟进说明" /></label>
            <div className="flex gap-2">
              <button type="button" onClick={saveCase} disabled={!dirty || saving || eventSaving}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white disabled:opacity-40">{saving ? '保存中…' : '保存案例'}</button>
              <button type="button" onClick={cancel} disabled={!dirty || saving || eventSaving}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 disabled:opacity-40">取消修改</button>
            </div>
          </section>
          <section className="mt-5 space-y-3 border-t border-slate-100 pt-4">
            <h4 className="font-medium text-slate-900">新增跟进</h4>
            <label className="block text-sm text-slate-600">标题<input className={inputClass + ' mt-1'} value={eventTitle}
              onChange={(event) => setEventTitle(event.target.value)} placeholder="例如：首次回访" /></label>
            <label className="block text-sm text-slate-600">内容<textarea className={inputClass + ' mt-1 min-h-24'} value={eventDescription}
              onChange={(event) => setEventDescription(event.target.value)} placeholder="填写实际跟进情况" /></label>
            <div className="flex gap-2">
              <button type="button" onClick={addEvent} disabled={eventSaving || saving || !eventTitle.trim() || !eventDescription.trim()}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40">{eventSaving ? '添加中…' : '添加跟进'}</button>
              <button type="button" onClick={() => { setEventTitle(''); setEventDescription(''); setActionError(''); }}
                disabled={eventSaving || saving} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 disabled:opacity-40">清空</button>
            </div>
            {actionError && <p role="alert" className="text-sm text-rose-700">{actionError}</p>}
            {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
          </section>
          <section className="mt-5 border-t border-slate-100 pt-4">
            <h4 className="font-medium text-slate-900">案例时间线</h4>
            {detail.timeline.length === 0 ? <p className="mt-2 text-sm text-slate-500">暂无筛查、预警或跟进记录。</p> :
              <ol className="mt-3 space-y-3">{detail.timeline.map((event) =>
                <li key={event.id} className="border-l-2 border-primary-200 pl-3 text-xs text-slate-600">
                  <p className="font-medium text-slate-900">{event.title}</p>
                  <p>{event.date}</p><p className="mt-1 whitespace-pre-wrap">{event.description}</p>
                </li>)}</ol>}
          </section>
        </>}
      </aside>
    </div>
  </div>;
}
