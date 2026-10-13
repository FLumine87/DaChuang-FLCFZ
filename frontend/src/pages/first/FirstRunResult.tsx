import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  ClipboardList,
  Info,
  Network,
  Sparkles,
} from "lucide-react";
import {
  questionnaires,
  type AlertLevel,
  type QuestionnaireDefinition,
} from "../../data/questionnaireData";
import { getDraft } from "../../services/firstRun";
import FirstRunShell from "./FirstRunShell";
import { firstRunSteps } from "./firstRunSteps";

/**
 * FirstRunResult.tsx · 首次引导 03 本次结果
 *
 * 按「本次筛查报告卡」重做：右边合成**一张**卡，从上到下是
 *   顶部（本次筛查结果 + 量表名/完成时间）→ 核心结果（得分，切换标签时始终可见）
 *   → 三个标签（结果摘要 / 分析依据 / 后续建议）→ 底部操作按钮。
 * 之前是"得分卡 + 结论来自哪里 + 下一步"三块横着摆，得分最小、依据最大、
 * 按钮又单独一块，用户看完要在几处之间找重点；现在一次只讲一件事。
 *
 * 三类刻意的写法（都为了不说过头的话）：
 *   1. PSS-10 不走临床分级：PSS 作者实验室明确说它不是诊断工具、没有统一截断值，
 *      所以不写"中度压力"，也没有四色风险条，只写"本次压力感受记录 + 得分 +
 *      量表范围 0–40"，配一条 0–40 的简单刻度（表示量表得分，不是百分比）。
 *      PHQ-9 / GAD-7 / ISI 有通行的严重程度分档，仍显示分档条。
 *   2. 没有历史数据就不画趋势、不提"比上次改善"。
 *   3. 哈希检索与 RAG 尚未参与本次结果：放在「分析依据」里作为可展开的
 *      「了解分析技术」条目，并写明尚未参与；不把它们摆在结论里冒充依据。
 */
export default function FirstRunResult() {
  const draft = getDraft();
  const definition = questionnaires.find((item) => item.id === draft?.scaleId);
  const [tab, setTab] = useState<"summary" | "evidence" | "advice">("summary");

  if (!draft?.recordId || !definition || draft.score === undefined || draft.maxScore === undefined) {
    return (
      <FirstRunShell
        step={4}
        eyebrow="03  ·  本次结果"
        title={<>还没有可以展示的结果。</>}
        body={<>先完成一份量表，这里会显示本次的分数与解释。</>}
      >
        <div className="ui-card p-6">
          <p className="text-sm text-slate-500">
            当前会话里没有本次筛查记录，可能刷新过或换了标签页。
          </p>
          <Link to="/personal/first/questionnaire" className="ui-button ui-button-primary mt-4">
            重新作答
          </Link>
        </div>
      </FirstRunShell>
    );
  }

  const score = draft.score ?? 0;
  const maxScore = draft.maxScore ?? 0;
  const result = definition.scoring(score);
  const isPss = definition.id === "PSS-10";
  const supplement = draft.supplement;
  const supplementText = supplement?.text?.trim();
  const hasSupplement = Boolean(supplementText || supplement?.filename);
  /* 用 completedAt（量表提交时刻）而不是 updatedAt：后者在 02 补充后会被刷新 */
  const completedAt = formatTime(draft.completedAt ?? draft.updatedAt);

  return (
    <FirstRunShell
      step={4}
      wide
      alignTop
      eyebrow="03  ·  本次结果"
      title={
        <>
          了解当下，
          <br />
          接下来有方向。
        </>
      }
      body={
        <>
          本次结果帮助你了解近期状态。
          <br />
          也为之后的记录提供参考。
        </>
      }
      steps={firstRunSteps(4)}
    >
      {/* ============ 本次筛查报告卡 ============ */}
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_24px_70px_-36px_rgba(16,24,40,0.35)] sm:p-7">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-base font-semibold text-slate-900">本次筛查结果</h2>
          <p className="text-[12px] text-slate-400">
            {definition.id} · {definition.name.replace(`${definition.id} `, "")}
            {completedAt ? ` · 完成于 ${completedAt}` : ""}
          </p>
        </div>

        {/* 核心结果：得分在标签上方，切到「分析依据」也仍然看得见 */}
        <div className="mt-4">
          {isPss ? (
            <PssScore score={score} maxScore={maxScore} />
          ) : (
            <div>
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                <p className="text-[40px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums">
                  {score}
                  <span className="ml-1 text-base font-normal text-slate-400">
                    / {maxScore} 分
                  </span>
                </p>
                <span
                  className={`rounded-full px-3 py-1 text-[13px] font-medium ${LEVEL_LOOK[result.level].pill}`}
                >
                  {result.label}
                </span>
              </div>
              <div className="mt-4 flex gap-1.5">
                {bands(definition, maxScore).map((band) => (
                  <span
                    key={`${band.from}-${band.label}`}
                    title={band.label}
                    className={`h-2 flex-1 rounded-full ${
                      score >= band.from && score <= band.to ? band.color : "bg-slate-100"
                    }`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 内容导航 */}
        <div
          className="mt-6 flex gap-1 rounded-xl bg-slate-100 p-1"
          role="tablist"
          aria-label="报告内容"
        >
          {(
            [
              { id: "summary", label: "结果摘要" },
              { id: "evidence", label: "分析依据" },
              { id: "advice", label: "后续建议" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`flex-1 rounded-lg py-2.5 text-[13px] font-medium transition-all ${
                tab === item.id
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* 内容区：随标签切换，只展示对应信息 */}
        <div className="mt-5">
          {tab === "summary" && (
            <div className="grid gap-3">
              {/* 结论与免责声明必须拉开层级：原来两句都是 14/12px 的灰字，
                  在深色下几乎分不出主次。结论用近黑 + 中等字重、字号提一档，
                  免责声明保持小号浅灰，一眼就能看出哪句是本次结果。 */}
              <p className="text-[17px] font-medium leading-8 text-slate-900">
                {isPss
                  ? "本次记录反映你过去一个月的主观压力感受。之后可以结合生活情况，回看自己的得分变化。"
                  : result.description}
              </p>
              <p className="text-[12px] leading-5 text-slate-400">
                {isPss
                  ? "PSS-10 不用于诊断心理疾病，也没有统一的临床分界值；上面的分组是系统参考分组，不是临床结论。"
                  : "筛查结果仅供自我了解，不等同于医学诊断。"}
              </p>
            </div>
          )}

          {tab === "evidence" && (
            <div className="grid gap-3">
              <EvidenceItem
                icon={ClipboardList}
                title="本次作答与补充"
                summary={`${definition.id} 共 ${definition.questions.length} 题${
                  hasSupplement ? "，并补充了一条记录" : "，未补充其他内容"
                }`}
              >
                <p>
                  量表：{definition.name}（{definition.instructions}）
                </p>
                <p className="mt-1.5">
                  补充内容：
                  {supplementText
                    ? `「${supplementText}」`
                    : supplement?.filename
                      ? `${supplement.filename}（${
                          supplement.kind === "audio" ? "语音" : "图片"
                        }）`
                      : "本次未补充"}
                </p>
              </EvidenceItem>

              <EvidenceItem
                icon={Network}
                title="动态跨模态哈希检索"
                summary="多模态线索的相似模式匹配"
                pending
              >
                <p>
                  这一版尚未参与本次结果：接通后会在这里给出本次检索得到的相关线索摘要，
                  只展示依据摘要，不展示其他人的原始资料。
                </p>
              </EvidenceItem>

              <EvidenceItem
                icon={BookOpen}
                title="RAG 参考资料"
                summary="结合心理知识库组织解释与建议"
                pending
              >
                <p>
                  这一版尚未参与本次结果：接通后会在这里列出解释与建议对应的知识来源，可点击查看。
                </p>
              </EvidenceItem>
            </div>
          )}

          {tab === "advice" && (
            <ul className="grid gap-4">
              {adviceList(result.level).map((item) => (
                <li key={item.title} className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary-600">
                    <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium text-slate-800">{item.title}</p>
                    <p className="mt-1 text-[13px] leading-6 text-slate-500">{item.desc}</p>
                    {item.action && (
                      <Link
                        to={item.action.to}
                        className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-medium text-primary-600 transition-colors hover:text-primary-700"
                      >
                        {item.action.label}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 底部操作：只留一个出口。原先还有个「查看本次记录」，
            它指向工作台那套旧的记录详情页——而结果已经完整体现在这张卡上，
            没必要再把人送走一趟。 */}
        <div className="mt-6 border-t border-slate-100 pt-5">
          <Link
            to="/personal/dashboard"
            className="ui-button ui-button-primary h-12 w-full rounded-xl"
          >
            进入个人主页
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </FirstRunShell>
  );
}

/* ---------------------------------------------------------------- 子组件 */

/** 「分析依据」里的一条可展开条目 */
function EvidenceItem({
  icon: Icon,
  title,
  summary,
  pending = false,
  children,
}: {
  icon: typeof Info;
  title: string;
  summary: string;
  pending?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-primary-500">
          <Icon className="h-4 w-4" strokeWidth={1.7} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-medium text-slate-800">{title}</span>
            {pending && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                了解分析技术
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-[12px] text-slate-500">{summary}</span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="border-t border-slate-200 px-3.5 py-3 text-[12px] leading-6 text-slate-600">
          {children}
        </div>
      )}
    </div>
  );
}

/** PSS-10 的得分展示：不做临床分级，只给量表范围与一条定位刻度 */
function PssScore({ score, maxScore }: { score: number; maxScore: number }) {
  const percent = maxScore > 0 ? Math.min(100, Math.max(0, (score / maxScore) * 100)) : 0;
  return (
    <div>
      <p className="text-[13px] text-slate-500">本次压力感受记录</p>
      <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
        <p className="text-[40px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums">
          {score}
          <span className="ml-1.5 text-base font-normal text-slate-400">分</span>
        </p>
        <p className="text-[13px] text-slate-500">量表范围 0–{maxScore}</p>
      </div>
      <div className="mt-4">
        <div className="relative h-2 rounded-full bg-slate-100">
          <span
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary-500 shadow"
            style={{ left: `${percent}%` }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-slate-400">
          <span>0</span>
          <span>{maxScore}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 工具 */

const LEVEL_LOOK: Record<AlertLevel, { pill: string }> = {
  green: { pill: "bg-success-50 text-success-600" },
  yellow: { pill: "bg-warning-50 text-warning-600" },
  orange: { pill: "bg-orange-50 text-orange-600" },
  red: { pill: "bg-danger-50 text-danger-600" },
};

/** 完成时间：草稿里存的是 ISO，这里只取到分钟 */
function formatTime(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** 分档条：在 0..满分 上按量表自己的阈值扫出区间（与筛查结果页永远一致） */
function bands(definition: QuestionnaireDefinition, maxScore: number) {
  const colorOf: Record<AlertLevel, string> = {
    green: "bg-success-500",
    yellow: "bg-warning-500",
    orange: "bg-orange-500",
    red: "bg-danger-500",
  };
  const out: { from: number; to: number; label: string; level: AlertLevel }[] = [];
  let start = 0;
  let current = definition.scoring(0);
  for (let value = 1; value <= maxScore; value += 1) {
    const next = definition.scoring(value);
    if (next.label !== current.label) {
      out.push({ from: start, to: value - 1, label: current.label, level: current.level });
      start = value;
      current = next;
    }
  }
  out.push({ from: start, to: maxScore, label: current.label, level: current.level });
  return out.map((band) => ({ ...band, color: colorOf[band.level] }));
}

/** 后续建议：两三条，短标题 + 一句说明，相关操作跟在旁边 */
function adviceList(level: AlertLevel) {
  const list: {
    title: string;
    desc: string;
    action?: { label: string; to: string };
  }[] = [];

  if (level === "red" || level === "orange") {
    list.push({
      title: "尽快找专业人员聊一次",
      desc: "这次结果提示近期状态值得关注。学校心理中心、心理咨询师或医疗专业人员都可以，越早越有帮助。",
    });
  } else {
    list.push({
      title: "保持记录的习惯",
      desc: "隔一段时间再做一次同样的量表，对照自己的变化比看单次分数更有意义。",
    });
  }

  list.push({
    title: "补一条近况记录",
    desc: "文字、语音或图片都可以，让后面的分析多一条线索。",
    action: { label: "去多模态采集", to: "/personal/data-collection" },
  });

  /* 只留两条：第三条原本是"回看完整记录"，指向的旧记录页已经不再从引导里进入 */
  return list.slice(0, 2);
}
