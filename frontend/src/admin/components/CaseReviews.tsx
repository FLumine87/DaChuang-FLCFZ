import { useEffect, useRef, useState } from 'react';
import { staffReviews, sendReview, staffReviewAction, reviewStates, type ReviewRequest } from '../../services/reviewRequestsApi';
import { USE_MOCK } from '../../services/http';

interface Task { id: string; title: string; state: string; due_at: string }
export default function CaseReviews({ caseId, recipient, tasks }: { caseId: string; recipient: string; tasks: Task[] }) {
  const [items, setItems] = useState<ReviewRequest[]>([]);
  const [reload, setReload] = useState(0);
  const [task, setTask] = useState('');
  const [title, setTitle] = useState('请完成一次复查问卷');
  const [instructions, setInstructions] = useState('');
  const [questionnaire, setQuestionnaire] = useState('PHQ-9');
  const [due, setDue] = useState('');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<{ item: ReviewRequest; action: 'review' | 'cancel' } | null>(null);
  const [note, setNote] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    let pending = false;
    async function refresh() {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try { const value = await staffReviews(caseId); if (active) { setItems(value); setError(''); } }
      catch (reason) { if (active) setError(reason instanceof Error ? reason.message : '读取失败'); }
      finally { pending = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [caseId, reload]);
  async function act(work: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await work(); setPreview(false); setSelected(null); setNote(''); setNotice('操作已保存'); setReload((n) => n + 1); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败'); }
    finally { lock.current = false; setBusy(false); }
  }
  const eligible = tasks.filter((item) => ['confirmed', 'modified'].includes(item.state) && !items.some((sent) => sent.source_task_id === item.id));
  return <section className="mt-5 space-y-3 border-t border-slate-100 pt-4" aria-label="复查发送与反馈">
    <div className="flex items-center justify-between gap-2"><h4 className="font-medium">复查发送与反馈</h4>
      <button className="ui-button" disabled={busy} onClick={() => setReload((n) => n + 1)}>刷新复查状态</button></div>
    <p className="text-xs text-slate-500">只发送下方明确填写的内容，内部备注不会发给个人。</p>
    {error && <p role="alert" className="text-sm text-rose-700">{error} <button className="underline" onClick={() => setReload((n) => n + 1)}>刷新</button></p>}
    {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    {items.map((item) => <div key={item.id} className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
      <p className="font-medium">{item.title} · {reviewStates[item.status]}</p>
      <p className="whitespace-pre-wrap">{item.instructions}</p><p className="text-xs text-slate-500">{item.questionnaire} · {item.due_at}</p>
      {item.screening_id && <p className="text-sm">复查得分：{item.score ?? '—'} / {item.max_score ?? '—'} · 记录 {item.screening_id}</p>}
      {item.review_notes && <p className="text-xs text-slate-500">内部记录：{item.review_notes}</p>}
      {item.status === 'submitted' && <button className="ui-button" disabled={busy} onClick={() => setSelected({ item, action: 'review' })}>记录复核</button>}
      {['sent', 'acknowledged'].includes(item.status) && <button className="ui-button" disabled={busy} onClick={() => setSelected({ item, action: 'cancel' })}>取消复查任务</button>}
    </div>)}
    {selected && <div className="space-y-2 rounded-lg border border-slate-200 p-3">
      <label className="block text-sm">内部处理记录<textarea aria-label="内部处理记录" className="ui-input w-full" maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <button className="ui-button" disabled={busy || !note.trim()} onClick={() => void act(() => staffReviewAction(selected.item, selected.action, note))}>确认保存复核操作</button>
      <button className="ui-button" disabled={busy} onClick={() => { setSelected(null); setNote(''); }}>放弃操作</button>
    </div>}
    {!USE_MOCK && eligible.length > 0 ? <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); setPreview(true); }}>
      <label className="block text-sm">已审核的跟进任务<select aria-label="已审核的跟进任务" required className="ui-input w-full" value={task} onChange={(event) => {
        setTask(event.target.value); setDue(tasks.find((item) => item.id === event.target.value)?.due_at || ''); setPreview(false);
      }}><option value="">选择已分配任务</option>{eligible.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
      <label className="block text-sm">发给个人的标题<input aria-label="发给个人的标题" required maxLength={180} className="ui-input w-full" value={title} onChange={(event) => { setTitle(event.target.value); setPreview(false); }} /></label>
      <label className="block text-sm">发给个人的说明<textarea aria-label="发给个人的说明" required maxLength={2000} className="ui-input w-full" value={instructions} onChange={(event) => { setInstructions(event.target.value); setPreview(false); }} /></label>
      <label className="block text-sm">复查量表<select aria-label="复查量表" className="ui-input w-full" value={questionnaire} onChange={(event) => { setQuestionnaire(event.target.value); setPreview(false); }}>
        {['PHQ-9', 'GAD-7', 'ISI', 'PSS-10'].map((code) => <option key={code}>{code}</option>)}</select></label>
      <label className="block text-sm">复查计划日期<input aria-label="复查计划日期" type="date" required className="ui-input w-full" value={due} onChange={(event) => { setDue(event.target.value); setPreview(false); }} /></label>
      <button className="ui-button" disabled={busy}>预览发送内容</button>
      {preview && <div className="space-y-2 rounded-lg border border-primary-200 p-3">
        <p className="text-sm font-medium">将发送给：{recipient}</p><p>{title}</p><p className="whitespace-pre-wrap text-sm">{instructions}</p>
        <p className="text-xs">{questionnaire} · {due}</p>
        <button type="button" className="ui-button" disabled={busy} onClick={() => void act(() => sendReview({ task_id: task, title, instructions, questionnaire, due_at: due }))}>确认发送给个人</button>
        <button type="button" className="ui-button" disabled={busy} onClick={() => setPreview(false)}>取消发送</button>
      </div>}
    </form> : <p className="text-xs text-slate-500">请先在 Agent 工作台审核并分配业务任务，才能向个人发送复查。</p>}
  </section>;
}
