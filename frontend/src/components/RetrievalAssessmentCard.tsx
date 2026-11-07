import { Link } from 'react-router-dom';
import { ClipboardList, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import type { RetrievalAnalysisReport, RetrievalAssessment } from '../services/screeningAssessment';

export default function RetrievalAssessmentCard({ assessment, loading = false, error, report, reportPhase = 'idle', onRefresh, onSave, onRetryReport }: {
  assessment: RetrievalAssessment | null; loading?: boolean; error?: string | null;
  report?: RetrievalAnalysisReport | null; reportPhase?: 'idle' | 'thinking' | 'done';
  onRefresh?: () => void; onSave?: () => void;
  onRetryReport?: () => void;
}) {
  const adopted = assessment?.references.filter((ref) => ref.usage === 'screening') ?? [];
  const completed = reportPhase === 'done' ? report : null;
  const conclusion = completed?.summary || assessment?.conclusion;
  const reference = completed?.sections.find((item) => item.title === '参考依据')?.content
    || assessment?.evidence.filter((item) => item.id !== 'coverage').slice(0, 3).map((item) => `${item.label}：${item.value}`).join('；');
  const recommendations = completed && !completed.mock ? completed.recommendations.filter((item) => item !== assessment?.nextAction.label && !/(?:跳转|打开|进入|点击|查看).{0,16}(?:预警|复核|页面|档案)/.test(item)) : [];
  return (
    <section className="ui-card p-5 sm:p-6" aria-label="多模态心理筛查结论" data-testid="retrieval-assessment">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-semibold text-slate-800"><ClipboardList className="h-5 w-5 text-primary-500" />多模态心理筛查结论</h3>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{assessment?.levelLabel || (loading ? '正在汇总检索证据' : '等待检索结果')}</span>
      </div>
      {loading && !assessment && <p className="mt-4 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />正在汇总本次命中的情绪与心理相关参考…</p>}
      {error && <p role="alert" className="mt-3 text-sm text-danger-600">{error}{onRefresh && <button type="button" onClick={onRefresh} className="ml-2 underline">重试分析</button>}</p>}
      {assessment && <>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <Sparkles className="h-4 w-4 text-primary-500" />
          <span>{completed ? completed.mock ? '检索证据说明' : '大模型综合分析' : '检索筛查结果'}</span>
          {completed?.originalInput && <span>{completed.originalInput.notice}</span>}
        </div>
        {reportPhase === 'thinking' && <div role="status" className="mt-3 flex items-start gap-2 rounded-lg bg-primary-50 p-3 text-sm text-slate-600">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary-500" />
          <div><span className="font-medium">大模型思考中</span><p className="mt-1 text-xs text-slate-500">先展示检索筛查结果，完成后自动补充综合结论与心理建议。</p></div>
        </div>}
        {completed?.mock && <div role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
          <p className="font-medium">大模型分析未生成</p>
          <p>{completed.generationMessage || '本次只展示检索筛查结果，尚未生成大模型分析与心理建议。'}</p>
          {onRetryReport && <button type="button" onClick={onRetryReport} className="mt-2 font-medium underline">重新生成报告</button>}
        </div>}
        <div className="mt-5 space-y-5" data-testid="retrieval-analysis">
          <div>
            <h4 className="text-sm font-semibold text-slate-800">1. 得出结论</h4>
            <p className="mt-2 whitespace-pre-line text-base leading-7 text-slate-800" aria-live="polite">{conclusion}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <h4 className="text-sm font-semibold text-slate-800">2. 参考依据</h4>
            <p className="mt-2 text-sm leading-6 text-slate-600">{reference?.slice(0, 180) || '本次检索缺少足够相关的参考，暂不强行推断状态。'}</p>
            {!!adopted.length && <p className="mt-2 break-words text-xs text-primary-600">采用结果：{adopted.slice(0, 3).map((ref) => ref.id).join('、')}{adopted.length > 3 ? ` 等 ${adopted.length} 个单元，完整依据见下方展开项` : ''}</p>}
          </div>
          <div data-testid="psychological-advice">
            <h4 className="text-sm font-semibold text-slate-800">3. 心理建议</h4>
            {recommendations.length ? <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-700">{recommendations.map((item, index) => <li key={index}>{item}</li>)}</ol>
              : <p className="mt-2 text-sm leading-6 text-slate-500">{reportPhase === 'thinking' || reportPhase === 'idle' ? '等待大模型生成针对本次情况的心理建议…' : '大模型尚未生成心理建议，请重新生成报告。'}</p>}
          </div>
        </div>
        {reportPhase === 'done' && !report && <p className="mt-4 text-xs text-slate-500">补充分析暂未生成，已保留本次检索结论与依据。</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {!assessment.supplementId && onSave && <button type="button" disabled={loading} onClick={onSave} className="rounded-lg bg-primary-500 px-4 py-2 text-sm text-white disabled:opacity-50">保存本次初筛结果</button>}
          {assessment.status === 'needs_human_review' && assessment.supplementId && <Link to="/personal/alerts" className="rounded-lg border border-orange-200 px-4 py-2 text-sm text-orange-700">查看预警与复核建议</Link>}
          {onRefresh && <button type="button" disabled={loading} onClick={onRefresh} className="inline-flex items-center gap-1.5 text-xs text-slate-500"><RefreshCw className="h-3.5 w-3.5" />更新检索分析</button>}
        </div>
        <details className="mt-4 border-t border-slate-100 pt-3"><summary className="cursor-pointer text-xs text-slate-500">查看检索到结论的依据链</summary>
          {conclusion !== assessment.conclusion && <div className="mt-3 text-xs leading-5"><p className="font-medium text-slate-700">原检索筛查结论</p><p className="text-slate-500">{assessment.conclusion}</p></div>}
          <dl className="mt-3 space-y-2 text-xs">{assessment.evidence.map((item) => <div key={item.id}><dt className="font-medium text-slate-700">{item.label}</dt><dd className="text-slate-500">{item.value} · {item.source}</dd></div>)}</dl>
          <ol className="mt-3 space-y-3 border-l border-primary-100 pl-4">{assessment.trace.map((step, index) => <li key={`${step.step}-${index}`} className="text-xs leading-5"><span className="font-medium text-slate-700">{step.step}</span><p className="text-slate-500">{step.detail}</p>{!!step.referenceIds?.length && <p className="break-words text-primary-600">采用：{step.referenceIds.join('、')}</p>}</li>)}</ol>
          <p className="mt-3 text-xs text-slate-400">规则版本 {assessment.ruleVersion} · 初筛为检索参考模式推断，尚未验证临床效度，不能用于确诊或排除疾病。</p>
        </details>
      </>}
    </section>
  );
}
