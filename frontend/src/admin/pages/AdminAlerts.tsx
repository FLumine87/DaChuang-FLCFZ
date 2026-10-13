import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Search, MousePointerClick } from 'lucide-react';
import {
  getAdminAlert, listAdminAlerts, listAdminAssignees, updateAdminAlert, USE_MOCK,
  type AdminAlertDetail, type Assignee, type Page,
} from '../../services/adminApi';
import type { AlertRecord } from '../data/adminMockData';
import AdminAlertBadge from '../components/AdminAlertBadge';
import AdminStatusBadge from '../components/AdminStatusBadge';

const nextStatus: Record<AlertRecord['status'], AlertRecord['status'] | null> = {
  pending: 'processing', processing: 'resolved', resolved: 'closed', closed: null,
};
const statusLabel: Record<AlertRecord['status'], string> = {
  pending: '待处理', processing: '处理中', resolved: '已解决', closed: '已关闭',
};
const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-100';

export default function AdminAlerts() {
  const [keyword, setKeyword] = useState('');
  const [level, setLevel] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<Page<AlertRecord> | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminAlertDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [assigneeError, setAssigneeError] = useState('');
  const [editStatus, setEditStatus] = useState<AlertRecord['status']>('pending');
  const [assigneeId, setAssigneeId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const savingRef = useRef(false);

  useEffect(() => {
    let active = true;
    listAdminAssignees().then((items) => { if (active) setAssignees(items); })
      .catch((reason: unknown) => { if (active) setAssigneeError(reason instanceof Error ? reason.message : '加载处理人失败'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    listAdminAlerts({ keyword: keyword.trim(), level, status, page })
      .then((items) => { if (active) { setResult(items); setListError(''); } })
      .catch((reason: unknown) => { if (active) { setResult(null); setListError(reason instanceof Error ? reason.message : '加载失败'); } })
      .finally(() => { if (active) setListLoading(false); });
    return () => { active = false; };
  }, [keyword, level, status, page, reload]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let active = true;
    getAdminAlert(selectedId).then((item) => {
      if (!active) return;
      setDetail(item); setEditStatus(item.status); setAssigneeId(item.assigneeId);
      setNote(''); setDetailError(''); setSaveError('');
    }).catch((reason: unknown) => {
      if (active) { setDetail(null); setDetailError(reason instanceof Error ? reason.message : '详情加载失败'); }
    }).finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId, reload]);

  function choose(id: string) {
    setSelectedId(id); setDetail(null); setDetailLoading(true); setNotice(''); setSaveError('');
  }

  function cancel() {
    if (!detail) return;
    setEditStatus(detail.status); setAssigneeId(detail.assigneeId); setNote('');
    setSaveError(''); setNotice('已取消未保存的修改');
  }

  async function save() {
    if (!detail || savingRef.current) return;
    savingRef.current = true; setSaving(true); setSaveError(''); setNotice('');
    try {
      const updated = await updateAdminAlert(detail.id, {
        status: editStatus, assignee_id: assigneeId, follow_up_notes: note.trim(),
      });
      setDetail(updated); setEditStatus(updated.status); setAssigneeId(updated.assigneeId);
      setNote(''); setNotice('预警处置已保存');
      setListLoading(true); setReload((value) => value + 1);
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : '保存失败，请稍后重试');
    } finally {
      savingRef.current = false; setSaving(false);
    }
  }

  const dirty = detail && (editStatus !== detail.status || assigneeId !== detail.assigneeId || note.trim().length > 0);
  const hasMore = result ? page * result.pageSize < result.total : false;

  return <div className="space-y-5">
    {/* 这一块以前又渲染了一遍「预警管理」大标题 + 说明，和外壳的页头
        （管理端 · 健康管理 / 预警管理 / 查看风险变化…）叠成两层。
        外壳那层带面包屑、两端页面统一，所以这里只留"演示数据"标记。 */}
    <div className="flex flex-wrap items-center justify-end gap-3">
      {USE_MOCK && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">演示数据，操作仅在本页有效</span>}
    </div>
    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3">
      <label className="relative">
        <span className="sr-only">搜索姓名或预警编号</span>
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input className={inputClass + ' pl-9'} value={keyword} onChange={(event) => { setKeyword(event.target.value); setPage(1); setListLoading(true); }}
          placeholder="搜索姓名或预警编号" />
      </label>
      <label><span className="sr-only">风险等级</span><select className={inputClass} value={level}
        onChange={(event) => { setLevel(event.target.value); setPage(1); setListLoading(true); }}>
        <option value="">全部风险等级</option><option value="red">红色</option><option value="orange">橙色</option>
        <option value="yellow">黄色</option><option value="green">绿色</option>
      </select></label>
      <label><span className="sr-only">处理状态</span><select className={inputClass} value={status}
        onChange={(event) => { setStatus(event.target.value); setPage(1); setListLoading(true); }}>
        <option value="">全部处理状态</option>{Object.entries(statusLabel).map(([value, label]) =>
          <option key={value} value={value}>{label}</option>)}
      </select></label>
    </div>
    {listError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
      预警列表加载失败：{listError} <button type="button" className="ml-2 underline"
        onClick={() => { setListLoading(true); setReload((value) => value + 1); }}>重试</button>
    </div>}
    <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
      <div className="space-y-3">
        {listLoading && <p role="status" className="text-sm text-slate-500">正在加载预警…</p>}
        {!listLoading && result?.items.length === 0 &&
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">当前条件下没有预警记录。</div>}
        {!listLoading && result?.items.map((alert) =>
          <button type="button" key={alert.id} onClick={() => choose(alert.id)}
            aria-pressed={selectedId === alert.id}
            className={'w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:border-sky-300 ' +
              (selectedId === alert.id ? 'border-sky-500 ring-2 ring-sky-100' : 'border-slate-200')}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-2"><AdminAlertBadge level={alert.level} />
                <div><p className="font-medium text-slate-900">{alert.name || '未填写姓名'}</p>
                  <p className="text-xs text-slate-500">{alert.id} · {alert.screeningId || '无关联筛查'}</p></div></div>
              <AdminStatusBadge status={alert.status} />
            </div>
            <p className="mt-3 text-sm text-slate-600">{alert.trigger || alert.description || '无触发说明'}</p>
            <p className="mt-2 text-xs text-slate-400">{alert.createdAt} · {alert.assignee}</p>
          </button>)}
        {!listLoading && result && result.total > 0 && <div className="flex items-center justify-between text-sm text-slate-500">
          <span>共 {result.total} 条 · 第 {page} 页</span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => { setPage((value) => value - 1); setListLoading(true); }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1 disabled:opacity-40">上一页</button>
            <button type="button" disabled={!hasMore} onClick={() => { setPage((value) => value + 1); setListLoading(true); }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1 disabled:opacity-40">下一页</button>
          </div>
        </div>}
      </div>
      {/* 右侧详情栏：原来用 h-fit，没选中时只剩一行字 —— 一个巴掌大的白框，
          和左边长长的列表并排很突兀。现在撑一个最小高度，空态在框内居中，
          做成"待操作"的样子；并且**空态与加载态互斥**（原来两行会同时出现，
          既说"选一条"又说"正在加载"，自相矛盾）。 */}
      <aside className="flex min-h-[460px] flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {!selectedId && !detailLoading && (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-50 text-slate-300">
              <MousePointerClick className="h-6 w-6" />
            </span>
            <p className="mt-4 text-sm font-medium text-slate-600">
              选择一条预警查看详情并处理
            </p>
            <p className="mt-1.5 max-w-[260px] text-xs leading-5 text-slate-400">
              左侧列表里每一条都能点开：查看触发原因与补充说明，分配处理人，并记录处置过程。
            </p>
          </div>
        )}
        {selectedId && <button type="button" onClick={() => { setSelectedId(null); setDetail(null); }}
          className="mb-4 inline-flex items-center gap-1 text-sm text-sky-700 hover:underline"><ArrowLeft className="h-4 w-4" /> 返回列表</button>}
        {detailLoading && (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400" role="status">
            正在加载详情…
          </div>
        )}
        {detailError && <p role="alert" className="text-sm text-rose-700">详情加载失败：{detailError}</p>}
        {detail && !detailLoading && <>
          <div className="flex items-start justify-between gap-2"><div><h3 className="font-semibold text-slate-900">{detail.id}</h3>
            <p className="text-sm text-slate-500">{detail.name} · {detail.screeningId || '无关联筛查'}</p></div>
            <AdminAlertBadge level={detail.level} /></div>
          <div className="mt-4 space-y-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            <p><span className="text-slate-500">触发原因：</span>{detail.trigger || '未填写'}</p>
            <p><span className="text-slate-500">描述：</span>{detail.description || '未填写'}</p>
            <p><span className="text-slate-500">量表：</span>{detail.questionnaire || '无关联量表'}</p>
            <p><span className="text-slate-500">得分：</span>{detail.score == null ? '暂无' : detail.score + ' / ' + (detail.maxScore ?? '—')}</p>
            <p><span className="text-slate-500">创建时间：</span>{detail.createdAt}</p>
          </div>
          <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
            <h4 className="font-medium text-slate-900">处置记录</h4>
            {detail.followUpNotes && <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{detail.followUpNotes}</p>}
            <label className="block text-sm text-slate-600">处理状态
              <select className={inputClass + ' mt-1'} value={editStatus}
                onChange={(event) => setEditStatus(event.target.value as AlertRecord['status'])}>
                <option value={detail.status}>{statusLabel[detail.status]}</option>
                {nextStatus[detail.status] &&
                  <option value={nextStatus[detail.status]!}>{statusLabel[nextStatus[detail.status]!]}</option>}
              </select></label>
            <label className="block text-sm text-slate-600">处理人
              <select className={inputClass + ' mt-1'} value={assigneeId ?? ''}
                onChange={(event) => setAssigneeId(event.target.value ? Number(event.target.value) : null)}>
                <option value="">未分配</option>{assignees.map((person) =>
                  <option key={person.id} value={person.id}>{person.name}（{person.role}）</option>)}
              </select></label>
            {assigneeError && <p role="alert" className="text-xs text-rose-700">处理人列表加载失败：{assigneeError}</p>}
            <label className="block text-sm text-slate-600">本次跟进备注
              <textarea className={inputClass + ' mt-1 min-h-24'} value={note} onChange={(event) => setNote(event.target.value)}
                placeholder="记录本次处置；标记已解决时必须填写" /></label>
            {saveError && <p role="alert" className="text-sm text-rose-700">{saveError}</p>}
            {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={save} disabled={!dirty || saving}
                className="rounded-lg bg-sky-700 px-4 py-2 text-sm text-white hover:bg-sky-800 disabled:opacity-40">
                {saving ? '保存中…' : '保存处置'}</button>
              <button type="button" onClick={cancel} disabled={!dirty || saving}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 disabled:opacity-40">取消修改</button>
            </div>
          </div>
          <div className="mt-5 border-t border-slate-100 pt-4">
            <h4 className="font-medium text-slate-900">处理历史</h4>
            {detail.history.length === 0 ? <p className="mt-2 text-sm text-slate-500">暂无处理记录。</p> :
              <ol className="mt-3 space-y-3">{detail.history.map((event) =>
                <li key={event.id} className="border-l-2 border-sky-200 pl-3 text-xs text-slate-600">
                  <p className="font-medium text-slate-800">{statusLabel[event.toStatus as AlertRecord['status']] || event.toStatus} · {event.actor}</p>
                  <p>{event.createdAt}</p>{event.note && <p className="mt-1 whitespace-pre-wrap">{event.note}</p>}
                </li>)}</ol>}
          </div>
        </>}
      </aside>
    </div>
  </div>;
}
