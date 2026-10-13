import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, ArrowRight, Check, ChevronRight, ClipboardCheck, FileText, Image,
  Loader2, Mic, Play, Search, ShieldCheck, Users, X } from 'lucide-react';
import { analyseCase, loadCase, loadWorkspace, saveTask, startRun, type CaseDetail, type Scope,
  type Subject, type Task, type Workspace } from '../../services/workspaceApi';
import './agent-workspace.css';

const levels: Record<string, string> = { red: '优先复核', orange: '需要复核', yellow: '持续关注', green: '常规关注' };
const states: Record<string, string> = { proposed: '待审核', confirmed: '已分配', modified: '已调整', completed: '已完成', rejected: '已拒绝' };
const actions: Record<string, string> = { confirm: '确认并分配', modify: '修改并分配', reject: '拒绝草案', complete: '完成任务', followup: '记录随访' };
function message(e: unknown) { return e instanceof Error ? e.message : '请求失败，请重试'; }
function date(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }); }
function assetPath(value?: string) { return value?.startsWith('/') ? import.meta.env.BASE_URL.replace(/\/$/, '') + value : value; }
function dialogKeys(event: KeyboardEvent<HTMLElement>, close: () => void) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  if (event.key !== 'Tab') return;
  const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href],audio[controls]'));
  const first = nodes[0], last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}

export default function AgentWorkspaceV2() {
  const [searchParams] = useSearchParams();
  const [scope, setScope] = useState<Scope>(searchParams.get('caseId') ? 'live' : 'demo');
  const [tab, setTab] = useState('overview');
  const [days, setDays] = useState(30);
  const [department, setDepartment] = useState('all');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [caseBusy, setCaseBusy] = useState(false);
  const [editing, setEditing] = useState<{ task: Task; action: string } | null>(null);
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const detailGeneration = useRef(0);
  const dialogOrigin = useRef<HTMLElement | null>(null);
  const run = workspace?.latest_run;

  useEffect(() => {
    if (!detailOpen || editing) return;
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        ++detailGeneration.current; setDetailOpen(false); dialogOrigin.current?.focus();
      } else if (event.key === 'Tab') {
        const drawer = document.querySelector('.aw-drawer');
        if (drawer && !drawer.contains(document.activeElement)) {
          event.preventDefault(); drawer.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [detailOpen, editing]);

  useEffect(() => {
    let disposed = false;
    const id = ++generation.current;
    setLoading(true); setError(''); setWorkspace(null); setDetailOpen(false);
    ++detailGeneration.current;
    loadWorkspace(scope).then(data => { if (!disposed && id === generation.current) setWorkspace(data); })
      .catch(e => { if (!disposed) setError(message(e)); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [scope]);

  useEffect(() => {
    const subject = searchParams.get('caseId');
    if (!subject) return;
    let disposed = false;
    setDetailOpen(true); setDetailError(''); setDetail(null);
    loadCase('live', subject).then(data => { if (!disposed) setDetail(data); })
      .catch(e => { if (!disposed) setDetailError(message(e)); });
    return () => { disposed = true; };
  }, [searchParams]);

  const analyse = async () => {
    const id = generation.current;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await startRun(scope, days, department);
      if (id === generation.current) { setWorkspace(result); setTab('overview'); setNotice('本次研判已保存，任务草案等待人工审核。'); }
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  const openCase = async (subject: string) => {
    dialogOrigin.current = document.activeElement as HTMLElement;
    const id = ++detailGeneration.current;
    setDetailOpen(true); setDetail(null); setDetailError('');
    try { const data = await loadCase(scope, subject); if (id === detailGeneration.current) setDetail(data); }
    catch (e) { if (id === detailGeneration.current) setDetailError(message(e)); }
  };
  const closeCase = () => { ++detailGeneration.current; setDetailOpen(false); dialogOrigin.current?.focus(); };
  const runIndividual = async () => {
    if (!detail) return;
    const id = detailGeneration.current;
    setCaseBusy(true); setDetailError('');
    try {
      const result = await analyseCase(scope, detail.subject);
      if (id === detailGeneration.current) setDetail(result);
      const refreshed = await loadWorkspace(scope);
      if (id === detailGeneration.current) setWorkspace(refreshed);
    } catch (e) { if (id === detailGeneration.current) setDetailError(message(e)); }
    finally { setCaseBusy(false); }
  };
  const saved = (task: Task) => {
    setWorkspace(current => current && ({ ...current, tasks: current.tasks.map(t => t.id === task.id ? task : t) }));
    setDetail(current => current && ({ ...current, tasks: current.tasks.map(t => t.id === task.id ? task : t) }));
    setEditing(null); setNotice('处理结果已保存到后端，刷新页面仍可查看。');
  };
  const subjects = (run?.subjects || []).filter(s => s.alert_level !== 'green' && `${s.ref} ${s.department}`.includes(keyword));
  const pending = workspace?.tasks.filter(t => t.state === 'proposed').length || 0;
  const active = workspace?.tasks.filter(t => ['confirmed', 'modified'].includes(t.state)).length || 0;

  return <div className="aw">
    {/* 页头不再重复渲染标题与面包屑：AppShell 已经为这条路由输出
        眉标（管理端 · 智能分析）、页面标题「预警处置工作台」、说明与面包屑。
        这一行只保留页面自己的状态指示——它必须留着，因为它是"当前并非真实 AI 接入"
        的唯一提示。 */}
    <div className="aw-heading"><span className="aw-mode"><span />工作流预览 · AI 未接入</span></div>
    <div className="aw-toolbar">
      <label>数据来源<select disabled={busy} value={scope} onChange={e => { setScope(e.target.value as Scope); setDepartment('all'); }}><option value="demo">合成演示数据</option><option value="live">本地业务数据</option></select></label>
      <label>观察窗口<select disabled={busy} value={days} onChange={e => setDays(Number(e.target.value))}><option value={7}>最近 7 天</option><option value={30}>最近 30 天</option><option value={90}>最近 90 天</option></select></label>
      <label>院系范围<select disabled={busy} value={department} onChange={e => setDepartment(e.target.value)}><option value="all">全部院系</option>{(workspace?.departments || []).map(d => <option key={d}>{d}</option>)}</select></label>
      <button className="aw-primary" disabled={busy || loading} onClick={analyse}>{busy ? <Loader2 className="aw-spin" size={16} /> : <Play size={16} />} {busy ? '正在运行工具与生成任务…' : '启动群体研判'}</button>
    </div>
    <p className="aw-source">{scope === 'demo' ? '演示空间：24 个虚构案例，观察基准日 2026-10-13；与业务数据完全分开。' : '业务空间：仅分析已完成筛查。缺少案例关联的记录按独立筛查计数，不自动匹配姓名。'}</p>
    {error && <div className="aw-error" role="alert">{error}<button onClick={() => window.location.reload()}>重新加载</button></div>}
    {notice && <div className="aw-notice" role="status"><Check size={15} />{notice}</div>}
    <div className="aw-tabs" role="group" aria-label="工作台视图">
      {[['overview', '群体研判', Users], ['trace', '协作记录', Activity], ['tasks', `随访处置 · ${pending + active}`, ClipboardCheck]].map(([id, label, Icon]) => {
        const I = Icon as typeof Users;
        return <button key={String(id)} aria-pressed={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(String(id))}><I size={16} />{String(label)}</button>;
      })}<span className="aw-save">{run ? `上次运行 ${date(run.created_at)}` : '尚未生成研判'}</span>
    </div>
    {loading ? <div className="aw-empty"><Loader2 className="aw-spin" />正在读取工作台…</div> : <>
      {tab === 'overview' && (run ? <>
        <div className="aw-summary-grid">
          <section className="aw-report"><div className="aw-section-title"><span className="aw-icon"><Activity size={18} /></span><h3>本次群体观察</h3><span className="aw-tag">已保存</span></div>
            <p className="aw-conclusion">{run.summary}</p>
            <div className="aw-metrics"><div><strong>{run.total}</strong><span>分析对象</span></div><div><strong>{run.records}</strong><span>完成筛查</span></div><div><strong className="aw-red">{run.priority_count}</strong><span>待关注对象</span></div><div><strong>{pending}</strong><span>待审核任务</span></div></div>
            <p className="aw-footnote">报告范围：{run.department === 'all' ? '全部院系' : run.department} / {run.days} 天 · 待审核任务为整个数据空间统计</p>
          </section>
          <section className="aw-distribution"><h3>预警分布</h3><p>依据已记录预警等级</p>
            {Object.keys(levels).map(level => <div className="aw-bar-row" key={level}><span><i className={`aw-dot ${level}`} />{levels[level]}</span><div className="aw-bar-track"><div className={level} style={{ width: `${(run.distribution[level] || 0) / Math.max(1, run.total) * 100}%` }} /></div><b>{run.distribution[level] || 0}</b></div>)}
            <small>{run.unlinked_count ? `${run.unlinked_count} 条记录缺少案例关联` : '当前范围内的对象已有稳定关联'}</small>
          </section>
        </div>
        <section className="aw-list"><div className="aw-list-heading"><div><h3>重点复核名单 <span>{run.priority_count}</span></h3><p>按已有预警等级和同量表变化排序，点击进入个人档案。</p></div><label className="aw-search"><Search size={16} /><input aria-label="搜索案例或院系" placeholder="搜索案例或院系" value={keyword} onChange={e => setKeyword(e.target.value)} /></label></div>
          <div className="aw-table-wrap"><table><thead><tr><th>案例 / 所属院系</th><th>当前关注级别</th><th>量表与趋势</th><th>复核依据</th><th>资料</th><th>操作</th></tr></thead><tbody>{subjects.map(s => <tr key={s.subject}>
            <td><strong>{s.ref}</strong><small>{s.department}</small></td><td><Level value={s.alert_level} /></td><td>{s.score}/{s.max_score}<small>{s.delta === null ? '暂无可比历史' : `较上次 ${s.delta > 0 ? '+' : ''}${s.delta} 分`}</small></td>
            <td><span className="aw-reason">{s.reasons.join('；')}</span></td><td><MediaIcons media={s.media} /></td><td><button className="aw-link" onClick={() => openCase(s.subject)}>查看档案<ChevronRight size={14} /></button></td>
          </tr>)}</tbody></table></div>{!subjects.length && <div className="aw-empty">没有符合条件的案例。调整范围后重新分析。</div>}
        </section>
      </> : <div className="aw-start"><span className="aw-icon"><Users /></span><h3>从一批筛查，开始一次有依据的研判</h3><p>选择数据与观察窗口，工作流将依次整理证据、统计群体特征、筛选复核对象并生成任务草案。</p><button className="aw-primary" onClick={analyse} disabled={busy}><Play size={16} />启动群体研判</button><small>当前数据源可用对象：{workspace?.available_subjects ?? 0}</small></div>)}
      {tab === 'trace' && <section className="aw-trace"><h3>每一步处理，都可以回看</h3><p>以下为后端实际完成的工具调用记录。当前未运行大模型自主规划。</p>
        {run?.trace.map((step, i) => <article key={step.tool}><span className="aw-step">{i + 1}</span><div><h4>{step.agent}<span className="aw-tag">已完成</span></h4><p>{step.summary}</p><code>{step.tool}</code><small>{date(step.at)}</small></div><Check size={18} /></article>)}
        {!run && <div className="aw-empty">启动一次研判后，这里将显示执行记录。</div>}
        {run && <details><summary>数据边界与不足</summary>{run.limits.map(l => <p key={l}>{l}</p>)}</details>}
      </section>}
      {tab === 'tasks' && <section className="aw-tasks"><div className="aw-list-heading"><div><h3>随访处置</h3><p>{pending} 条待审核 · {active} 条执行中。所有处理记录保存在后端。</p></div></div>
        {workspace?.tasks.map(task => <TaskCard key={task.id} task={task} onAction={action => setEditing({ task, action })} onCase={() => openCase(task.subject)} />)}
        {!workspace?.tasks.length && <div className="aw-empty">暂无任务。完成一次研判后，在此审核任务草案。</div>}
      </section>}
    </>}
    {detailOpen && <div className="aw-overlay" onClick={closeCase}><section className="aw-drawer" role="dialog" aria-modal="true" aria-label="个人研判档案" onKeyDown={e => dialogKeys(e, closeCase)} onClick={e => e.stopPropagation()}><button autoFocus className="aw-close" aria-label="关闭档案" onClick={closeCase}><X /></button>
      {detailError ? <div role="alert" className="aw-error">{detailError}</div> : !detail ? <div className="aw-empty"><Loader2 className="aw-spin" />正在读取档案…</div> : <>
        <p className="aw-breadcrumb">个人档案 / 证据与处置</p><h2>{detail.ref}</h2><div className="aw-case-meta"><Level value={detail.alert_level} /><span>{detail.department}</span><span>{detail.questionnaire}</span></div>
        <div className="aw-case-lead"><ShieldCheck size={24} /><div><h3>建议由授权工作人员复核</h3><p>{detail.reasons.join('；')}。该结论沿用已记录预警等级。</p></div></div>
        <h3>筛查时间线</h3><div className="aw-history">{detail.history.map(h => <div key={h.id}><span className="aw-history-dot" /><div><strong>{h.score} <small>/ {h.max_score}</small></strong><p>{h.questionnaire}</p><small>{date(h.date)}</small></div></div>)}</div>
        <section className="aw-individual"><button className="aw-primary" disabled={caseBusy} onClick={runIndividual}>{caseBusy ? <Loader2 className="aw-spin" size={16} /> : <Play size={16} />}{caseBusy ? '正在研判…' : '运行个案研判'}</button>
          {detail.assessment && <div><h3>个案研判记录</h3><p>{detail.assessment.summary}</p><p>{detail.assessment.recommendation}</p><small>保存于 {date(detail.assessment.created_at)} · AI 未接入</small><details><summary>工具执行与证据边界</summary>{detail.assessment.trace.map(step => <p key={step.tool}>{step.summary} <code>{step.tool}</code></p>)}{detail.assessment.limits.map(limit => <p key={limit}>{limit}</p>)}</details></div>}
        </section>
        <h3>多模态资料</h3><p className="aw-muted">用于展示材料与核查来源，不从表情或声音直接推断心理状态。</p>
        <div className="aw-materials">{detail.materials.map(m => <article key={m.kind}><h4>{m.kind === 'text' ? <FileText size={16} /> : m.kind === 'audio' ? <Mic size={16} /> : <Image size={16} />}{m.title}</h4>
          {m.text && <p>{m.text}</p>}{m.kind === 'audio' && <audio controls preload="none" src={assetPath(m.url)}>当前浏览器不支持音频播放。</audio>}
          {m.kind === 'image' && <img src={assetPath(m.url)} alt="演示日程记录卡，无真人照片" />}<small>{m.source}</small></article>)}</div>
        {!detail.materials.length && <p className="aw-no-data">暂无可展示的三模态材料。不会用其他人的素材补成该案例的证据。</p>}
        <details className="aw-evidence"><summary>查看研判依据与数据缺口</summary><p>引用筛查记录：{detail.evidence_ids.join('、')}</p>{detail.missing.map(m => <p key={m}>{m}</p>)}</details>
        <h3>处置与随访</h3>{detail.tasks.map(task => <TaskCard key={task.id} task={task} onAction={action => setEditing({ task, action })} />)}
        {!detail.tasks.length && <p className="aw-no-data">该案例暂无处置草案，运行群体研判后生成。</p>}
      </>}
    </section></div>}
    {editing && <TaskEditor task={editing.task} action={editing.action} onClose={() => setEditing(null)} onSaved={saved} />}
  </div>;
}

function Level({ value }: { value: string }) { return <span className={`aw-level ${value}`}><i />{levels[value] || '待核实'}</span>; }
function MediaIcons({ media }: { media: Subject['media'] }) { return <span className="aw-media">{[[FileText, 'text', '文本'], [Mic, 'audio', '语音'], [Image, 'image', '图像']].map(([Icon, key, title]) => { const I = Icon as typeof FileText; return <span key={String(key)} title={`${title}${media.includes(String(key)) ? '材料已登记' : '暂无材料'}`} className={media.includes(String(key)) ? 'present' : ''}><I size={15} /></span>; })}</span>; }
function TaskCard({ task, onAction, onCase }: { task: Task; onAction: (action: string) => void; onCase?: () => void }) {
  return <article className="aw-task"><div className="aw-task-top"><span className={`aw-task-state ${task.state}`}>{states[task.state] || task.state}</span><strong>{task.title}</strong>{onCase && <button className="aw-link" onClick={onCase}>个人档案<ArrowRight size={14} /></button>}</div>
    <p>{task.subject} <span>负责人：{task.assignee || '待分配'}</span><span>计划日期：{task.due_at}</span></p>
    <div className="aw-task-actions">{(task.state === 'proposed' ? ['confirm', 'modify', 'reject'] : ['confirmed', 'modified'].includes(task.state) ? ['followup', 'modify', 'complete'] : []).map(action => <button key={action} className={action === 'confirm' ? 'aw-primary' : 'aw-secondary'} onClick={() => onAction(action)}>{actions[action]}</button>)}</div>
    <details><summary>处理记录 · {task.events.length}</summary>{task.events.map((e, i) => <p key={i}>{date(e.at)} · {e.actor} · {actions[e.action] || '生成草案'}<br />{e.note}</p>)}</details>
  </article>;
}
function TaskEditor({ task, action, onClose, onSaved }: { task: Task; action: string; onClose: () => void; onSaved: (task: Task) => void }) {
  const [title, setTitle] = useState(task.title);
  const [assignee, setAssignee] = useState(task.assignee);
  const [due, setDue] = useState(task.due_at);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <div className="aw-modal-overlay"><form className="aw-modal" role="dialog" aria-modal="true" aria-label={actions[action]} onKeyDown={e => dialogKeys(e, () => { if (!busy) onClose(); })} onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { onSaved(await saveTask(task, action, { title, assignee, due_at: due, note })); } catch (err) { setError(message(err)); } finally { setBusy(false); } }}>
    <h3>{actions[action]}</h3><p>保存后记录处理人和时间，保留在该任务的历史中。</p>
    <label>任务标题<input autoFocus required maxLength={180} value={title} readOnly={action !== 'modify'} onChange={e => setTitle(e.target.value)} /></label>
    {['confirm', 'modify'].includes(action) && <><label>负责人<input required maxLength={80} placeholder="填写负责老师或工作人员" value={assignee} onChange={e => setAssignee(e.target.value)} /></label><label>计划日期<input type="date" required value={due} onChange={e => setDue(e.target.value)} /></label></>}
    {action === 'followup' && <label>下一次计划日期<input type="date" required value={due} onChange={e => setDue(e.target.value)} /></label>}
    <label>{action === 'followup' ? '随访记录' : '处理说明'}<textarea required={['reject', 'complete', 'followup'].includes(action)} maxLength={2000} rows={4} value={note} onChange={e => setNote(e.target.value)} placeholder="填写实际处理情况或调整原因" /></label>
    {error && <p className="aw-error" role="alert">{error}</p>}<div className="aw-modal-actions"><button type="button" className="aw-secondary" disabled={busy} onClick={onClose}>取消</button><button className="aw-primary" disabled={busy}>{busy ? <Loader2 size={16} className="aw-spin" /> : <Check size={16} />}保存到后端</button></div>
  </form></div>;
}
