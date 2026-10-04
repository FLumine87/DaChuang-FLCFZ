import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Loader2,
  Network,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  assessWarning,
  getGraphOverview,
  type AssessmentResponse,
  type GraphOverview,
  type ProposedTask,
} from '../../services/agentApi';

type LocalTaskState = ProposedTask['status'];

const levelStyle: Record<string, string> = {
  red: 'bg-red-100 text-red-700 border-red-200',
  orange: 'bg-orange-100 text-orange-700 border-orange-200',
  yellow: 'bg-amber-100 text-amber-700 border-amber-200',
  green: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

const stateStyle: Record<LocalTaskState, string> = {
  proposed: 'bg-slate-100 text-slate-600',
  confirmed: 'bg-emerald-100 text-emerald-700',
  modified: 'bg-blue-100 text-blue-700',
  rejected: 'bg-slate-100 text-slate-500',
};

const stateLabel: Record<LocalTaskState, string> = {
  proposed: '待确认',
  confirmed: '已确认',
  modified: '已修改',
  rejected: '已拒绝',
};

export default function AdminAgentWorkbench() {
  const [screeningId, setScreeningId] = useState('');
  const [overview, setOverview] = useState<GraphOverview | null>(null);
  const [data, setData] = useState<AssessmentResponse | null>(null);
  const [taskStates, setTaskStates] = useState<Record<string, LocalTaskState>>({});
  const [loading, setLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    getGraphOverview()
      .then(setOverview)
      .catch(() => setOverviewError('暂时无法读取知识图谱概览，请确认后端已启动并完成本地迁移。'));
  }, []);

  const tasks = useMemo(
    () => data?.assessment.proposed_tasks ?? [],
    [data],
  );

  const runAssessment = async () => {
    const id = Number(screeningId);
    if (!Number.isInteger(id) || id <= 0) {
      setError('请输入有效的筛查记录数字编号。');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await assessWarning(id);
      setData(response);
      setTaskStates(
        Object.fromEntries(response.assessment.proposed_tasks.map((task) => [task.task_key, task.status])),
      );
    } catch (reason) {
      setData(null);
      setError(reason instanceof Error ? reason.message : '研判请求失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  };

  const setTaskState = (task: ProposedTask, state: LocalTaskState) => {
    if (state === 'modified') {
      const title = window.prompt('填写调整后的处置说明：', task.title);
      if (title === null) return;
    }
    setTaskStates((current) => ({ ...current, [task.task_key]: state }));
  };

  const alertLevel = data?.evidence_pack.screening.alert_level || 'green';
  const needsReview = data?.assessment.requires_human_review;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 text-white shadow-lg">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-cyan-200">
              <BrainCircuit className="h-5 w-5" />
              <span className="text-sm font-medium">Agent 驱动 · 人工决策闭环</span>
            </div>
            <h2 className="text-2xl font-bold">预警处置工作台</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              Agent 汇总匿名筛查证据、历史变化和已审核图谱规则，生成待人工确认的处置建议；不提供诊断，也不会自动干预。
            </p>
          </div>
          <div className="flex w-full max-w-md gap-2">
            <input
              value={screeningId}
              onChange={(event) => setScreeningId(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && runAssessment()}
              inputMode="numeric"
              placeholder="输入筛查记录 ID，例如 1"
              className="min-w-0 flex-1 rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-sm text-white placeholder:text-slate-400 outline-none focus:border-cyan-300"
            />
            <button
              onClick={runAssessment}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              生成研判
            </button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Metric icon={<Network className="h-5 w-5" />} label="图谱实体" value={overview?.entity_count} />
        <Metric icon={<ChevronRight className="h-5 w-5" />} label="图谱关系" value={overview?.relation_count} />
        <Metric icon={<ClipboardCheck className="h-5 w-5" />} label="生效规则" value={overview?.active_rule_count} />
      </section>

      {overviewError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{overviewError}</div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!data && !loading && (
        <section className="rounded-2xl border border-slate-200 bg-white py-16 text-center shadow-sm">
          <BrainCircuit className="mx-auto mb-4 h-12 w-12 text-indigo-200" />
          <h3 className="font-semibold text-slate-800">等待生成研判</h3>
          <p className="mt-2 text-sm text-slate-500">输入一条筛查记录的数字 ID，查看 Agent 的证据链和处置草案。</p>
        </section>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <section className="space-y-6 xl:col-span-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-800">研判结论草案</h3>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${levelStyle[alertLevel] || levelStyle.green}`}>
                      {alertLevel.toUpperCase()} 预警
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">匿名对象：{data.assessment.subject_ref || '未生成匿名编号'}</p>
                </div>
                <div className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ${needsReview ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                  <ShieldCheck className="h-4 w-4" />
                  {needsReview ? '必须人工复核' : '等待人工确认'}
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {data.assessment.evidence_summary.map((item) => (
                  <div key={item} className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">{item}</div>
                ))}
              </div>
              <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
                <CircleHelp className="mr-2 inline h-4 w-4" />
                {data.assessment.notice}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-800">Agent 处置任务草案</h3>
                <span className="text-xs text-slate-400">所有动作均需人工确认</span>
              </div>
              <div className="mt-4 space-y-3">
                {tasks.length ? tasks.map((task) => {
                  const status = taskStates[task.task_key] ?? task.status;
                  return (
                    <div key={task.task_key} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-slate-800">{task.title}</p>
                          <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500">
                            <Clock3 className="h-3.5 w-3.5" /> 建议完成：{task.due_at}
                          </p>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${stateStyle[status]}`}>{stateLabel[status]}</span>
                      </div>
                      {status === 'proposed' && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <ActionButton icon={<Check className="h-3.5 w-3.5" />} label="确认" onClick={() => setTaskState(task, 'confirmed')} tone="success" />
                          <ActionButton icon={<RefreshCw className="h-3.5 w-3.5" />} label="修改" onClick={() => setTaskState(task, 'modified')} tone="neutral" />
                          <ActionButton icon={<X className="h-3.5 w-3.5" />} label="拒绝" onClick={() => setTaskState(task, 'rejected')} tone="danger" />
                        </div>
                      )}
                    </div>
                  );
                }) : <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">当前规则没有提出额外任务。</p>}
              </div>
            </div>
          </section>

          <aside className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="flex items-center gap-2 font-semibold text-slate-800"><Network className="h-4 w-4 text-indigo-600" />知识图谱证据链</h3>
              <div className="mt-4 space-y-4">
                {data.knowledge_graph.paths.map((path) => (
                  <div key={path.path_id} className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
                    <div className="flex flex-wrap gap-1.5">
                      {path.nodes.map((node) => (
                        <span key={node.entity_key} className="rounded-full bg-white px-2 py-1 text-xs text-indigo-700 shadow-sm">{node.name}</span>
                      ))}
                    </div>
                    <p className="mt-3 text-xs leading-5 text-slate-600">{path.reason}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="flex items-center gap-2 font-semibold text-slate-800"><AlertTriangle className="h-4 w-4 text-amber-500" />命中规则</h3>
              <div className="mt-4 space-y-3">
                {data.knowledge_graph.rule_decisions.map((rule) => (
                  <div key={rule.rule_key} className="border-l-2 border-indigo-300 pl-3">
                    <p className="text-sm font-medium text-slate-700">{rule.rule_name}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{rule.message}</p>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value?: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-indigo-600">{icon}<span className="text-xs font-medium text-slate-500">{label}</span></div>
      <p className="mt-2 text-2xl font-bold text-slate-800">{value ?? '—'}</p>
    </div>
  );
}

function ActionButton({ icon, label, onClick, tone }: { icon: ReactNode; label: string; onClick: () => void; tone: 'success' | 'neutral' | 'danger' }) {
  const tones = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
    neutral: 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100',
    danger: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
  };
  return <button onClick={onClick} className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium ${tones[tone]}`}>{icon}{label}</button>;
}
