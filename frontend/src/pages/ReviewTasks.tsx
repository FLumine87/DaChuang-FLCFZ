import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import QuestionnaireForm from '../components/QuestionnaireForm';
import { personalReviews, acknowledgeReview, submitReview, reviewStates, type ReviewRequest } from '../services/reviewRequestsApi';
import { USE_MOCK } from '../services/http';

export default function ReviewTasks() {
  const [items, setItems] = useState<ReviewRequest[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<ReviewRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    personalReviews().then((value) => { if (active) { setItems(value); setError(''); } })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '读取失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  async function acknowledge(item: ReviewRequest) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await acknowledgeReview(item.id);
      setNotice('已确认收到；完成问卷后仍需工作人员复核。'); setReload((n) => n + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '确认失败'); }
    finally { lock.current = false; setBusy(false); }
  }
  if (selected) return <div className="space-y-4">
    <p className="text-sm text-slate-600">{selected.title} · {selected.instructions}</p>
    <QuestionnaireForm questionnaireId={selected.questionnaire} onClose={() => setSelected(null)}
      onComplete={async (_score, _max, _level, answers) => {
        await submitReview(selected.id, answers);
        setSelected(null); setNotice('复查已提交，等待工作人员复核。'); setReload((n) => n + 1);
      }} />
  </div>;
  return <section className="space-y-4">
    <div className="flex items-center justify-between"><h2 className="text-xl font-semibold">我的复查任务</h2>
      <button className="ui-button" onClick={() => { setLoading(true); setReload((n) => n + 1); }}>刷新任务</button></div>
    <p className="text-sm text-slate-500">查看工作人员发来的说明。确认收到不等于完成复查。</p>
    {USE_MOCK && <p className="text-sm text-amber-700">演示模式没有真实任务，请连接后端。</p>}
    {loading && <p role="status">正在加载任务…</p>}
    {notice && <p role="status" className="text-emerald-700">{notice}</p>}
    {error && <p role="alert" className="text-rose-700">{error}</p>}
    {!loading && !error && !items.length && <p className="ui-card p-6 text-slate-500">暂时没有复查任务。</p>}
    {items.map((item) => <article key={item.id} className="ui-card space-y-3 p-5">
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{item.title}</h3><span className="text-sm text-primary-600">{reviewStates[item.status]}</span></div>
      <p className="whitespace-pre-wrap text-sm text-slate-600">{item.instructions}</p>
      <p className="text-xs text-slate-500">{item.questionnaire} · 计划日期 {item.due_at}</p>
      <div className="flex flex-wrap gap-3">
        {item.status === 'sent' && <button className="ui-button" disabled={busy} onClick={() => void acknowledge(item)}>确认收到</button>}
        {['sent', 'acknowledged'].includes(item.status) && <button className="ui-button ui-button-primary" onClick={() => setSelected(item)}>开始复查</button>}
        {item.screening_id && <Link className="text-sm text-primary-600 hover:underline" to={`/personal/screening?record=${encodeURIComponent(item.screening_id)}`}>查看本次筛查记录 →</Link>}
      </div>
    </article>)}
  </section>;
}
