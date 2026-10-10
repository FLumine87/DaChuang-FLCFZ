import { useState } from "react";
import { Activity, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { PersonalScreeningRecord } from "../data/mockData";
import { questionnaires } from "../data/questionnaireData";
import { screeningExample as exampleRecord } from "../data/screeningExample";

const resultColors = {
  green: "bg-success-50 text-success-600",
  yellow: "bg-warning-50 text-warning-600",
  orange: "bg-orange-50 text-orange-600",
  red: "bg-danger-50 text-danger-600",
};

export default function LatestScreeningCard({ record }: { record?: PersonalScreeningRecord }) {
  const [showExample, setShowExample] = useState(false);
  const isExample = !record && showExample;
  const displayed = record ?? (isExample ? exampleRecord : undefined);
  const definition = questionnaires.find((item) =>
    displayed?.questionnaire === item.id || displayed?.questionnaire === item.name,
  );
  const result = displayed && definition?.scoring(displayed.score);

  return (
    <section className="ui-card p-5 xl:p-6" aria-label="最近一次筛查">
      <div className="mb-5 flex items-center justify-between gap-2">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
          <Activity className="h-6 w-6" strokeWidth={1.7} />
        </div>
        {isExample && <span className="rounded-full bg-primary-50 px-2 py-1 text-xs font-medium text-primary-600">示例数据</span>}
      </div>
      <h2 className="text-sm font-normal text-slate-500">最近一次筛查</h2>
      {displayed ? (
        <>
          <p className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-slate-800 tabular-nums">
            {displayed.score}<span className="ml-1 text-base font-normal text-slate-400">/ {displayed.maxScore} 分</span>
          </p>
          <p className="mt-3 text-sm font-medium text-slate-700">{definition?.name ?? displayed.questionnaire}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded-full px-2 py-1 font-medium ${resultColors[result?.level ?? displayed.level]}`}>
              {result ? `症状程度：${result.label}` : displayed.moodTag}
            </span>
            <span className="text-slate-500">{displayed.date}</span>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-400">{isExample ? "仅展示效果，不计入筛查记录" : "筛查结果仅供参考，不构成诊断"}</p>
        </>
      ) : (
        <>
          <p className="mt-2 text-[28px] font-semibold leading-tight text-slate-800">暂无</p>
          <p className="mt-3 text-xs leading-5 text-slate-400">完成一次筛查，了解当前状态</p>
        </>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {isExample && <Link to="/personal/screening?example=1&record=preview-only" className="text-xs font-medium text-primary-600 hover:underline">查看示例详情</Link>}
        {record ? (
          <Link to={`/personal/screening?record=${encodeURIComponent(record.id)}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline">查看筛查详情 <ArrowRight className="h-3.5 w-3.5" /></Link>
        ) : (
          <button type="button" onClick={() => setShowExample(!showExample)} aria-pressed={isExample} className="text-xs font-medium text-primary-600 hover:underline">
            {isExample ? "收起示例" : "看看有记录的样子"}
          </button>
        )}
      </div>
    </section>
  );
}
