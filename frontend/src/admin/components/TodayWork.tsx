import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getWorkQueue, USE_MOCK, type WorkQueue } from '../../services/adminApi';

const states: Record<string, string> = { proposed: '待审核', confirmed: '已分配', modified: '执行中' };
export default function TodayWork() {
  const [data, setData] = useState<WorkQueue | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState('all');
  useEffect(() => {
    let active = true;
    getWorkQueue().then((value) => { if (active) { setData(value); setError(''); } })
      .catch((reason: unknown) => { if (active) { setData(null); setError(reason instanceof Error ? reason.message : '读取失败'); } });
    return () => { active = false; };
  }, [reload]);
  const tasks = data?.tasks.filter((task) => filter === 'all' ||
    (filter === 'overdue' ? task.due_at < data.date :
      filter === 'today' ? task.due_at === data.date : task.state === 'proposed')) || [];
  return <section className="ui-card space-y-4 p-5" aria-label="今日工作">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold text-slate-800">今日工作</h2>
        <p className="text-xs text-slate-500">{USE_MOCK ? '演示模式未读取实际待办' : '业务任务 · 期限按北京时间日期统计'} {data?.date}</p></div>
      <button className="ui-button" onClick={() => setReload((n) => n + 1)}>刷新待办</button>
    </div>
    {error && <p role="alert" className="text-rose-700">待办加载失败：{error}</p>}
    {!data && !error && <p role="status">正在加载待办…</p>}
    {data && <>
      <div className="grid gap-3 sm:grid-cols-4">
        <Link className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700" to="/admin/alerts">待分配预警 <strong>{data.unassignedAlerts}</strong></Link>
        <button className="rounded-xl bg-slate-50 p-3 text-left text-sm" onClick={() => setFilter('review')}>待审核草案 <strong>{data.pendingReview}</strong></button>
        <button className="rounded-xl bg-slate-50 p-3 text-left text-sm" onClick={() => setFilter('today')}>今天到期 <strong>{data.dueToday}</strong></button>
        <button className="rounded-xl bg-amber-50 p-3 text-left text-sm" onClick={() => setFilter('overdue')}>已逾期 <strong>{data.overdue}</strong></button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label>任务范围 <select aria-label="任务范围" className="rounded-lg border border-slate-200 p-1" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">全部未完成</option><option value="review">待审核</option><option value="today">今天到期</option><option value="overdue">已逾期</option>
        </select></label>
        <Link className="text-primary-600 hover:underline" to="/admin/agent-workbench?scope=live&tab=tasks">进入业务随访处置 →</Link>
      </div>
      {!tasks.length ? <p className="text-sm text-slate-500">当前范围没有待办任务。</p> :
        <ul className="divide-y divide-slate-100">{tasks.map((task) => <li key={task.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
          <div><p className="font-medium text-slate-800">{task.title}</p><p className="text-xs text-slate-500">{states[task.state] || task.state} · {task.assignee || '待分配'} · 计划 {task.due_at}</p></div>
          {task.caseId ? <Link className="text-primary-600 hover:underline" to={`/admin/cases?case=${encodeURIComponent(task.caseId)}`}>查看案例 →</Link> :
            <Link className="text-primary-600" to="/admin/agent-workbench?scope=live&tab=tasks">查看任务 →</Link>}
        </li>)}</ul>}
    </>}
  </section>;
}
