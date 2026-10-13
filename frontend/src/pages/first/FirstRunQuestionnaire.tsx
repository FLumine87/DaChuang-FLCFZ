import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CircleDot,
  Info,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { questionnaires } from "../../data/questionnaireData";
import { getScaleGuide } from "../../data/scaleGuide";
import { submitScreening } from "../../services/mockApi";
import { getCurrentSession } from "../../auth/session";
import {
  getDraft,
  getFirstRunState,
  markFirstScreeningDone,
  saveDraft,
  startDraft,
} from "../../services/firstRun";
import FirstRunShell from "./FirstRunShell";
import { firstRunSteps } from "./firstRunSteps";
import ScaleIntroDialog from "./ScaleIntroDialog";

/**
 * FirstRunQuestionnaire.tsx · 首次引导 01 状态筛查（逐题作答）
 *
 * 按 01-questionnaire.svg / 01c-phq9-item9.svg 两张图 + 图六的修改方案实现。
 * 与工作台里那份通用问卷（components/QuestionnaireForm.tsx）的区别，是刻意分开的两件事：
 *   · 这份是引导流程专用的独立页面，一屏一题、左侧叙事、右侧答题卡，与欢迎页同一套视觉；
 *   · 工作台那份是"随时进来做一份量表"的常规入口，带列表与详情，布局不同、不能共用。
 *   共同点只保留在数据层：同一份 questionnaires 定义、同一个 submitScreening。
 *
 * 图六的几条落在代码里的位置：
 *   1. 卡片顶栏：左「量表名」、右「ⓘ 了解量表」+「第 n / N 题」，介绍入口始终可点；
 *   2. 进度条下方一条低对比度说明栏：左边"回想的时间范围"、右边"选项按什么选"；
 *   3. 题目下方的"在过去两周里……"已删去（与说明栏重复）；
 *   4. 选项下方一行小字说明结果的用途，普通提示样式，不做成警告卡；
 *   5. PHQ-9 第 9 题：支持卡放在选项右侧（窄屏落到下方），标题「需要支持时」，
 *      可展开具体求助方式；它不占用左侧主视觉，也不是量表介绍。
 */
export default function FirstRunQuestionnaire() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const scaleParam = params.get("scale") ?? getFirstRunState().scaleId ?? null;
  const definition = useMemo(
    () => questionnaires.find((item) => item.id === scaleParam),
    [scaleParam],
  );
  const guide = getScaleGuide(scaleParam);

  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [introOpen, setIntroOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  /* 卸载时清掉待执行的翻页定时器，避免在别的页面上改状态。
     放在 hooks 区（早退分支之前）——hooks 不能被条件调用。 */
  useEffect(
    () => () => {
      if (pendingAdvance.current !== null) {
        window.clearTimeout(pendingAdvance.current);
        pendingAdvance.current = null;
      }
    },
    [],
  );

  /* 待执行的"选完自动翻页"定时器。
     必须在早退分支之前声明（hooks 不能被条件调用）。
     用它而不是时间戳锁：时间锁会让手快的人卡住（连续答题时后一次被吞掉），
     而"取消待执行定时器"既能防重、又不会误伤正常节奏。 */
  const pendingAdvance = useRef<number | null>(null);

  /* 进来就落一份草稿：中途回主页/刷新，02、03 还能接着走 */
  useEffect(() => {
    if (!definition) return;
    const draft = getDraft();
    if (!draft || draft.scaleId !== definition.id) startDraft(definition.id);
    window.scrollTo(0, 0);
  }, [definition]);

  if (!definition || !guide) {
    return (
      <FirstRunShell
        step={2}
        eyebrow="01  ·  状态筛查"
        title={<>这份量表暂时不可用。</>}
        body={<>请回到上一步重新选择想了解的方向。</>}
      >
        <div className="ui-card p-6">
          <p className="text-sm text-slate-500">
            没有找到量表 {scaleParam ?? "（未指定）"}。
          </p>
          <Link to="/personal/welcome" className="ui-button ui-button-primary mt-4">
            返回选择方向
          </Link>
        </div>
      </FirstRunShell>
    );
  }

  const questions = definition.questions;
  const total = questions.length;
  const question = questions[current];
  const picked = answers[question.id];
  const answeredCount = Object.keys(answers).length;
  const allAnswered = answeredCount === total;
  const isLast = current === total - 1;
  /* 除了"眼前这一题"之外还漏了哪些题（当前题未作答不算漏） */
  const missingElsewhere = questions
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.id !== question.id && answers[item.id] === undefined);
  /* PHQ-9 第 9 题（伤害自己的念头）：需要就地给出支持信息 */
  const isSafetyItem = definition.id === "PHQ-9" && question.id === 9;

  /* 翻页防重锁：选完会自动翻页，若此刻又按了回车（或回车先触发、随后按钮的默认点击
     又选了一次），两次触发会一次跳两题、漏答一半。450ms 内的重复触发只认一次。 */
  const cancelPendingAdvance = () => {
    if (pendingAdvance.current !== null) {
      window.clearTimeout(pendingAdvance.current);
      pendingAdvance.current = null;
    }
  };

  /* 立即翻页：手动点「下一题」、按回车、跳题都用它。
     关键是先取消待执行的自动翻页——否则"选完（排了 180ms 后翻页）+ 立刻点下一题"
     会翻两次、静默跳掉一题，那一题没答案，末尾的提交按钮就一直是禁用的。 */
  const goNextNow = () => {
    cancelPendingAdvance();
    setCurrent((index) => Math.min(total - 1, index + 1));
  };

  /* 选完延迟 180ms 翻页：让选中态先被看见 */
  const scheduleAdvance = () => {
    cancelPendingAdvance();
    pendingAdvance.current = window.setTimeout(() => {
      pendingAdvance.current = null;
      setCurrent((index) => Math.min(total - 1, index + 1));
    }, 180);
  };

  /* 选完自动翻到下一题（保留「上一题 / 下一题」用于回改）：
     一屏一题时每题都要求"点选项 + 点下一题"，9 题就是 18 次点击，
     走完一遍很累。最后一题不自动翻——提交按钮就在下面。 */
  const choose = (value: number) => {
    setAnswers((prev) => ({ ...prev, [question.id]: value }));
    if (!isLast) scheduleAdvance();
  };

  const submit = async () => {
    if (!allAnswered || saving) return;
    setError("");
    setSaving(true);
    try {
      const totalScore = questions.reduce((sum, item) => sum + (answers[item.id] ?? 0), 0);
      const maxScore = questions[0].options.reduce((max, option) => Math.max(max, option.value), 0) * total;
      const result = definition.scoring(totalScore);
      const response = await submitScreening({
        questionnaire: definition.id,
        score: totalScore,
        maxScore,
        level: result.level,
        answers,
      });
      if (response.status !== "success") throw new Error("筛查尚未保存，请重试");
      saveDraft({
        recordId: response.id,
        score: totalScore,
        maxScore,
        level: result.level,
        /* 03 的卡顶要显示"完成时间"：这里就是量表提交的时刻 */
        completedAt: new Date().toISOString(),
      });
      markFirstScreeningDone(getCurrentSession()?.username);
      navigate("/personal/first/supplement", { replace: true });
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "提交失败，请稍后再试",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <FirstRunShell
      step={2}
      eyebrow="01  ·  状态筛查"
      title={
        isSafetyItem ? (
          <>
            最后一题，
            <br />
            请按真实感受回答。
          </>
        ) : (
          <>
            从这一题开始，
            <br />
            慢慢了解自己。
          </>
        )
      }
      body={
        isSafetyItem ? (
          <>
            可以放慢一点，也可以随时暂停。
            <br />
            旁边的支持信息在作答前就能看到。
          </>
        ) : (
          <>
            请按照过去两周的真实感受作答。
            <br />
            没有标准答案，也不需要着急。
          </>
        )
      }
      steps={firstRunSteps(2)}
      afterBody={isSafetyItem ? <SafetySupportCard /> : undefined}
    >
      {/* ============ 答题卡 ============ */}
      {/* 宽度全程不变（560px）：题目再长也让它自然折行，
          不做"遇到长题就加宽卡片"这种事——换题时卡片忽宽忽窄会很跳。
          第 9 题的支持信息因此放在左栏（与 01c 效果图一致），不挤占选项。 */}
      <div className="mx-auto w-full max-w-[560px] rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_24px_70px_-36px_rgba(16,24,40,0.35)] sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">
            {definition.id} {shortName(definition.id)}
          </h2>
          <div className="flex items-center gap-3">
            {/* 介绍入口始终可点：介绍讲"这是什么"，与作答提示分开 */}
            <button
              type="button"
              onClick={() => setIntroOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] text-slate-500 transition-colors hover:border-primary-200 hover:text-primary-600"
            >
              <Info className="h-3.5 w-3.5" />
              了解 {definition.id}
            </button>
            <span className="whitespace-nowrap text-[13px] text-slate-500">
              第{" "}
              <span className="font-semibold tabular-nums text-slate-800">
                {current + 1}
              </span>{" "}
              / {total} 题
            </span>
          </div>
        </div>

        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-primary-500 transition-all duration-500"
            style={{ width: `${(answeredCount / total) * 100}%` }}
          />
        </div>

        {/* 作答说明栏：每题都在，但不抢题目注意力（图六第 2 条） */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl bg-slate-50 px-3.5 py-2.5 text-[12px] text-slate-500">
          <span className="inline-flex items-center gap-2">
            <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
            {guide.recall}
          </span>
          <span className="inline-flex items-center gap-2">
            <CircleDot className="h-3.5 w-3.5 text-slate-400" />
            {guide.answerHint}
          </span>
        </div>

        <div className="mt-6">
          <div>
            {/* 题目：按自然折行，不用 text-balance —— 平衡折行会在词中间提前断行 */}
            <h3
              key={question.id}
              className="first-run-question question-enter text-[22px] font-medium leading-9 text-slate-900"
            >
              {question.text}
            </h3>

            <div className="mt-5 grid gap-2.5" role="radiogroup" aria-label="选项">
              {question.options.map((option) => {
                const active = picked === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => choose(option.value)}
                    className={`flex w-full items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left text-[15px] transition-all duration-200 ${
                      active
                        ? "border-primary-500 bg-primary-50/70 font-medium text-primary-700 shadow-[0_10px_30px_-20px_rgba(70,95,255,0.6)]"
                        : "border-slate-200 bg-white text-slate-700 hover:border-primary-200 hover:bg-primary-50/40"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors ${
                        active ? "border-primary-500" : "border-slate-300"
                      }`}
                    >
                      {active && (
                        <span className="h-2.5 w-2.5 rounded-full bg-primary-500" />
                      )}
                    </span>
                    {option.label}
                  </button>
                );
              })}
            </div>

            {/* 结果用途：一行小字，普通提示样式（图六第 4 条） */}
            <p className="mt-4 flex items-start gap-2 text-[12px] leading-5 text-slate-400">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              结果用于初步筛查和自我了解，不等同于医学诊断；完成后可查看解释与建议。
            </p>
          </div>

        </div>

        {/* 两个条件都要满足才提示：
            1) 已经走到最后一题（`isLast`）——刚进来第 1 题就弹黄框是打扰；
            2) 漏的是**别的**题（当前题不算）——前面都答完、只剩眼前这一题时，
               提示是多余的，用户正在答它。
            提示里也只列需要回去补的题号。 */}
        {isLast && missingElsewhere.length > 0 && (
          <div className="mt-5 rounded-2xl border border-warning-500/30 bg-warning-50 px-4 py-3">
            <p className="text-[13px] font-medium text-warning-600">
              还有 {missingElsewhere.length} 题未作答，答完才能查看结果
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {missingElsewhere.map(({ index }) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => {
                    cancelPendingAdvance();
                    setCurrent(index);
                  }}
                  className="rounded-lg border border-warning-500/40 bg-white px-2.5 py-1 text-[12px] text-slate-600 transition-colors hover:border-warning-500 hover:text-warning-600"
                >
                  第 {index + 1} 题
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="mt-5 rounded-xl border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-600"
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setCurrent((value) => Math.max(0, value - 1))}
            disabled={current === 0 || saving}
            className="ui-button h-12 flex-1 rounded-xl border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowLeft className="h-4 w-4" />
            上一题
          </button>
          {/* 答满就随时可交：不必一路点「下一题」挪到最后一题。
              从黄框里的题号跳回去补答完，主按钮当场变成「提交并查看结果」。 */}
          {isLast || allAnswered ? (
            <button
              type="button"
              onClick={submit}
              disabled={!allAnswered || saving}
              className="ui-button ui-button-primary h-12 flex-[1.6] rounded-xl disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
              {saving ? "正在保存…" : "提交并查看结果"}
              {!saving && <ArrowRight className="h-4 w-4" />}
            </button>
          ) : (
            <button
              type="button"
              onClick={goNextNow}
              className="ui-button ui-button-primary h-12 flex-[1.6] rounded-xl"
            >
              下一题
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[12px] text-slate-400">
          <Link
            to="/personal/welcome"
            className="transition-colors hover:text-primary-600"
          >
            返回选择方向
          </Link>
          <span aria-hidden="true">·</span>
          <Link
            to="/personal/dashboard"
            className="transition-colors hover:text-primary-600"
          >
            暂停作答
          </Link>
        </div>
      </div>

      {/* 回车 = 下一题；最后一题上等于提交（前提是都答完了）。
          放在子组件里注册 window 监听：本组件在中途有早退分支，
          直接在这里写 useEffect 会变成"有条件地调用 hooks"。 */}
      <EnterToAdvance
        enabled={!introOpen}
        onEnter={() => {
          if (picked === undefined) return false;
          if (isLast) {
            if (!allAnswered) return false;
            void submit();
            return true;
          }
          goNextNow();
          return true;
        }}
      />

      <ScaleIntroDialog
        scaleId={definition.id}
        open={introOpen}
        onClose={() => setIntroOpen(false)}
      />
    </FirstRunShell>
  );
}

/** 「需要支持时」支持卡：默认收起，展开后给具体求助方式 */
function SafetySupportCard() {
  const [open, setOpen] = useState(false);
  return (
    <aside className="mt-8 max-w-[520px] rounded-2xl border border-primary-200 bg-white/70 p-4 backdrop-blur-sm sm:p-5">
      <h4 className="flex items-center gap-2 text-[15px] font-semibold text-slate-800">
        <span
          aria-hidden="true"
          className="grid h-5 w-5 place-items-center rounded-full bg-primary-500 text-[12px] font-semibold text-white"
        >
          i
        </span>
        需要支持时
      </h4>
      <p className="mt-2.5 text-[13px] leading-6 text-slate-600">
        无论选择哪一项，你都可以先停下来寻求支持。
      </p>

      {open ? (
        <div className="mt-3 grid gap-3 border-t border-primary-100 pt-3">
          <div>
            <p className="text-[13px] font-medium text-slate-700">可以联系</p>
            <p className="mt-1 text-[12px] leading-6 text-slate-600">
              信任的人、学校心理中心或心理援助热线
            </p>
          </div>
          <div>
            <p className="text-[13px] font-medium text-slate-700">
              如果此刻有立即危险
            </p>
            <p className="mt-1 text-[12px] leading-6 text-slate-600">
              请让身边的人陪伴，并联系当地急救服务。
            </p>
          </div>
          <p className="text-[12px] leading-5 text-slate-400">
            正式上线时应补充学校已核实的联系方式和服务时间。
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          className="mt-3 text-[13px] font-medium text-primary-600 transition-colors hover:text-primary-700"
        >
          查看具体求助方式
        </button>
      )}
    </aside>
  );
}

/** 卡片顶栏用的短名：PHQ-9 → 情绪筛查（与效果图一致） */
function shortName(id: string): string {
  const map: Record<string, string> = {
    "PHQ-9": "情绪筛查",
    "GAD-7": "焦虑筛查",
    ISI: "睡眠评估",
    "PSS-10": "压力评估",
  };
  return map[id] ?? "";
}

/**
 * 回车进入下一题。
 *
 * 为什么单独做一个组件：作答页在中途有早退分支（量表不存在时渲染兜底卡），
 * 直接把 useEffect 写在页面组件里会变成"有条件地调用 hooks"，
 * 违反 hooks 规则。子组件只管注册键盘，不参与早退。
 *
 * 只在真的处理了这次回车时才 preventDefault：焦点落在选项按钮上时，
 * 浏览器默认会把回车当成一次点击——那样会再选一次并再排一次翻页，
 * 静默地跳过一题。这里拦掉默认行为，翻页只由 onEnter 触发一次。
 */
function EnterToAdvance({
  enabled,
  onEnter,
}: {
  enabled: boolean;
  onEnter: () => boolean;
}) {
  useEffect(() => {
    if (!enabled) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.repeat || event.metaKey || event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      /* 文本域 / 可编辑区里的回车是换行，不能抢 */
      if (target && (target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (onEnter()) event.preventDefault();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [enabled, onEnter]);
  return null;
}
