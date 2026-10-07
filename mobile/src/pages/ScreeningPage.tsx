import { useEffect, useState } from 'react';
import { ArrowLeft, Check, CheckCircle2, ClipboardList, Loader2 } from 'lucide-react';
import { getScreeningRecords, submitScreening } from '@shared/services/mockApi';
import { questionnaireCatalog, type AlertLevel, type PersonalScreeningRecord } from '@shared/data/mockData';
import { questionnaires, type QuestionnaireDefinition } from '@shared/data/questionnaireData';
import AlertBadge from '@shared/components/AlertBadge';
import { Banner, Card, EmptyState, SectionTitle, Spinner } from '../components/ui';

interface QuizResult {
  score: number;
  maxScore: number;
  level: AlertLevel;
  label: string;
  description: string;
}

export default function ScreeningPage() {
  const [records, setRecords] = useState<PersonalScreeningRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [qDef, setQDef] = useState<QuestionnaireDefinition | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [idx, setIdx] = useState(0);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedTip, setSavedTip] = useState('');

  const loadRecords = () => {
    setLoading(true);
    getScreeningRecords()
      .then(setRecords)
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(loadRecords, []);

  const openQuiz = (id: string) => {
    const def = questionnaires.find((q) => q.id === id);
    if (!def) {
      setError(`未找到量表 ${id} 的题目定义`);
      return;
    }
    setQDef(def);
    setAnswers({});
    setIdx(0);
    setResult(null);
    setSavedTip('');
    setError('');
  };

  const closeQuiz = () => {
    setQDef(null);
    setResult(null);
    loadRecords();
  };

  const pick = (qid: number, value: number) => {
    setAnswers((prev) => {
      const next = { ...prev, [qid]: value };
      return next;
    });
    // 选择后自动跳下一题（移动端常见交互），最后一题停留等提交
    if (qDef && idx < qDef.questions.length - 1) {
      window.setTimeout(() => setIdx((i) => Math.min(i + 1, (qDef?.questions.length ?? 1) - 1)), 160);
    }
  };

  const submit = async () => {
    if (!qDef) return;
    const total = Object.values(answers).reduce((s, v) => s + v, 0);
    const maxScore = qDef.questions.reduce(
      (s, q) => s + Math.max(...q.options.map((o) => o.value)),
      0,
    );
    const scored = qDef.scoring(total);
    const r: QuizResult = {
      score: total,
      maxScore,
      level: scored.level,
      label: scored.label,
      description: scored.description,
    };
    setResult(r);
    setSaving(true);
    try {
      await submitScreening({
        questionnaire: qDef.name,
        score: total,
        maxScore,
        level: scored.level,
        answers,
      });
      setSavedTip('结果已记录到你的档案');
    } catch (e) {
      setSavedTip(`结果未能上传：${e instanceof Error ? e.message : '网络异常'}`);
    } finally {
      setSaving(false);
    }
  };

  // ── 问卷视图 ────────────────────────────────────────────────────────────
  if (qDef) {
    const total = qDef.questions.length;
    const answered = Object.keys(answers).length;

    if (result) {
      return (
        <div className="space-y-4">
          <Card className="p-5 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
            <p className="text-[13px] text-slate-400 mt-3">{qDef.name} · 已完成</p>
            <p className="text-4xl font-bold text-slate-800 mt-2">
              {result.score}
              <span className="text-base font-normal text-slate-400 ml-1">/ {result.maxScore}</span>
            </p>
            <div className="flex justify-center mt-3">
              <AlertBadge level={result.level} />
            </div>
            <p className="text-[15px] font-semibold text-slate-800 mt-4">{result.label}</p>
            <p className="text-[13px] text-slate-600 leading-6 mt-2">{result.description}</p>
            {saving && (
              <p className="text-xs text-slate-400 mt-3 inline-flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                正在保存…
              </p>
            )}
            {savedTip && !saving && <p className="text-xs text-emerald-600 mt-3">{savedTip}</p>}
          </Card>

          <Card className="p-4">
            <p className="text-[13px] text-slate-500 leading-6">
              本结果基于自评量表，仅供自我了解与筛查参考，不构成诊断。
              若你持续感到痛苦，建议联系学校心理健康中心或拨打心理援助热线。
            </p>
          </Card>

          <button
            onClick={closeQuiz}
            className="w-full min-h-[48px] rounded-xl bg-emerald-600 text-white text-[15px] font-medium active:bg-emerald-700"
          >
            完成，返回量表列表
          </button>
        </div>
      );
    }

    const q = qDef.questions[idx];
    const chosen = answers[q.id];
    const isLast = idx === total - 1;
    const allAnswered = answered === total;

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={closeQuiz}
            className="w-9 h-9 -ml-1 flex items-center justify-center rounded-lg active:bg-slate-100"
          >
            <ArrowLeft className="w-5 h-5 text-slate-500" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-semibold text-slate-800 truncate">{qDef.name}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              第 {idx + 1} / {total} 题 · 已作答 {answered}/{total}
            </p>
          </div>
        </div>

        <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${((idx + 1) / total) * 100}%` }}
          />
        </div>

        <Card className="p-4">
          <p className="text-[11px] text-slate-400 leading-5 mb-3">{qDef.instructions}</p>
          <p className="text-[16px] text-slate-800 leading-7 font-medium">
            <span className="inline-block w-6 h-6 rounded-full text-center leading-6 text-[11px] font-bold mr-2 bg-primary-100 text-primary-700">
              {q.id}
            </span>
            {q.text}
          </p>
        </Card>

        <div className="space-y-2.5">
          {q.options.map((opt) => {
            const active = chosen === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => pick(q.id, opt.value)}
                className={`w-full min-h-[52px] px-4 rounded-xl border-2 text-left text-[15px] transition-colors flex items-center gap-3 ${
                  active
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-800 font-medium'
                    : 'border-slate-200 bg-white text-slate-700 active:bg-slate-50'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    active ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300'
                  }`}
                >
                  {active && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </span>
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="flex gap-2.5 pt-1">
          <button
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            disabled={idx === 0}
            className="flex-1 min-h-[48px] rounded-xl border border-slate-200 text-slate-600 text-[15px] active:bg-slate-50 disabled:opacity-40"
          >
            上一题
          </button>
          {!isLast ? (
            <button
              onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}
              className="flex-1 min-h-[48px] rounded-xl bg-emerald-600 text-white text-[15px] font-medium active:bg-emerald-700"
            >
              下一题
            </button>
          ) : (
            <button
              onClick={() => void submit()}
              disabled={!allAnswered || saving}
              className="flex-1 min-h-[48px] rounded-xl bg-emerald-600 text-white text-[15px] font-medium active:bg-emerald-700 disabled:opacity-40"
            >
              {allAnswered ? '提交并查看结果' : `还有 ${total - answered} 题未答`}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── 列表视图 ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {error && <Banner kind="error">{error}</Banner>}

      <div>
        <SectionTitle title="选择量表" />
        <div className="space-y-2.5">
          {questionnaireCatalog.map((item) => (
            <Card key={item.id} className="p-4" onClick={() => openQuiz(item.id)}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                  <ClipboardList className="w-4.5 h-4.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-medium text-slate-800">{item.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5 leading-5">{item.description}</p>
                  <div className="flex items-center gap-2 mt-2 text-[11px] text-slate-400">
                    <span>{item.questions} 题</span>
                    <span>·</span>
                    <span>约 {item.minutes} 分钟</span>
                    <span>·</span>
                    <span className="truncate">{item.target}</span>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <SectionTitle title="历史记录" />
        {loading ? (
          <Card>
            <Spinner label="加载记录…" />
          </Card>
        ) : records.length === 0 ? (
          <Card>
            <EmptyState title="还没有筛查记录" hint="选一个量表开始吧" />
          </Card>
        ) : (
          <Card className="divide-y divide-slate-100">
            {records.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] text-slate-800 truncate">{r.questionnaire}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {r.date} · {r.moodTag}
                  </p>
                </div>
                <span className="text-[13px] font-semibold text-slate-700 shrink-0">
                  {r.score}
                  <span className="text-[11px] text-slate-300">/{r.maxScore}</span>
                </span>
                <AlertBadge level={r.level} size="sm" />
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
