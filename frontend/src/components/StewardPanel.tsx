import ScreeningHistory from './ScreeningHistory';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCurrentSession } from '../auth/session';
import { readChatHistory } from '../services/chatHistory';
import { getToken } from '../services/http';
import { stewardApi, useSteward, type Evidence, type StewardSettings } from '../services/steward';
import { usePageActive } from '../services/pageActivity';

const sourceNames: Record<string, string> = { screening: '量表与多模态筛查', chat: '陪伴聊天', checkin: '每日问询', feedback: '行动效果反馈', manual: '本人补充' };
const defaults: StewardSettings = { enabled: true, screening: true, chat: false, checkin: false, feedback: false, history: true };
const button = 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-primary-50 disabled:opacity-50';
const dateLabel = (value?: string) => !value ? '日期未知' : value.length === 10 ? value : new Date(value).toLocaleDateString('zh-CN', { timeZone:'Asia/Shanghai' });

export default function StewardPanel({ mode = 'summary' }: { mode?: 'summary' | 'settings' | 'profile' | 'actions' | 'records' }) {
  const session = getCurrentSession();
  if (session?.role !== 'user') return null;
  return <PersonalSteward mode={mode} />;
}

function PersonalSteward({ mode }: { mode: string }) {
  const owner=useRef(getCurrentSession()?.username);
  const { data, error } = useSteward();
  const active = usePageActive();
  const [editing, setEditing] = useState(mode === 'settings');
  const [draft, setDraft] = useState<StewardSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [selfReport, setSelfReport] = useState('');
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [showEvidence, setShowEvidence] = useState(mode === 'records');
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [correction, setCorrection] = useState<{ id: string; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const token = getToken();
  useEffect(() => { setDraft(null); setEvidence([]); setNotice(''); setSelected([]); }, [token]);
  useEffect(() => {
    if (!active || !showEvidence || !data?.settings.enabled) { setEvidence([]); return; }
    let alive = true;
    stewardApi.evidence(0,selected).then(items => { if (alive) { setEvidence(items); setHasMore(!selected.length && items.length === 50); } }).catch(() => { if (alive) setNotice('记录依据暂未读取成功，请重试。'); });
    return () => { alive = false; };
  }, [active, showEvidence, data?.version, data?.evidence_count, data?.settings.enabled, selected]);
  const run = async (fn: () => Promise<unknown>, message = '已保存') => {
    if (busy || owner.current !== getCurrentSession()?.username) return;
    setBusy(true); setNotice('');
    try { await fn(); setNotice(message); } catch (e) { setNotice(e instanceof Error ? e.message : '保存失败，请稍后重试'); }
    finally { setBusy(false); }
  };
  const saveSettings = () => run(async () => {
    const authorizedToken=getToken();
    const next = draft ?? data?.settings ?? defaults;
    await stewardApi.settings(next);
    if (getToken() !== authorizedToken) return;
    if (next.enabled && next.chat && next.history) await stewardApi.importHistory(readChatHistory(getCurrentSession()?.username ?? ''));
    setDraft(null); setEditing(false);
  }, '设置已保存，正在后台整理档案。');
  const source = draft ?? data?.settings ?? defaults;
  const enabled = data?.settings.enabled;
  const detail = mode === 'profile';
  const reveal = (ids: string[]) => { setSelected(ids); setShowEvidence(true); };
  const points = (title: string, items?: { text: string; evidence_ids: string[] }[]) => items?.length ? <div className="space-y-2"><h4 className="font-medium text-slate-800">{title}</h4>{items.map((item, i) => <div key={i} className="rounded-xl bg-slate-50 p-3 text-sm"><p>{item.text}</p><button className="mt-1 text-xs text-primary-600" onClick={() => reveal(item.evidence_ids)}>查看依据</button></div>)}</div> : null;

  if (owner.current !== getCurrentSession()?.username) return null;

  return <section className={mode === 'settings' ? 'space-y-4' : 'ui-card space-y-4 p-5'} aria-label={mode === 'settings' ? '心理管家与记忆设置' : '专属心理管家'}>
    {mode !== 'settings' && <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold text-slate-900">{detail ? '适合你的心理建议' : mode === 'actions' ? '为你准备的建议与跟进' : '我的专属心理管家'}</h2><p className="mt-1 text-xs text-slate-500">近期状态看近30天；长期特点由你确认。所有理解都可以纠正。</p></div>
      {enabled && <button className={button} disabled={busy} onClick={() => void run(() => stewardApi.refresh(), '已加入后台更新队列')}>更新分析</button>}
    </div>}
    {error && <p role="status" className="text-sm text-amber-700">{error}</p>}
    {!data && !error && <p className="text-sm text-slate-500">正在读取你的档案…</p>}
    {notice && <p role="status" className="text-sm text-primary-700">{notice}</p>}
    {data && !enabled && !editing && <div className="space-y-3"><p className="text-sm text-slate-600">开启后，我可以结合你允许使用的记录，逐步了解你的近况，给出建议并跟进效果。你可以选择信息来源，也可以随时暂停或清空记忆。</p><button className={button} onClick={() => { setDraft({ ...data.settings, enabled: true }); setEditing(true); }}>选择来源并开启</button></div>}
    {(editing || mode === 'settings') && <div className={mode === 'settings' ? 'space-y-3' : 'space-y-3 rounded-2xl bg-slate-50 p-4'}>
      <h3 className="font-medium">心理管家与记忆设置</h3>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={source.enabled} onChange={e => setDraft({ ...source, enabled: e.target.checked })} />开启心理管家（关闭即暂停分析与使用记忆）</label>
      {(['screening','chat','checkin','feedback'] as const).map(key => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={source[key]} onChange={e => setDraft({ ...source, [key]: e.target.checked })} />允许使用{sourceNames[key]}</label>)}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!source.risk_ai} disabled={!source.screening} onChange={e=>setDraft({...source,risk_ai:e.target.checked})} />允许AI提取筛查线索用于近期综合评估</label>
      <p className="text-xs leading-5 text-slate-500">开启后会将获准的本人筛查原文交给已配置的模型提取线索；最终等级仍由系统规则确定。关闭不影响基础规则汇总。</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={source.history} onChange={e => setDraft({ ...source, history: e.target.checked })} />导入已允许来源的历史记录（本机聊天最多200条，仅本人发言）</label>
      <p className="text-xs text-slate-500">AI 会将选定记录的必要内容交给项目配置的大模型服务分析。关闭某个来源后，该来源及相关派生认识退出后续分析；原始筛查记录保留。</p>
      {source.chat && source.history && <p className="text-xs text-slate-500">历史聊天只导入当前设备保存的本人发言；旧知识图谱中的兴趣线索缺少原文依据，需要你确认后才作为长期记忆。</p>}
      <button className={button} disabled={busy || !data} onClick={saveSettings}>保存选择</button>
      {enabled && <button className={`${button} ml-2`} onClick={() => setConfirmClear(true)}>清空管家记忆</button>}
      {confirmClear && <div className="space-y-2 text-sm"><p>这会清除个人档案和记忆并暂停管家。原始筛查、聊天记录和已接受的计划保留，重新开启后也不会自动记回已忘记的来源。</p><button className={button} disabled={busy} onClick={() => void run(async () => { await stewardApi.clear(); setDraft(null); setConfirmClear(false); })}>确认清空记忆</button><button className={`${button} ml-2`} onClick={() => setConfirmClear(false)}>取消</button></div>}
    </div>}
    {enabled && mode !== 'settings' && <>
      <div className="flex flex-wrap gap-3 text-xs text-slate-500"><span>已纳入 {data.evidence_count} 条本人记录</span><span>档案版本 {data.version}</span><span>{data.status === 'updating' ? '后台更新中，离开页面后仍会继续' : data.status === 'failed' ? '更新暂未完成' : '已完成整理'}</span>{data.updated_at && <span>上次更新：{new Date(data.updated_at).toLocaleString()}</span>}</div>
      {data.error && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{data.error}。已有记录仍保留，可点击“更新档案”重试。</p>}
      {mode !== 'settings' && !detail && <><p className="leading-7 text-slate-700">{data.snapshot.summary ?? '正在等待首次分析；记录较少时，我会明确告诉你还不了解哪些情况。'}</p>{data.snapshot.window_start && <p className="text-xs text-slate-400">分析区间：{data.snapshot.window_start.slice(0,10)} 至 {dateLabel(data.snapshot.window_end)} · {data.snapshot.source === 'ai' ? `AI综合分析，本次选取${data.snapshot.context_count ?? 0}条相关证据` : '记录不足，尚未形成AI分析'}</p>}</>}
      {mode === 'summary' && points('近期观察', data.snapshot.observations)}
      {(detail || mode === 'actions' || mode === 'summary') && <div className="space-y-3">
        {data.suggestions.filter(s => mode === 'actions' ? s.state !== 'dismissed' : s.state === 'suggested').slice(0, mode === 'summary' ? 1 : 20).map(s => <article key={s.id} className="space-y-2 rounded-2xl bg-primary-50/50 p-4"><h4 className="font-medium">{s.title}</h4><p className="text-sm text-slate-600">{s.detail}</p><p className="text-xs text-slate-500">为什么推荐：{s.reason}</p><button className="text-xs text-primary-600" onClick={() => reveal(s.evidence_ids)}>查看依据</button>
          {s.state === 'suggested' ? <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void run(() => stewardApi.suggestion(s.id,'accept'), '已加入行动计划，可在首页查看。')}>加入行动计划</button><button className={button} disabled={busy} onClick={() => setCorrection({id:'suggestion:'+s.id,text:s.title})}>调整标题</button><button className={button} disabled={busy} onClick={() => void run(() => stewardApi.suggestion(s.id,'dismiss'))}>暂不需要</button></div> : <p className="text-sm text-slate-500">已加入行动计划</p>}
        </article>)}
        {correction?.id.startsWith('suggestion:') && <div className="flex flex-wrap gap-2"><input aria-label="调整行动标题" className="rounded-xl border p-2" value={correction.text} onChange={e => setCorrection({...correction,text:e.target.value})} /><button className={button} disabled={busy || !correction.text.trim()} onClick={() => void run(async () => { await stewardApi.suggestion(correction.id.slice(11),'accept',correction.text); setCorrection(null); })}>按此标题加入计划</button></div>}
        {mode === 'actions' && !data.suggestions.length && <p className="text-sm text-slate-500">积累足够记录后，管家会给出有依据的建议。你也可以先在首页添加自己的小计划。</p>}
      </div>}
      {detail && <details className="rounded-xl border border-slate-100 p-3"><summary className="cursor-pointer text-sm font-medium text-slate-600">记忆与依据管理</summary><div className="mt-4 space-y-4">{points('变化与需要核实的差异', data.snapshot.changes)}{points('想进一步了解你', data.snapshot.questions)}
        <div className="space-y-3"><h3 className="font-medium">我的特点与记忆</h3><p className="text-xs text-slate-500">待确认内容只是AI的初步理解；“符合我”后才作为长期认识使用。</p>
          {data.memories.map(m => <article key={m.id} className="space-y-2 rounded-xl border border-slate-100 p-3"><p className="text-sm">{m.content}</p><div className="flex flex-wrap items-center gap-3 text-xs"><span>{m.status === 'confirmed' ? '本人已确认' : '待本人确认'}</span><button className="text-primary-600" onClick={() => reveal(m.evidence_ids)}>依据</button>{m.status !== 'confirmed' && <button disabled={busy} onClick={() => void run(() => stewardApi.memory(m.id, 'confirm'))}>符合我</button>}<button onClick={() => setCorrection({ id: m.id, text: m.content })}>纠正</button><button disabled={busy} onClick={() => void run(() => stewardApi.memory(m.id, 'forget'), '已忘记，并排除相关来源记录；原始筛查保留。')}>忘记并排除来源</button></div></article>)}
          {correction && !correction.id.startsWith('suggestion:') && <div className="space-y-2"><textarea aria-label="纠正记忆" className="w-full rounded-xl border p-3 text-sm" value={correction.text} onChange={e => setCorrection({ ...correction, text: e.target.value })} /><p className="text-xs text-slate-500">错误认识及其来源将退出管家分析，原始记录不会删除。</p><button className={button} disabled={busy || !correction.text.trim()} onClick={() => void run(async () => { await stewardApi.memory(correction.id, 'correct', correction.text); setCorrection(null); })}>保存纠正</button><button className={`${button} ml-2`} onClick={() => setCorrection(null)}>取消</button></div>}
          <textarea aria-label="希望管家记住的事" placeholder="你希望我记住什么？例如你喜欢的陪伴方式、近期目标。" value={selfReport} onChange={e => setSelfReport(e.target.value)} className="w-full rounded-xl border border-slate-200 p-3 text-sm" maxLength={1000} />
          <button className={button} disabled={busy || !selfReport.trim()} onClick={() => void run(async () => { await stewardApi.remember(selfReport); setSelfReport(''); })}>记住这件事</button>
        </div>
      </div></details>}
      {(mode === 'records' || detail) && <ScreeningHistory series={data.series} media={data.multimodal_history} open={mode === 'records'} onEvidence={reveal} />}
      <div className="flex flex-wrap gap-4 text-sm text-primary-600"><Link to="/personal/me/kg">查看心理档案</Link><Link to="/personal/me/feed">建议与行动</Link><button onClick={() => { setDraft(null); setEditing(!editing); }}>记忆设置</button><button onClick={() => { setSelected([]); setShowEvidence(!showEvidence); }}>{showEvidence ? '收起依据' : '查看记录依据'}</button></div>
      {showEvidence && <div className="max-h-96 space-y-3 overflow-auto rounded-xl bg-slate-50 p-3"><h3 className="font-medium">本人记录依据</h3>{!evidence.length && <p className="text-sm text-slate-500">暂无获准使用的记录。</p>}{evidence.filter(e => !selected.length || selected.includes(e.id)).map(e => <article key={e.id} className="rounded-xl bg-white p-3"><p className="text-xs text-slate-400">{sourceNames[e.source] ?? e.source} · {dateLabel(e.occurred_at)}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{e.body}</p><button className="mt-2 text-xs text-primary-600" disabled={busy} onClick={() => void run(() => stewardApi.forget(e.id), '已从管家中排除此来源，原始记录保留。')}>不再用于管家分析</button></article>)}{hasMore && <button className={button} onClick={() => void run(async () => { const more = await stewardApi.evidence(evidence.length); setEvidence(prev => [...prev,...more]); setHasMore(more.length === 50); }, '')}>加载更多依据</button>}</div>}
    </>}
  </section>;
}
