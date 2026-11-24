import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, RotateCcw } from "lucide-react";
import { calculateQuestionnaireScore, questionnaires } from "../data/questionnaireData";
import type { QuestionnaireDefinition } from "../data/questionnaireData";
import AlertBadge from "./AlertBadge";
import { requestConsent } from "../services/consent";

interface Props {
  questionnaireId: string;
  onClose: () => void;
  /* 合并要点：团队 main 加了第 4 个参数 answers —— 逐题作答要跟着分数一起落库，
     分析依据里的检索才能拿到具体作答。我们这版的一屏一题布局与保存文案都保留。 */
  onComplete: (
    score: number,
    maxScore: number,
    level: "green" | "yellow" | "orange" | "red",
    answers: Record<string, number>,
  ) => Promise<void>;
}

export default function QuestionnaireForm({
  questionnaireId,
  onClose,
  onComplete,
}: Props) {
  const qDef: QuestionnaireDefinition | undefined = questionnaires.find(
    (q) => q.id === questionnaireId,
  );
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  // 一屏一题：当前题序号（原先 9 道题一长列，第 9 题问自伤念头，需要更稳的节奏）
  const [current, setCurrent] = useState(0);
  /* 团队 main 的重复提交闸门（连点两次不会写两条记录）：我们原先靠 saving 状态拦，
     这里把两套都收下 —— ref 负责"同一帧内连点"，saving 负责按钮禁用与文案。 */
  const submitRef = useRef(false);

  if (!qDef) {
    return (
      <div className="ui-card p-6">
        <p className="text-slate-500">未找到量表：{questionnaireId}</p>
        <button
          onClick={onClose}
          className="mt-3 text-sm text-primary-600 cursor-pointer"
        >
          返回
        </button>
      </div>
    );
  }

  const totalQuestions = qDef.questions.length;
  const answeredCount = Object.keys(answers).length;
  const allAnswered = answeredCount === totalQuestions;

  const totalScore = calculateQuestionnaireScore(questionnaireId, answers);
  /* PSQI 含时间/数值题，选项里没有 value 可取，满分改由定义显式给出；
     其余量表仍按"每题选项最大值 × 题数"推算。 */
  const maxScore =
    qDef.maxScore ??
    qDef.questions.reduce(
      (sum, q) => sum + (q.options.length ? Math.max(...q.options.map((o) => o.value)) : 0),
      0,
    );
  const result = qDef.scoring(totalScore);

  /* 「下一题」允许跳过不答，因此可能走到最后一题时仍有空题：
     此时旧的实现会让「下一题」（最后一题禁用）和「提交」（要求答满禁用）
     同时按不动，页面卡死且不告诉用户漏了哪些题。下面两个小工具负责兜底。 */
  const firstUnanswered = qDef.questions.find((q) => answers[q.id] === undefined);
  const jumpToFirstUnanswered = () => {
    if (!firstUnanswered) return;
    const index = qDef.questions.findIndex((q) => q.id === firstUnanswered.id);
    if (index >= 0) setCurrent(index);
  };

  const handleSubmit = async () => {
    if (submitRef.current || saving || !allAnswered) return;
    submitRef.current = true;
    setSaving(true);
    setSaveError('');
    /* 提交前先问一次「是否同意上传」（可在账号设置里关掉询问，关掉即自动不提交） */
    const agreed = await requestConsent();
    if (!agreed) {
      setSaveError('未同意上传，本次作答没有提交。你的答案仍保留在页面上。');
      submitRef.current = false;
      setSaving(false);
      return;
    }
    try {
      await onComplete(totalScore, maxScore, result.level, answers);
      setSubmitted(true);
    } catch (reason) {
      /* 后端可能给出具体原因（如"量表名不在支持列表"），有就透出来，没有再用这句兜底 */
      setSaveError(reason instanceof Error && reason.message
        ? reason.message
        : '保存失败，您的作答仍保留在页面上，请重试。');
    } finally {
      submitRef.current = false;
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (!window.confirm("重新作答会清空本次答案，确定继续吗？")) return;
    setAnswers({});
    setSubmitted(false);
    setCurrent(0);
  };

  const handleClose = () => {
    if (!submitted && answeredCount > 0 && !window.confirm("本次答案尚未保存，确定退出筛查吗？")) return;
    onClose();
  };

  return (
    <div className="ui-card overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 px-6 py-4 border-b border-slate-100 bg-slate-50">
        <button
          onClick={handleClose}
          aria-label="返回筛查列表"
          disabled={saving}
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
          className="h-full bg-success-500 transition-all"
          style={{ width: `${(answeredCount / totalQuestions) * 100}%` }}
        />
      </div>

      {/* Instructions */}
      <div className="px-6 pt-5 pb-2">
        <p className="text-sm text-slate-500 italic">{qDef.instructions}</p>
      </div>

      {/* Questions：一屏一题 */}
      <div className="px-6 pb-6">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            第{' '}
            <span className="font-semibold text-slate-700 tabular-nums">{current + 1}</span> /{' '}
            {totalQuestions} 题
          </p>
          <p className="text-xs text-slate-400">
            {answeredCount > 0 ? `已作答 ${answeredCount} 题` : '请选择最符合的一项'}
          </p>
        </div>

        {(() => {
          const q = qDef.questions[current];
          if (!q) return null;
          // PHQ-9 第 9 题（自伤念头）按其临床应答规范做就地提示，不跳转、不变红
          const isSafetyItem = qDef.id === 'PHQ-9' && q.id === 9;
          const picked = answers[q.id];
          return (
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-5">
              <p className="text-sm font-medium leading-6 text-slate-800">
                <span
                  className="mr-2 inline-block h-6 w-6 rounded-full text-center text-xs font-bold leading-6 tabular-nums
                  bg-primary-100 text-primary-700"
                >
                  {q.id}
                </span>
                {q.text}
              </p>
              <div className="mt-4">
                {/* time / number 题（PSQI 的上床/起床时间、入睡耗时、睡眠时长）：
                    答案统一存"分钟数"，便于后端算七成分里的睡眠效率 */}
                {q.kind === 'time' || q.kind === 'number' ? (
                  <div className="space-y-2">
                    {q.kind === 'time' ? (
                      <input
                        type="time"
                        disabled={submitted || saving}
                        value={
                          typeof picked === 'number'
                            ? `${String(Math.floor(picked / 60)).padStart(2, '0')}:${String(picked % 60).padStart(2, '0')}`
                            : ''
                        }
                        onChange={(e) => {
                          const [h, m] = e.target.value.split(':').map(Number);
                          if (Number.isNaN(h) || Number.isNaN(m)) return;
                          setAnswers((prev) => ({ ...prev, [q.id]: h * 60 + m }));
                          if (current < totalQuestions - 1) {
                            setTimeout(() => setCurrent((c) => Math.min(totalQuestions - 1, c + 1)), 220);
                          }
                        }}
                        aria-label={q.text}
                        className="w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-primary-400"
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          inputMode="numeric"
                          min={q.min ?? 0}
                          max={q.max ?? 720}
                          disabled={submitted || saving}
                          value={typeof picked === 'number' ? picked : ''}
                          onChange={(e) => {
                            const raw = e.target.value === '' ? undefined : Number(e.target.value);
                            if (raw === undefined || Number.isNaN(raw)) {
                              setAnswers((prev) => {
                                const next = { ...prev };
                                delete next[q.id];
                                return next;
                              });
                              return;
                            }
                            setAnswers((prev) => ({ ...prev, [q.id]: raw }));
                          }}
                          aria-label={q.text}
                          className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums text-slate-700 outline-none focus:border-primary-400"
                        />
                        <span className="text-sm text-slate-500">{q.unit ?? '分钟'}</span>
                      </div>
                    )}
                    {q.hint && <p className="text-xs text-slate-400">{q.hint}</p>}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {q.options.map((opt) => {
                      const selected = picked === opt.value;
                      return (
                        <button
                          key={opt.value}
                          disabled={submitted || saving}
                          aria-pressed={selected}
                          onClick={() => {
                            setAnswers((prev) => ({ ...prev, [q.id]: opt.value }));
                            // 安全题答 1/2/3 时不自动翻页，让支持信息留在眼前
                            const keepHere = isSafetyItem && opt.value >= 1;
                            if (!keepHere && current < totalQuestions - 1) {
                              setTimeout(
                                () => setCurrent((c) => Math.min(totalQuestions - 1, c + 1)),
                                180
                              );
                            }
                          }}
                          className={`cursor-pointer rounded-lg border px-3 py-2 text-center text-sm transition-all ${
                            selected
                              ? "border-primary-600 bg-primary-500 font-medium text-white"
                              : "border-slate-200 bg-white text-slate-600 hover:border-primary-400 hover:bg-primary-50"
                          } disabled:cursor-not-allowed`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                )}
                {q.kind !== 'time' && q.kind !== 'number' && q.hint && (
                  <p className="mt-2 text-xs text-slate-400">{q.hint}</p>
                )}
              </div>

              {isSafetyItem && typeof picked === "number" && picked >= 1 && (
                <div
                  role="status"
                  className="mt-4 rounded-lg border border-primary-200 bg-primary-50/70 p-4"
                >
                  <p className="text-sm leading-6 text-slate-700">
                    谢谢您如实说出来。这样的念头很多人都经历过，它不代表您做错了什么，也不意味着它一定会发生。
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    现在就可以联系：校心理健康教育中心（工作日 8:30–17:30，电话以学校公布为准），或
                    24 小时心理援助热线 <span className="font-medium text-slate-800">12356</span>。
                    如果此刻有立即的危险，请拨打 <span className="font-medium text-slate-800">120</span>
                    ，或请身边的人陪着您。
                  </p>
                </div>
              )}
            </div>
          );
        })()}

        {/* 题目导航：一眼看出哪些题漏了，点一下直接跳过去。
            没有它，跳过几题之后就只能靠"上一题"逐题倒着找。 */}
        <div className="mt-4 flex flex-wrap gap-1.5" aria-label="题目导航">
          {qDef.questions.map((qq, index) => {
            const done = answers[qq.id] !== undefined;
            const active = index === current;
            return (
              <button
                key={qq.id}
                type="button"
                onClick={() => setCurrent(index)}
                disabled={saving}
                aria-current={active ? 'step' : undefined}
                aria-label={`第 ${qq.id} 题，${done ? '已作答' : '未作答'}`}
                title={done ? '已作答' : '未作答'}
                className={`h-7 w-7 cursor-pointer rounded-md text-[11.5px] tabular-nums transition-colors disabled:cursor-not-allowed ${
                  active
                    ? 'bg-primary-500 font-medium text-white'
                    : done
                      ? 'bg-primary-50 text-primary-700 hover:bg-primary-100'
                      : 'border border-dashed border-slate-300 text-slate-400 hover:border-primary-400 hover:text-primary-600'
                }`}
              >
                {qq.id}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            onClick={() => setCurrent((c) => Math.max(0, c - 1))}
            disabled={current === 0 || saving}
            className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 transition-colors hover:border-primary-300 hover:text-primary-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowLeft className="h-4 w-4" /> 上一题
          </button>
          <button
            onClick={() => {
              // 最后一题时不再"禁用"，而是把用户带到第一道没答的题
              if (current >= totalQuestions - 1) jumpToFirstUnanswered();
              else setCurrent((c) => Math.min(totalQuestions - 1, c + 1));
            }}
            disabled={saving || (current >= totalQuestions - 1 && allAnswered)}
            className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 transition-colors hover:border-primary-300 hover:text-primary-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {current >= totalQuestions - 1 && !allAnswered ? '跳到未作答' : '下一题'}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Result & Submit */}
      <div className="px-6 pb-6">
        {saveError && <p role="alert" className="mb-3 text-sm text-danger-600">{saveError}</p>}
        {!submitted ? (
          <div className="flex flex-wrap items-center gap-3">
            {/* 没答满时不再是"灰掉按不动"，而是点了直接跳去补答最前面的空题 */}
            <button
              onClick={() => (allAnswered ? void handleSubmit() : jumpToFirstUnanswered())}
              disabled={saving}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary-500 text-white rounded-lg hover:bg-primary-600 text-sm font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {allAnswered ? <CheckCircle2 className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
              {allAnswered
                ? (saving ? '正在保存…' : '提交并查看结果')
                : `还有 ${totalQuestions - answeredCount} 题未作答 · 去补答`}
            </button>
            {!allAnswered && firstUnanswered && (
              <p className="text-xs text-slate-400">
                下一道要补的是第 {firstUnanswered.id} 题
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-xl border-2 border-primary-200 bg-primary-50/50 p-5 space-y-4">
            <div className="flex items-center gap-4">
              <div>
                <p className="text-xs text-slate-500">总得分</p>
                <p className="text-3xl font-semibold text-slate-800">
                  {totalScore}
                  <span className="text-base font-normal text-slate-400 ml-1">
                    / {maxScore}
                  </span>
                </p>
              </div>
              <div className="flex-1">
                <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      result.level === "red"
                        ? "bg-danger-500"
                        : result.level === "orange"
                          ? "bg-orange-500"
                          : result.level === "yellow"
                            ? "bg-warning-500"
                            : "bg-success-500"
                    }`}
                    style={{ width: `${(totalScore / maxScore) * 100}%` }}
                  />
                </div>
              </div>
              <AlertBadge level={result.level} />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">
                {result.label}
              </p>
              <p className="text-sm text-slate-600 mt-1 leading-6">
                {result.description}
              </p>
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
                className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 text-sm font-medium transition-colors cursor-pointer"
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
