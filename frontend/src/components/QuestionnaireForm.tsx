import { useState } from 'react';
import { ArrowLeft, CheckCircle2, RotateCcw } from 'lucide-react';
import { questionnaires } from '../data/questionnaireData';
import type { QuestionnaireDefinition } from '../data/questionnaireData';
import AlertBadge from './AlertBadge';

interface Props {
  questionnaireId: string;
  onClose: () => void;
  onComplete: (score: number, maxScore: number, level: 'green' | 'yellow' | 'orange' | 'red') => void;
}

export default function QuestionnaireForm({ questionnaireId, onClose, onComplete }: Props) {
  const qDef: QuestionnaireDefinition | undefined = questionnaires.find((q) => q.id === questionnaireId);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);

  if (!qDef) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <p className="text-slate-500">未找到量表：{questionnaireId}</p>
        <button onClick={onClose} className="mt-3 text-sm text-primary-600 cursor-pointer">返回</button>
      </div>
    );
  }

  const totalQuestions = qDef.questions.length;
  const answeredCount = Object.keys(answers).length;
  const allAnswered = answeredCount === totalQuestions;

  const totalScore = Object.values(answers).reduce((sum, v) => sum + v, 0);
  const maxScore = qDef.questions.reduce((sum, q) => sum + Math.max(...q.options.map((o) => o.value)), 0);
  const result = qDef.scoring(totalScore);

  const handleSubmit = () => {
    setSubmitted(true);
    onComplete(totalScore, maxScore, result.level);
  };

  const handleReset = () => {
    setAnswers({});
    setSubmitted(false);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 bg-slate-50">
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 text-slate-600" />
        </button>
        <div className="flex-1">
          <h3 className="font-semibold text-slate-800">{qDef.name}</h3>
          <p className="text-xs text-slate-400 mt-0.5">{qDef.description}</p>
        </div>
        <span className="text-xs text-slate-500 bg-white border border-slate-200 px-2.5 py-1 rounded-full">
          已作答 {answeredCount}/{totalQuestions}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-slate-100">
        <div
          className="h-full bg-emerald-500 transition-all"
          style={{ width: `${(answeredCount / totalQuestions) * 100}%` }}
        />
      </div>

      {/* Instructions */}
      <div className="px-6 pt-5 pb-2">
        <p className="text-sm text-slate-500 italic">{qDef.instructions}</p>
      </div>

      {/* Questions */}
      <div className="px-6 pb-6 space-y-6">
        {qDef.questions.map((q) => (
          <div key={q.id} className={`rounded-xl p-4 border transition-colors ${
            answers[q.id] !== undefined ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-slate-50/50'
          }`}>
            <p className="text-sm font-medium text-slate-800 mb-3">
              <span className="inline-block w-6 h-6 rounded-full text-center leading-6 text-xs font-bold mr-2
                bg-primary-100 text-primary-700">{q.id}</span>
              {q.text}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {q.options.map((opt) => {
                const selected = answers[q.id] === opt.value;
                return (
                  <button
                    key={opt.value}
                    disabled={submitted}
                    onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: opt.value }))}
                    className={`py-2 px-3 rounded-lg text-sm border transition-all cursor-pointer text-center ${
                      selected
                        ? 'bg-primary-600 text-white border-primary-600 font-medium'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-primary-400 hover:bg-primary-50'
                    } disabled:cursor-not-allowed`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Result & Submit */}
      <div className="px-6 pb-6">
        {!submitted ? (
          <div className="flex items-center gap-3">
            <button
              onClick={handleSubmit}
              disabled={!allAnswered}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="w-4 h-4" />
              提交并查看结果
            </button>
            {!allAnswered && (
              <p className="text-xs text-slate-400">还有 {totalQuestions - answeredCount} 题未作答</p>
            )}
          </div>
        ) : (
          <div className="rounded-xl border-2 border-primary-200 bg-primary-50/50 p-5 space-y-4">
            <div className="flex items-center gap-4">
              <div>
                <p className="text-xs text-slate-500">总得分</p>
                <p className="text-3xl font-bold text-slate-800">
                  {totalScore}
                  <span className="text-base font-normal text-slate-400 ml-1">/ {maxScore}</span>
                </p>
              </div>
              <div className="flex-1">
                <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      result.level === 'red' ? 'bg-danger-500' :
                      result.level === 'orange' ? 'bg-orange-500' :
                      result.level === 'yellow' ? 'bg-warning-500' : 'bg-success-500'
                    }`}
                    style={{ width: `${(totalScore / maxScore) * 100}%` }}
                  />
                </div>
              </div>
              <AlertBadge level={result.level} />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">{result.label}</p>
              <p className="text-sm text-slate-600 mt-1 leading-6">{result.description}</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={handleReset}
                className="inline-flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 text-sm transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                重新作答
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium transition-colors cursor-pointer"
              >
                完成，返回列表
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
