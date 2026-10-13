import { ArrowLeft, ClipboardCheck } from 'lucide-react';
import type { ScreeningRecord, ScreeningRetrievalSnapshot } from '../data/mockData';
import { questionnaires } from '../data/questionnaireData';
import { exampleAnswers } from '../data/screeningExample';

interface Props {
  record: ScreeningRecord;
  onBack: () => void;
  isExample?: boolean;
}

/**
 * 「本次检索与解释」：提交这条记录时存下来的检索/RAG 快照（L1：浏览器本地）。
 *
 * 三种来源分开写清楚，回看时不会被误导：
 *   live        服务端真实推理 —— 展示命中的相似线索、报告正文与建议依据
 *   mock        服务端演示模式（模板生成）—— 同样展示，但明确标注演示
 *   unavailable 本次没拿到 —— 只写原因，不补默认内容
 * 快照里没有的部分一律不渲染（不猜、不补）。
 */
function RetrievalSnapshotSection({ snapshot }: { snapshot: ScreeningRetrievalSnapshot }) {
  const modeLabel =
    snapshot.mode === 'live'
      ? { text: '服务端检索', className: 'bg-primary-50 text-primary-600' }
      : snapshot.mode === 'mock'
        ? { text: '演示模式 · 模板生成', className: 'bg-slate-100 text-slate-500' }
        : { text: '未取得检索结果', className: 'bg-slate-100 text-slate-500' };
  const at = snapshot.at ? snapshot.at.slice(0, 16).replace('T', ' ') : '';
  const matches = snapshot.matches ?? [];
  const advice = snapshot.advice ?? [];

  return (
    <section className="ui-card p-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="font-semibold text-slate-800">本次检索与解释</h3>
        <span className={`rounded-full px-2 py-0.5 text-[11px] ${modeLabel.className}`}>
          {modeLabel.text}
        </span>
        {at && <span className="text-xs text-slate-400">{at}</span>}
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        提交这条记录时一并存下的检索快照（存在本机浏览器，刷新或重开浏览器仍在）。
      </p>

      {snapshot.mode === 'unavailable' ? (
        <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
          本次没有取得检索与解释内容{snapshot.reason ? `：${snapshot.reason}` : ''}。
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {matches.length > 0 && (
            <div>
              <p className="text-[13px] font-medium text-slate-700">命中的相似线索</p>
              <div className="mt-2 space-y-2">
                {matches.map((row) => (
                  <div key={row.name} className="rounded-xl bg-slate-50 px-3.5 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">{row.name}</span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-500">
                        相似度 {row.score}
                      </span>
                      {typeof row.coverage === 'number' && (
                        <span className="text-[11px] text-slate-400">
                          覆盖 {Math.round(row.coverage * 100)}%
                        </span>
                      )}
                    </div>
                    {(row.matched_symptoms?.length ?? 0) > 0 && (
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        匹配症状：{row.matched_symptoms?.join('、')}
                      </p>
                    )}
                    {(row.matched_triggers?.length ?? 0) > 0 && (
                      <p className="mt-0.5 text-xs leading-5 text-slate-500">
                        匹配诱因：{row.matched_triggers?.join('、')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {snapshot.summary && (
            <div>
              <p className="text-[13px] font-medium text-slate-700">当时的报告正文</p>
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                {snapshot.summary}
              </p>
            </div>
          )}

          {advice.length > 0 && (
            <div>
              <p className="text-[13px] font-medium text-slate-700">当时的建议与由来</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-600">
                {advice.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {matches.length === 0 && !snapshot.summary && advice.length === 0 && (
            <p className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              这次快照里没有留下可展示的检索内容。
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export default function ScreeningDetail({ record, onBack, isExample = false }: Props) {
  const definition = questionnaires.find(q => q.id === record.questionnaire || q.name === record.questionnaire);
  const result = record.status === 'completed' ? definition?.scoring(record.score) : undefined;
  const resultLabel = result && (definition?.id === 'PHQ-9' || definition?.id === 'GAD-7')
    ? `${result.label}症状` : result?.label;
  return (
    <div className="space-y-5">
      <button onClick={onBack} className="ui-button"><ArrowLeft className="h-4 w-4" />返回筛查记录</button>
      {isExample && <div className="rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-700" role="status">示例报告 · 以下分数和答案仅演示完成筛查后的效果，不是你的实际结果，不计入历史记录。</div>}
      <section className="ui-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500">{isExample ? '筛查详情示例' : '筛查详情'}</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-800">{definition?.name ?? record.questionnaire}</h2>
            <p className="mt-2 text-xs text-slate-500">{record.date} · {record.status === 'completed' ? '已完成' : '待完成'} · {record.id}</p>
          </div>
          <p className="text-3xl font-semibold text-primary-600">{record.status === 'completed' ? record.score : '—'}<span className="ml-1 text-base font-normal text-slate-400">/ {record.maxScore} 分</span></p>
        </div>
        <div className="mt-5 rounded-xl bg-slate-50 p-4">
          <h3 className="font-semibold text-slate-800">结果如何理解</h3>
          <p className="mt-2 text-sm text-slate-700">{resultLabel ? `本次量表提示：${resultLabel}。` : '暂时没有可用的结果解释。'}</p>
          <p className="mt-2 text-sm leading-6 text-slate-500">{definition?.introduction.recallPeriod} 总分反映量表所评估问题的整体程度，不能单凭分数判断你有哪些具体症状，也不等同于医学诊断。</p>
        </div>
      </section>
      {record.supplement && (
        <section className="ui-card p-6">
          <h3 className="font-semibold text-slate-800">本次补充记录</h3>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            这次筛查时你自愿补充的内容，仅用于本次分析。
          </p>
          <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm leading-7 text-slate-700">
            {record.supplement.kind === "text" ? (
              <p className="whitespace-pre-wrap">{record.supplement.text}</p>
            ) : record.supplement.kind === "image" && record.supplement.url ? (
              <img
                src={record.supplement.url}
                alt={record.supplement.filename ?? "补充图片"}
                className="max-h-64 rounded-lg object-contain"
              />
            ) : (
              <p>{record.supplement.filename ?? "语音片段"}（已随本次筛查保存）</p>
            )}
          </div>
        </section>
      )}

      {/* 本次检索与解释：L1 快照（提交时一起存在浏览器本地） */}
      {record.retrieval && <RetrievalSnapshotSection snapshot={record.retrieval} />}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="ui-card p-5">
          <h3 className="font-semibold text-slate-800">相关表现与关注点</h3>
          <p className="mt-2 text-xs leading-5 text-slate-500">这是量表关注的常见表现，不代表你全部存在这些情况。</p>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
            {definition?.introduction.measures.map(item => <li key={item}>{item}</li>)}
          </ul>
          {!definition && <p className="mt-4 text-sm text-slate-500">该量表的说明尚未配置。</p>}
        </section>
        <section className="ui-card p-5">
          <h3 className="font-semibold text-slate-800">接下来可以怎么做</h3>
          <p className="mt-3 text-sm leading-7 text-slate-600">{result?.description ?? '完成筛查后可查看对应建议。'}</p>
          <p className="mt-3 text-sm leading-7 text-slate-600">若困扰持续、加重或影响学习、工作和生活，建议联系心理或医疗专业人员进一步评估。</p>
          {definition?.id === 'PHQ-9' && <p className="mt-3 text-xs leading-6 text-slate-500">可以从规律作息、适量活动、与可信任的人交流开始，并在后续复评中观察变化。</p>}
        </section>
      </div>
      <section className="ui-card p-5">
        <h3 className="flex items-center gap-2 font-semibold text-slate-800"><ClipboardCheck className="h-5 w-5 text-primary-600" />{isExample ? '逐题作答（模拟）' : '逐题作答'}</h3>
        {isExample && definition?.id === 'PHQ-9' ? (
          <div className="mt-4 divide-y divide-slate-100">
            {definition.questions.map((q, index) => <div key={q.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><span className="text-slate-700">{q.id}. {q.text}</span><span className="shrink-0 text-slate-500">{q.options.find(o => o.value === exampleAnswers[index])?.label} · {exampleAnswers[index]} 分</span></div>)}
          </div>
        ) : record.answers && definition ? (
          /* 有逐题答案就照实回看（首次引导流程会把它一起存下来） */
          <div className="mt-4 divide-y divide-slate-100">
            {definition.questions.map((q) => {
              const value = record.answers?.[q.id];
              return (
                <div key={q.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <span className="text-slate-700">{q.id}. {q.text}</span>
                  <span className="shrink-0 text-slate-500">
                    {value === undefined ? '未作答' : `${q.options.find(o => o.value === value)?.label} · ${value} 分`}
                  </span>
                </div>
              );
            })}
          </div>
        ) : <p className="mt-3 text-sm leading-6 text-slate-500">当前记录接口仅提供总分，暂时无法回看逐题答案。这里不会根据总分推测你的作答。</p>}
      </section>
      {definition && <section className="rounded-xl border border-primary-100 bg-primary-50/60 p-5"><h3 className="text-sm font-semibold text-slate-800">阅读提醒</h3><p className="mt-2 text-sm leading-7 text-slate-600">{definition.introduction.notice}</p></section>}
      {definition?.id === 'PHQ-9' && <p className="text-xs text-slate-500">参考资料：<a className="text-primary-600 underline" href="https://www.hiv.uw.edu/page/mental-health-screening/phq-9" target="_blank" rel="noreferrer">PHQ-9 评分说明</a> · <a className="text-primary-600 underline" href="https://www.nimh.nih.gov/health/publications/depression" target="_blank" rel="noreferrer">抑郁症状与自我照顾</a></p>}
    </div>
  );
}
