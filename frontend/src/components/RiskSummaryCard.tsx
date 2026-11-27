import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { getToken } from '../services/http';
import { reviewRisk, riskLabels, riskOverview, useRiskSummary, type RiskItem, type RiskLevel } from '../services/riskSummary';

/* 等级配色：底色压淡一档，靠左侧一条实色 + 圆点承载强度，
   避免整块深色背景在页面里过于刺眼（原先是实色 bg-*-50，黄/红大块显得脏）。 */
const styles: Record<RiskLevel, string> = {
  unknown: 'border-slate-200 bg-slate-50 text-slate-700',
  green: 'border-emerald-100 bg-emerald-50 text-emerald-800',
  yellow: 'border-amber-100 bg-amber-50 text-amber-800',
  orange: 'border-orange-100 bg-orange-50 text-orange-800',
  red: 'border-rose-100 bg-rose-50 text-rose-800',
};
const accents: Record<RiskLevel, string> = {
  unknown: 'bg-slate-300',
  green: 'bg-emerald-400',
  yellow: 'bg-amber-400',
  orange: 'bg-orange-400',
  red: 'bg-rose-400',
};
const dots: Record<RiskLevel, string> = {
  unknown: 'bg-slate-400',
  green: 'bg-success-500',
  yellow: 'bg-warning-500',
  orange: 'bg-orange-500',
  red: 'bg-danger-500',
};
/* 依据文案同一条会被多条记录命中，后端已按文案归并为一行并合并 source_ids；
   这里只负责把「几处依据」和具体来源讲清楚。 */
const features: Record<string, string> = {
  symptom: '症状相关表达',
  duration: '持续时间',
  frequency: '出现频率',
  functional_impact: '生活影响',
  safety: '安全相关疑似线索',
};
/* 安全条目的来源类型 → 人话 */
const flagLabels: Record<string, string> = {
  current: '本人安全相关表达',
  historical: '既往安全相关线索',
  scale: '量表安全相关条目',
  saved: '已保存的安全复核提示',
};

export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-xs ${styles[level] || styles.unknown}`}>
      {riskLabels[level] || riskLabels.unknown}
    </span>
  );
}

/** 依据来源：前三个直接列出，更多的收进 title，避免一行被几十个 id 撑满 */
function SourceIds({ ids }: { ids: string[] }) {
  if (!ids.length) return <span className="opacity-60">近期多日记录</span>;
  const head = ids.slice(0, 3);
  return (
    <span title={ids.join('、')}>
      {head.join('、')}
      {ids.length > 3 && <span className="opacity-60"> 等 {ids.length} 处</span>}
    </span>
  );
}

export default function RiskSummaryCard({
  caseId,
  compact = false,
  presentation = 'card',
  summaryOnly = false,
}: {
  caseId?: string;
  compact?: boolean;
  presentation?: 'card' | 'column';
  summaryOnly?: boolean;
}) {
  const column = presentation === 'column';
  const { data, error, reload } = useRiskSummary(caseId);
  const [editing, setEditing] = useState<{ item: RiskItem; action: string; token: string | null } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');

  const edit = (item: RiskItem, action: string) => {
    setEditing({ item, action, token: getToken() });
    setNote('');
    setFailure('');
  };
  const save = async () => {
    if (!caseId || !editing || !note.trim() || busy || editing.token !== getToken()) return;
    setBusy(true);
    setFailure('');
    try {
      await reviewRisk(caseId, editing.item, editing.action, note);
      setEditing(null);
      await reload();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : '复核未保存，请重试');
    } finally {
      setBusy(false);
    }
  };
  const reviewButtons = (item: RiskItem, safety: boolean) =>
    caseId && (
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        <button onClick={() => edit(item, safety ? 'followup_safety' : 'confirm_finding')} className="text-primary-700 underline">
          {safety ? '已复核，仍需跟进' : '确认此条线索'}
        </button>
        <button onClick={() => edit(item, safety ? 'resolve_safety' : 'dismiss_finding')} className="text-slate-600 underline">
          {safety ? '复核后解除本条提示' : '不采用此条线索'}
        </button>
      </div>
    );

  if (!data) {
    return (
      <section
        aria-label="近期综合风险"
        className={column ? 'flex h-full min-w-0 flex-col text-slate-700' : 'rounded-2xl border border-slate-200 bg-slate-50 p-4'}
      >
        <p className={column ? 'text-[15px] font-semibold text-slate-700' : 'text-sm font-medium'}>
          近期综合风险{!column && !summaryOnly && '（筛查参考）'}
        </p>
        <p className={column ? 'my-auto py-6 text-xs text-slate-500' : 'mt-2 text-xs text-slate-500'}>
          {error || '正在汇总近期筛查…'}
        </p>
        {error && (
          <button onClick={() => void reload()} className="mt-2 text-xs text-primary-600">
            重新读取
          </button>
        )}
      </section>
    );
  }

  /* 未解除的安全/线索提示。近期的需要逐条复核，历史的只是留痕，
     堆成八张一模一样的卡会把真正要看的那条淹掉 —— 所以历史条目折叠起来。 */
  const openFlags = data.safety.flags.filter((f) => f.status !== 'resolved');
  const recentFlags = openFlags.filter((f) => f.recent);
  const olderFlags = openFlags.filter((f) => !f.recent);

  const renderFlag = (f: RiskItem) => (
    <div className="space-y-1">
      <p className="opacity-65">
        {flagLabels[f.kind ?? ''] ?? f.label ?? '安全相关线索'}
        {f.recent ? ' · 近期' : ' · 历史'} · 待复核
      </p>
      <p className="opacity-65">
        {f.at?.slice(0, 10)} · <span className="font-mono text-[11px]">{f.source_id}</span>
      </p>
      {reviewButtons(f, true)}
    </div>
  );

  return (
    <section
      aria-label="近期综合风险"
      className={column ? 'flex h-full min-w-0 flex-col text-slate-700' : `relative overflow-hidden rounded-2xl border p-4 pl-5 ${styles[data.level] || styles.unknown}`}
    >
      {/* 左侧实色条：一眼看到强度，又不让整块背景变重 */}
      {!column && <span aria-hidden="true" className={`absolute left-0 top-0 h-full w-1 ${accents[data.level] || accents.unknown}`} />}

      {column ? (
        <>
          <p className="text-[15px] font-semibold text-slate-700">近期综合风险</p>
          <div className="flex flex-1 flex-col justify-center py-6">
            <div className="flex items-center gap-2.5">
              <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dots[data.level] || dots.unknown}`} />
              <h3
                className="min-w-0 break-words font-semibold leading-tight text-slate-900"
                style={{ fontSize: riskLabels[data.level]?.length > 8 ? 26 : 34 }}
              >
                {riskLabels[data.level]}
              </h3>
            </div>
            <p className="mt-2 text-[12.5px] text-slate-400">筛查参考 · 近30天 · {data.coverage.records}条筛查</p>
            <p className="mt-4 text-[13px] leading-6 text-slate-500">{riskOverview(data)}</p>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-medium opacity-80">
                近期综合风险{!summaryOnly && '（筛查参考）'}
                <span
                  className="cursor-help opacity-60"
                  title="综合近 30 天的量表与多模态记录得出，用于提示关注程度，不等同于诊断，也不替代专业评估。"
                >
                  ⓘ
                </span>
              </p>
              <h3 className={`mt-2 flex items-center gap-2 font-semibold ${compact ? 'text-base' : 'text-xl'}`}>
                <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dots[data.level] || dots.unknown}`} />
                {riskLabels[data.level]}
              </h3>
            </div>
            <span className="shrink-0 rounded-full bg-white/60 px-2 py-0.5 text-[11px] opacity-70">
              近30天 · {data.coverage.records}条筛查
            </span>
          </div>
          <p className="mt-2 text-xs leading-6 opacity-90">{riskOverview(data)}</p>
        </>
      )}

      {!summaryOnly && (
        <details className="group mt-3 text-xs">
          <summary className="flex cursor-pointer list-none items-center gap-1 font-medium opacity-90 hover:opacity-100">
            <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-0 -rotate-90" aria-hidden="true" />
            为什么是这个等级 · 查看维度与依据
          </summary>
          <div className="mt-3 space-y-3">
            <p className="leading-5 opacity-70">
              {data.window_start} 至 {data.window_end} · 量表{data.coverage.scales}条 / 多模态{data.coverage.multimodal}条。
              {/* 维度总数由后端 dimensions 实际长度决定，不再写死 4 ——
                  新增量表（UCLA-3 / SAS）后这里会自动跟上 */}
              覆盖{data.coverage.dimension_count}/{data.dimensions.length}个量表维度；缺少的维度不等同于正常。
            </p>

            <div className="grid gap-2 sm:grid-cols-2">
              {data.dimensions.map((d) => (
                <div key={d.code} className="rounded-lg bg-white/70 p-2.5">
                  <p className="font-medium">
                    {d.label} · {d.code}
                  </p>
                  <p className="mt-1">
                    {d.score === undefined ? '资料不足' : `${d.score}/${d.max_score} · ${d.severity}`}
                    {d.trend ? ` · ${d.trend.label} ${Math.abs(d.trend.delta)} 分` : ''}
                  </p>
                  {d.code === 'PSS-10' && (
                    <p className="mt-1 opacity-65">压力是连续分数，不设置诊断界值，也不单凭总分决定综合等级。</p>
                  )}
                </div>
              ))}
            </div>

            <ul className="space-y-2">
              {data.reasons.map((r, i) => (
                <li key={i} className="break-words leading-5">
                  {r.text}
                  <span className="ml-1 opacity-60">
                    （<SourceIds ids={r.source_ids} />）
                  </span>
                </li>
              ))}
            </ul>

            {data.coverage.incompatible > 0 && (
              <p>有{data.coverage.incompatible}条量表缺少完整答案或兼容版本，已保留历史，未猜测计分。</p>
            )}

            {recentFlags.map((f) => (
              <div key={f.id} className="rounded-lg bg-white/80 p-2">
                {renderFlag(f)}
              </div>
            ))}

            {olderFlags.length > 0 && (
              <details className="rounded-lg bg-white/60 p-2">
                <summary className="cursor-pointer font-medium">
                  既往安全相关条目（{olderFlags.length} 条 · 待复核）
                </summary>
                <ul className="mt-2 max-h-48 space-y-2 overflow-auto">
                  {olderFlags.map((f) => (
                    <li key={f.id} className="border-t border-current/10 pt-2 first:border-0 first:pt-0">
                      {renderFlag(f)}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="space-y-2 border-t border-current/10 pt-3">
              <p className="font-medium">AI线索提取</p>
              <p>
                {
                  {
                    paused: '未开启；基础规则汇总正常运行。',
                    not_needed: '目前没有需要提取的获准原文。',
                    ready: '本轮提取已完成。',
                    pending: '正在后台提取；当前展示规则汇总。',
                    failed: '部分提取尚未完成，将自动重试；不据此降低等级。',
                  }[data.ai.status]
                }
                {data.ai.units > 0 ? ` 已完成${data.ai.completed}/${data.ai.units}段原文。` : ''}
              </p>
              {!caseId && data.ai.status === 'paused' && (
                <Link className="inline-block text-primary-700 underline" to="/personal/settings">
                  在设置页底部开启AI筛查线索提取
                </Link>
              )}
              {data.ai.findings.map((f) => (
                <div key={f.id} className="rounded-lg bg-white/75 p-2">
                  <p>
                    {features[f.feature || ''] || '筛查线索'} · {f.status === 'confirm_finding' ? '人工已确认' : 'AI提示，待核实'}
                  </p>
                  <blockquote className="mt-1 whitespace-pre-wrap break-words leading-6">“{f.quote}”</blockquote>
                  <p className="opacity-60">
                    {f.source_id} · {f.at?.slice(0, 10)}
                  </p>
                  {f.status !== 'confirm_finding' && reviewButtons(f, false)}
                </div>
              ))}
            </div>

            {/* 本轮纳入的记录：原来是一串「日期 · 来源 · 原始 id」挤成一段，
                既读不出是什么，也不好扫。改成对齐的两列 + 等宽 id + 细滚动条。 */}
            <details className="group/ev">
              <summary className="flex cursor-pointer list-none items-center gap-1 font-medium">
                <ChevronDown className="h-3 w-3 transition-transform group-open/ev:rotate-0 -rotate-90" aria-hidden="true" />
                本轮纳入的全部筛查记录（{data.evidence.length}条）
              </summary>
              <ul className="mt-2 max-h-52 space-y-0.5 overflow-auto pr-1">
                {data.evidence.map((e) => (
                  <li key={e.id} className="flex items-baseline gap-2 rounded px-2 py-1 odd:bg-white/55">
                    <span className="shrink-0 font-mono text-[11px] tabular-nums opacity-60">{e.at?.slice(0, 10)}</span>
                    <span className="min-w-0 flex-1 truncate" title={e.reference}>
                      {e.reference}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] opacity-40">{e.id}</span>
                  </li>
                ))}
              </ul>
            </details>

            {editing && editing.token === getToken() && (
              <div className="space-y-2 rounded-lg bg-white p-3 text-slate-700">
                <p>复核仅针对所选依据，不替代其他提示的复核。</p>
                <textarea
                  aria-label="复核依据与处理意见"
                  maxLength={2000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full rounded-lg border p-2"
                />
                <div className="flex gap-3">
                  <button disabled={busy || !note.trim()} onClick={() => void save()} className="text-primary-700 disabled:opacity-40">
                    保存复核
                  </button>
                  <button disabled={busy} onClick={() => setEditing(null)}>
                    取消
                  </button>
                </div>
              </div>
            )}
            {failure && <p role="alert">{failure}</p>}

            {caseId && !!data.review_history?.length && (
              <details>
                <summary className="cursor-pointer">人工复核记录</summary>
                <ul className="mt-2 max-h-40 space-y-2 overflow-auto">
                  {data.review_history.map((r, i) => (
                    <li key={i} className="break-words">
                      {r.created_at.slice(0, 16)} · 操作账号 #{r.actor_id} ·{' '}
                      {
                        {
                          resolve_safety: '解除本条安全提示',
                          followup_safety: '仍需跟进',
                          confirm_finding: '确认线索',
                          dismiss_finding: '不采用线索',
                        }[r.action]
                      }
                      <p className="mt-1">{r.note}</p>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <p className="leading-5 opacity-65">{data.notice}</p>
            <p className="text-[10px] opacity-50">
              规则 {data.rule_version} · 数据版本 {data.data_version} · 计算于{' '}
              {new Date(data.computed_at).toLocaleString('zh-CN')}
            </p>
          </div>
        </details>
      )}
    </section>
  );
}
