import { ArrowLeft, ClipboardCheck } from 'lucide-react';
import type { ScreeningRecord } from '../data/mockData';
import { questionnaires } from '../data/questionnaireData';
import { exampleAnswers } from '../data/screeningExample';

interface Props {
  record: ScreeningRecord;
  onBack: () => void;
  isExample?: boolean;
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
        ) : <p className="mt-3 text-sm leading-6 text-slate-500">当前记录接口仅提供总分，暂时无法回看逐题答案。这里不会根据总分推测你的作答。</p>}
      </section>
      {definition && <section className="rounded-xl border border-primary-100 bg-primary-50/60 p-5"><h3 className="text-sm font-semibold text-slate-800">阅读提醒</h3><p className="mt-2 text-sm leading-7 text-slate-600">{definition.introduction.notice}</p></section>}
      {definition?.id === 'PHQ-9' && <p className="text-xs text-slate-500">参考资料：<a className="text-primary-600 underline" href="https://www.hiv.uw.edu/page/mental-health-screening/phq-9" target="_blank" rel="noreferrer">PHQ-9 评分说明</a> · <a className="text-primary-600 underline" href="https://www.nimh.nih.gov/health/publications/depression" target="_blank" rel="noreferrer">抑郁症状与自我照顾</a></p>}
    </div>
  );
}
