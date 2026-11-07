import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Search, ShieldAlert } from 'lucide-react';
import {
  getAdminAlert, listAdminAlerts, listAdminAssignees, updateAdminAlert, USE_MOCK,
  type AdminAlertDetail, type Assignee, type Page,
} from '../../services/adminApi';
import type { AlertRecord } from '../data/adminMockData';
import AdminAlertBadge from '../components/AdminAlertBadge';
import AdminStatusBadge from '../components/AdminStatusBadge';
import { MasterDetail, DetailPanel } from '../../components/MasterDetail';

const nextStatus: Record<AlertRecord['status'], AlertRecord['status'] | null> = {
  pending: 'processing', processing: 'resolved', resolved: 'closed', closed: null,
};
const statusLabel: Record<AlertRecord['status'], string> = {
  pending: '待处理', processing: '处理中', resolved: '已解决', closed: '已关闭',
};
const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';

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
  /** 点了 × 之后收起成一张小卡，点小卡展开（不清空选择） */
  const [detailCollapsed, setDetailCollapsed] = useState(false);

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

  /* 默认选中列表第一条：右侧首屏就有内容，不必先点一下才知道这里会显示东西。 */
  useEffect(() => {
    const first = result?.items[0];
    if (!first) return;
    if (!selectedId || !result?.items.some((item) => item.id === selectedId)) choose(first.id);
    // choose 是稳定的一次性动作，这里只跟随列表结果变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  function choose(id: string) {
    setSelectedId(id); setDetail(null); setDetailLoading(true);
    setDetailCollapsed(false); setNotice(''); setSaveError('');
  }

  /** 筛选/翻页：重新拉列表，选中项若不在新结果里会自动顺延到第一条 */
  function resetAutoSelect() {
    setListLoading(true);
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
  const selectedRow = result?.items.find((item) => item.id === selectedId);

  return <div className="space-y-5">
    {/* 这一块以前又渲染了一遍「预警管理」大标题 + 说明，和外壳的页头
        （管理端 · 健康管理 / 预警管理 / 查看风险变化…）叠成两层。
        外壳那层带面包屑、两端页面统一，所以这里只留筛选与“演示数据”标记；
        标记收进卡头，不再单独占一行。 */}
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-600">筛选预警</p>
        {USE_MOCK && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">演示数据，操作仅在本页有效</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
      <label className="relative">
        <span className="sr-only">搜索姓名或预警编号</span>
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input className={inputClass + ' pl-9'} value={keyword} onChange={(event) => { setKeyword(event.target.value); setPage(1); resetAutoSelect(); }}
          placeholder="搜索姓名或预警编号" />
      </label>
      <label><span className="sr-only">风险等级</span><select className={inputClass} value={level}
        onChange={(event) => { setLevel(event.target.value); setPage(1); resetAutoSelect(); }}>
        <option value="">全部风险等级</option><option value="red">红色</option><option value="orange">橙色</option>
        <option value="yellow">黄色</option><option value="green">绿色</option>
      </select></label>
      <label><span className="sr-only">处理状态</span><select className={inputClass} value={status}
        onChange={(event) => { setStatus(event.target.value); setPage(1); resetAutoSelect(); }}>
        <option value="">全部处理状态</option>{Object.entries(statusLabel).map(([value, label]) =>
          <option key={value} value={value}>{label}</option>)}
      </select></label>
      </div>
    </div>
    {listError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
      预警列表加载失败：{listError} <button type="button" className="ml-2 underline"
        onClick={() => { setListLoading(true); setReload((value) => value + 1); }}>重试</button>
    </div>}
    <MasterDetail
      width="md"
      list={
        <div className="space-y-3">
          {listLoading && <div className="space-y-3" role="status" aria-label="正在加载预警">
            {[0, 1, 2].map((i) => <div key={i} className="h-[112px] animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
          </div>}
          {!listLoading && result?.items.length === 0 &&
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">当前条件下没有预警记录。</div>}
          {!listLoading && result?.items.map((alert) =>
            <button type="button" key={alert.id} onClick={() => choose(alert.id)}
              aria-pressed={selectedId === alert.id}
              className={'w-full cursor-pointer rounded-2xl border bg-white p-4 text-left shadow-sm transition ' +
                (selectedId === alert.id ? 'border-primary-500 ring-1 ring-primary-200' : 'border-slate-200 hover:border-primary-300 hover:shadow')}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-2"><AdminAlertBadge level={alert.level} />
                  <div><p className="font-medium text-slate-900">{alert.name || '未填写姓名'}</p>
                    <p className="text-xs text-slate-500">{alert.id} · {alert.screeningId || '无关联筛查'}</p></div></div>
                <AdminStatusBadge status={alert.status} />
              </div>
              <p className="mt-3 text-sm text-slate-600">{alert.trigger || alert.description || '无触发说明'}</p>
              <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                <span>{alert.createdAt} · {alert.assignee}</span>
                <span className="inline-flex items-center gap-0.5 font-medium text-primary-600">
                  {selectedId === alert.id && !detailCollapsed ? '正在处理' : '查看详情'}<ChevronRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </button>)}
          {!listLoading && result && result.total > 0 && <div className="flex items-center justify-between text-sm text-slate-500">
            <span>共 {result.total} 条 · 第 {page} 页</span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => { setPage((value) => value - 1); resetAutoSelect(); }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1 disabled:opacity-40">上一页</button>
              <button type="button" disabled={!hasMore} onClick={() => { setPage((value) => value + 1); resetAutoSelect(); }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1 disabled:opacity-40">下一页</button>
            </div>
          </div>}
        </div>
      }
      detail={
        <DetailPanel
          selectionKey={selectedId}
          title={selectedId ?? '预警详情'}
          subtitle={detail ? `${detail.name} · ${detail.screeningId || '无关联筛查'}` : selectedRow ? `${selectedRow.name} · ${selectedRow.screeningId || '无关联筛查'}` : undefined}
          meta={detail ? <AdminAlertBadge level={detail.level} /> : selectedRow ? <AdminAlertBadge level={selectedRow.level} /> : undefined}
          collapsed={detailCollapsed}
          onExpand={() => setDetailCollapsed(false)}
          onClose={() => setDetailCollapsed(true)}
          loading={detailLoading}
          error={detailError}
          emptyIcon={<ShieldAlert className="h-6 w-6" />}
          emptyTitle={result && result.total === 0 ? '没有可查看的预警' : '选择一条预警查看详情并处理'}
          emptyDescription="左侧列表里每一条都能点开：查看触发原因与补充说明，分配处理人，并记录处置过程。"
        >
          {detail && !detailLoading && <>
            <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
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
                  className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-40">
                  {saving ? '保存中…' : '保存处置'}</button>
                <button type="button" onClick={cancel} disabled={!dirty || saving}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 disabled:opacity-40">取消修改</button>
              </div>
            </div>
            <div className="mt-5 border-t border-slate-100 pt-4">
              <h4 className="font-medium text-slate-900">处理历史</h4>
              {detail.history.length === 0 ? <p className="mt-2 text-sm text-slate-500">暂无处理记录。</p> :
                <ol className="mt-3 space-y-3">{detail.history.map((event) =>
                  <li key={event.id} className="border-l-2 border-primary-200 pl-3 text-xs text-slate-600">
                    <p className="font-medium text-slate-800">{statusLabel[event.toStatus as AlertRecord['status']] || event.toStatus} · {event.actor}</p>
                    <p>{event.createdAt}</p>{event.note && <p className="mt-1 whitespace-pre-wrap">{event.note}</p>}
                  </li>)}</ol>}
            </div>
          </>}
        </DetailPanel>
      }
    />
  </div>;
}
