/* 个人端首页（改版）
 *
 * 版式来自 design/home-redesign/home-k.html（样张）。
 * 首页按「这次测出来什么 → 近期怎么样 → 今天做什么」三段组织：
 *
 *   ① 近期的检测结果：把量表分数、跨模态检索命中、RAG 解释、
 *      以及"预警/已同步"并成同一张卡，按 结论 → 依据 → 建议 → 去向 排。
 *      （原先预警是独立一块，信息单薄，且与本次检测本是一件事。）
 *   ② 近期：只放系统真有的产出 —— 记录频次、模态分布、检索命中；
 *      睡眠/情绪/压力三条曲线是前端 mock 造的，已撤。
 *   ③ 今天可以做的：两个动作（记录 / 评估）并进这一块，与行动清单一处。
 *
 * 分数带不另写阈值表：拿量表自己的 scoring() 在 0..满分 上扫一遍，
 * 分档因此永远与「筛查结果页」一致。
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getDashboardData, type DashboardResponse } from "../services/mockApi";
import { questionnaires, type QuestionnaireDefinition } from "../data/questionnaireData";
import {
  retrievalResults,
  type AlertLevel,
  type PersonalScreeningRecord,
} from "../data/mockData";
import { getDraft } from "../services/firstRun";

/* ------------------------------------------------------------------ 小工具 */

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

function todayLabel() {
  const d = new Date();
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 星期${WEEKDAYS[d.getDay()]}`;
}

/** 用各量表自己的 scoring() 扫出分档，避免另写一张阈值表 */
function scoringBands(
  definition: QuestionnaireDefinition | undefined,
  maxScore: number,
): { level: AlertLevel; from: number; to: number }[] {
  if (!definition || maxScore <= 0) return [];
  const bands: { level: AlertLevel; from: number; to: number }[] = [];
  for (let score = 0; score <= maxScore; score += 1) {
    const level = definition.scoring(score).level;
    const last = bands[bands.length - 1];
    if (last && last.level === level) last.to = score;
    else bands.push({ level, from: score, to: score });
  }
  return bands;
}

/** 等级外观沿用旧版口径：稳定 / 关注 / 警告 / 高危，分数带与预警列表共用 */
const LEVEL_LABEL: Record<string, string> = {
  green: "稳定",
  yellow: "关注",
  orange: "警告",
  red: "高危",
};
/** 行动计划 / 预警的处理状态 */
const STATUS_META: Record<string, { label: string; cls: string }> = {
  new: { label: "新触发", cls: "bg-danger-50 text-danger-600" },
  tracking: { label: "跟踪中", cls: "bg-primary-50 text-primary-600" },
  resolved: { label: "已解决", cls: "bg-success-50 text-success-600" },
};
const LEVEL_TEXT: Record<string, string> = {
  green: "text-success-600",
  yellow: "text-warning-600",
  orange: "text-orange-600",
  red: "text-danger-600",
};
const LEVEL_DOT: Record<string, string> = {
  green: "bg-success-500",
  yellow: "bg-warning-500",
  orange: "bg-orange-500",
  red: "bg-danger-500",
};
const LEVEL_BAR: Record<string, string> = {
  green: "bg-success-500",
  yellow: "bg-warning-500",
  orange: "bg-orange-500",
  red: "bg-danger-500",
};

/** 记录上的模态标记：用户自愿补充的那条记录才有 supplement */
/* 用户还没写补充内容时的占位样例。
   出处：backend/data/hashing/corpus.db → units 表 → unit_id = 'R0001-txt'（真实语料原文）。
   为什么用它：新用户进来「本次输入」是空的，只放一句干巴巴的提示看不出"输入长什么样"；
   放一条系统里真实存在的历史自述，既能示意格式，又不会让人误以为是自己的记录
   —— 所以下面必须带「样例」标记。 */
const SAMPLE_INPUT =
  "最近这段时间，考试前脑子一片空白；像被一层灰蒙住，看不到出路，这种情况已经持续一阵了。";

function modalityOf(r: PersonalScreeningRecord) {
  const kind = r.supplement?.kind;
  if (kind === "audio") return "语音";
  if (kind === "image") return "图像";
  return "文本";
}

/* ------------------------------------------------------------------ 页面 */

export default function Dashboard() {
  /* 首屏排版参数（已在调参面板里定稿，面板已移除） */
  const tune = {
    line1: 20, line1Gap: 16,
    title: 54, sub: 16, gap: 28, offset: 0, btnPad: 8,
    align: "left" as "left" | "center" | "right", btnGap: 12,
    btnPos: "inline" as "inline" | "bottom",
  } as const;
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getDashboardData()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "加载失败");
      });
    return () => {
      alive = false;
    };
  }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const records = data.screeningRecords ?? [];
    const last = records[0];
    const def = questionnaires.find((q) => q.id === last?.questionnaire);
    const bands = scoringBands(def, last?.maxScore ?? 0);
    const result = def && last ? def.scoring(last.score) : null;

    const counts: Record<string, number> = { 文本: 0, 语音: 0, 图像: 0 };
    records.forEach((r) => {
      const k = modalityOf(r);
      counts[k] = (counts[k] ?? 0) + 1;
    });
    const maxCount = Math.max(1, ...Object.values(counts));

    const warning = (data.warningEvents ?? []).find((w) => w.status !== "resolved");

    /* 旧版口径：行动计划按预警等级在前面补一条，再拼上原定三条 */
    const levelPlan =
      warning?.level === "red"
        ? [{ id: "PLAN-ALERT-RED", title: "预约心理辅导", duration: "本周内", status: "new" as const }]
        : warning?.level === "orange"
          ? [{ id: "PLAN-ALERT-ORANGE", title: "与可信赖的人聊一聊", duration: "本周内", status: "new" as const }]
          : warning?.level === "yellow"
            ? [{ id: "PLAN-ALERT-YELLOW", title: "继续每日情绪记录", duration: "每日", status: "new" as const }]
            : [];
    const planItems = [...levelPlan, ...(data.actionPlan ?? [])];

    /* 「最近预警」按数据里最新的那个月统计，避免演示数据（3 月）恒显示 0 */
    const warnings = data.warningEvents ?? [];
    const latestMonth = warnings[0]?.createdAt.slice(0, 7) ?? "";
    const monthWarnings = warnings.filter((w) => w.createdAt.startsWith(latestMonth));
    const monthCounts = monthWarnings.reduce<Record<string, number>>((acc, w) => {
      const label = LEVEL_LABEL[w.level] ?? "—";
      acc[label] = (acc[label] ?? 0) + 1;
      return acc;
    }, {});

    /* 「本次输入」：优先取首次引导里刚提交的那条补充；
       没有就退回最近一条记录自带的 supplement。新用户两条都空。 */
    const draft = getDraft();
    const supplement = draft?.supplement ?? records[0]?.supplement;
    const input =
      supplement?.kind === "text"
        ? { kind: "text" as const, text: supplement.text ?? "" }
        : supplement?.kind === "audio"
          ? { kind: "audio" as const, text: "" }
          : supplement?.kind === "image"
            ? { kind: "image" as const, text: "" }
            : null;

    /* 检索结果：取相似度最高的一条，其余用「还有 N 条」带过（版面只放得下一条） */
    const matched = [...retrievalResults].sort((a, b) => b.similarity - a.similarity);

    return {
      name: data.userProfile?.name ?? "",
      input,
      top: matched[0],
      restCount: Math.max(0, matched.length - 1),
      date: todayLabel(),
      records,
      last,
      def,
      bands,
      result,
      counts,
      maxCount,
      warning,
      planItems,
      monthWarnings,
      monthBreakdown: Object.entries(monthCounts)
        .map(([k, v]) => `${k} ${v}`)
        .join(" · "),
    };
  }, [data]);

  if (error) {
    return <div className="ui-card p-6 text-sm text-slate-600">首页数据加载失败：{error}</div>;
  }
  if (!view) {
    return (
      <div className="grid gap-5">
        <div className="h-[80px] animate-pulse rounded-2xl bg-slate-100" />
        <div className="h-[420px] animate-pulse rounded-2xl bg-slate-100" />
        <div className="h-[200px] animate-pulse rounded-2xl bg-slate-100" />
      </div>
    );
  }

  const level = view.last?.level ?? "green";
  const activeBand = view.bands.findIndex(
    (b) => view.last && view.last.score >= b.from && view.last.score <= b.to
  );
  const hasVoiceOrImage = view.counts["语音"] + view.counts["图像"] > 0;

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,430px)]">
      {/* ============ 首屏：左标题 + 右「今日行动计划」（缩小后移到右上角） ============ */}
      {/* 左栏：标题 + 灰字 + 两个动作，整块在左栏内垂直居中（对齐右侧计划卡的高度） */}
      <div className="lg:flex lg:flex-col lg:justify-center" style={{ paddingTop: tune.offset }}>
      <header>
        <p className="font-medium leading-none" style={{ fontSize: tune.line1 }}>
          <span className="text-primary-500">
            {greeting()}
            {view.name ? `，${view.name}` : ""}
          </span>
          <span className="text-slate-400"> · {view.date}</span>
        </p>
        <h1 className="font-medium leading-[1.14] tracking-[0.25px] text-slate-900" style={{ fontSize: tune.title, marginTop: tune.line1Gap }}>
          你最近的状态，都在这里
        </h1>
        {/* 灰体小字：一句话交代这一页有什么，避免标题后面直接跳到大卡片 */}
        <p className="mt-4 leading-8 text-slate-500 lg:whitespace-nowrap" style={{ fontSize: tune.sub }}>
          近期的检测结果、最近一段时间的记录，以及需要你留意的地方，都整理在这一页。
        </p>
      </header>
        {/* 两个动作：从「今日行动计划」卡里拿出来，放到标题灰字下面 */}
        <div
          className="flex flex-wrap items-center"
          style={{
            marginTop: tune.btnPos === "bottom" ? "auto" : tune.gap,
            paddingTop: tune.btnPos === "bottom" ? tune.gap : 0,
            gap: tune.btnGap,
            justifyContent: tune.align,
          }}
        >
          <ActionStack
            padY={tune.btnPad}
            to="/personal/data-collection"
            primary
            title="记录一下现在"
            meta={view.last ? `${view.last.date} 记过一次` : "今天还没有记录"}
          />
          <ActionStack
            padY={tune.btnPad}
            to="/personal/screening"
            title="评估心理状态"
            meta={
              view.last
                ? `上次评估 ${view.last.date} · 建议每 2 周一次`
                : "还没做过评估 · 约 3 分钟"
            }
          />
        </div>
      </div>

      {/* ============ ③ 今日行动计划（右栏） ============ */}
        <section className="ui-card p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-semibold text-slate-900">今日行动计划</h2>
              <p className="mt-1 text-[13px] text-slate-500">
                从一件小事开始，为自己留一点时间
              </p>
            </div>
            <span className="text-[12.5px] tabular-nums text-slate-400">
              {view.planItems.length} 项
            </span>
          </div>


          <hr className="my-5 border-slate-100" />

          <ul className="grid gap-4">
            {view.planItems.map((plan, index) => (
              <li
                key={plan.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-xs font-medium tabular-nums text-primary-500">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium text-slate-700">
                      {plan.title}
                    </p>
                    <p className="mt-1 text-[12.5px] text-slate-400">
                      建议时长 · {plan.duration}
                    </p>
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[12.5px] font-medium ${
                    STATUS_META[plan.status]?.cls ?? "bg-slate-100 text-slate-500"
                  }`}
                >
                  {STATUS_META[plan.status]?.label ?? plan.status}
                </span>
              </li>
            ))}
          </ul>
        </section>

      {/* ==================== 常驻求助条 ==================== */}
      </div>


      {/* ============ ① 近期的检测结果（取最近一条记录，新用户就是刚做的那次）：内部分三栏，压到与下面一排同高 ============ */}
      <section className="ui-card p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="text-[20px] font-semibold text-slate-900">近期的检测结果</h2>
            <p className="mt-1 text-[13px] text-slate-500">
              {view.last
                ? `${view.last.date} 完成 · ${view.def?.name ?? view.last.questionnaire}`
                : "还没有检测记录"}
            </p>
          </div>
        </div>

        {view.last ? (
          <>
            <div className="mt-5 grid gap-6 border-t border-slate-100 pt-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-8">
              {/* 栏一：量表给的分数 */}
              <div>
                <p className="text-[13px] text-slate-400">量表给的分数</p>
                <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="flex items-baseline gap-2">
                    <span className="text-[34px] font-semibold leading-none tabular-nums text-slate-900">
                      {view.last.score}
                    </span>
                    <span className="text-[14px] text-slate-400">/ {view.last.maxScore}</span>
                    {/* 等级胶囊从卡片右上角挪到分数旁边：它描述的就是这个分值 */}
                    <span
                      className={`ml-1 inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-0.5 text-[12.5px] font-medium ${LEVEL_TEXT[level]}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_DOT[level]}`} />
                      {LEVEL_LABEL[level]}
                    </span>
                  </span>
                  <span className="text-[14px] font-medium text-slate-600">
                    {LEVEL_LABEL[level]}范围
                  </span>
                </div>
                <p className="mt-1.5 text-[12.5px] text-slate-400">
                  {view.result?.label ?? "—"}（量表自身分档）
                </p>

                {/* 分数带：段下带 稳定/关注/警告/高危，口径与「最近预警」一致 */}
                <div className="mt-4 flex gap-1.5">
                  {view.bands.map((b, i) => (
                    <span
                      key={i}
                      className={`h-2 flex-1 rounded-full ${
                        i === activeBand ? LEVEL_BAR[b.level] : "bg-slate-200/70"
                      }`}
                    />
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap justify-between gap-x-2 text-[11.5px] text-slate-400">
                  {view.bands.map((b, i) => (
                    <span key={i} className={i === activeBand ? "font-semibold text-slate-600" : ""}>
                      {b.from}–{b.to} {LEVEL_LABEL[b.level]}
                    </span>
                  ))}
                </div>
              </div>

              {/* 栏二：检索 */}
              <div className="lg:border-l lg:border-slate-100 lg:pl-8">
                <p className="flex items-center gap-1.5 text-[13px] text-slate-400">
                  本次输入
                  {!view.input && (
                    <span className="rounded bg-slate-100 px-1 text-[11px] font-medium text-slate-400">
                      样例
                    </span>
                  )}
                </p>
                {view.input ? (
                  view.input.kind === "text" ? (
                    /* 文本：原文照展 —— 这是用户自己写的，也是检索真正用的那条 query */
                    <p className="mt-2 line-clamp-2 border-l-2 border-slate-200 pl-3 text-[13.5px] leading-[1.6] text-slate-700">
                      「{view.input.text}」
                    </p>
                  ) : (
                    /* 语音 / 图像：只说明模态，不展示原始文件 */
                    <p className="mt-2 text-[14px] leading-[1.7] text-slate-600">
                      你上传了{view.input.kind === "audio" ? "一段语音" : "一张图片"}
                      —— 系统提取其特征后参与跨模态比对，原始文件不在首页展示。
                    </p>
                  )
                ) : (
                  <p className="mt-2 line-clamp-2 border-l-2 border-slate-200 pl-3 text-[13.5px] leading-[1.6] text-slate-500">
                    「{SAMPLE_INPUT}」
                  </p>
                )}

                {view.top && (
                  <>
                    <div className="mt-4 rounded-xl border border-slate-100 p-3">
                      <p className="text-[12px] text-slate-400">检索到的最相似记录</p>
                      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
                        <span className="flex items-baseline gap-2">
                          <span className="text-[13.5px] font-medium tabular-nums text-slate-700">
                            {view.top.id}
                          </span>
                          <span className="text-[12px] text-slate-400">
                            {view.top.date}
                          </span>
                        </span>
                        <span className="flex items-baseline gap-2">
                          <span
                            className={`text-[12.5px] font-medium ${LEVEL_TEXT[view.top.alertLevel]}`}
                          >
                            {LEVEL_LABEL[view.top.alertLevel]}
                          </span>
                          <span className="text-[15px] font-semibold tabular-nums text-slate-900">
                            {Math.round(view.top.similarity * 100)}%
                          </span>
                        </span>
                      </div>
                      <p className="mt-1.5 line-clamp-1 text-[13px] leading-[1.6] text-slate-600">
                        {view.top.summary}
                      </p>
                      <div className="mt-1.5 flex items-center justify-end">
                        <Link
                          to="/personal/retrieval"
                          className="text-[12px] text-primary-600 hover:text-primary-700"
                        >
                          还有 {view.restCount} 条 →
                        </Link>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* 栏三：RAG */}
              <div className="lg:border-l lg:border-slate-100 lg:pl-8">
                <p className="text-[13px] text-slate-400">RAG 给出的解释与建议</p>
                <p className="mt-2 text-[14px] leading-[1.7] text-slate-600">
                  入睡困难与注意力下降在你自己的历史里反复出现过；恢复较快的几条，
                  都是从「先把睡眠拉回来」开始的。
                </p>
                <ul className="mt-3 grid gap-1 text-[13.5px] leading-[1.7] text-slate-600">
                  <li>· 本周内预约一次校心理中心</li>
                  <li>· 睡前 30 分钟离开屏幕</li>
                  <li>· 继续每天记一条（缺语音/图像会打折）</li>
                </ul>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <span className="text-[12.5px] text-slate-400">
                {view.warning
                  ? `已同步给值班咨询师 · ${view.warning.createdAt}`
                  : "尚未达到需要人工介入的等级"}
              </span>
              <span className="flex items-center gap-3">
                {/* 两个入口与卡内三栏一一对应：
                    「检索到了什么 / RAG 解释与建议」→ 检索与分析；
                    「量表给的分数」→ 我的档案里的这条记录 */}
                <Link to="/personal/retrieval" className="ui-button ui-button-primary">
                  查看检索依据
                </Link>
                <Link to="/personal/screening" className="ui-button">
                  查看本次报告
                </Link>
              </span>
            </div>
          </>
        ) : (
          <p className="mt-5 border-t border-slate-100 pt-4 text-[14px] text-slate-500">
            还没有检测记录 —— 从下面「评估心理状态」开始，大约 3 分钟。
          </p>
        )}
      </section>

      {/* ============ ② 近期（左） + 最近预警（右） ============ */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)]">
        <section className="ui-card p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-[13px] text-slate-400">最近 30 天</span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2.5 py-1 text-[13px] font-medium ${LEVEL_TEXT[level]}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_DOT[level]}`} />
              {LEVEL_LABEL[level]}
            </span>
          </div>

          <p className="mt-3 text-[24px] font-semibold leading-[1.3] text-slate-900">
            这 30 天你记录了 {view.records.length} 次
          </p>

          <div className="mt-5">
            {(["文本", "语音", "图像"] as const).map((k) => (
              <div
                key={k}
                className="grid grid-cols-[44px_minmax(0,1fr)_32px] items-center gap-4 py-2.5"
              >
                <span className="text-[14px] text-slate-400">{k}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className="block h-full rounded-full bg-primary-500"
                    style={{ width: `${(view.counts[k] / view.maxCount) * 100}%` }}
                  />
                </span>
                <b className="text-right text-[14px] tabular-nums text-slate-700">
                  {view.counts[k]}
                </b>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[12.5px] leading-[1.75] text-slate-400">
            {hasVoiceOrImage
              ? `语音 ${view.counts["语音"]} 次、图像 ${view.counts["图像"]} 次 —— 三种线索都在，跨模态比对才立得住。`
              : "目前还只有文字记录 —— 补一条语音或传一张图，跨模态比对才立得住。"}
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 lg:mt-auto">
            <div>
              <p className="text-[13px] text-slate-400">检索命中</p>
              <p className="mt-1.5 text-[15px] text-slate-600">
                <b className="text-[20px] tabular-nums text-slate-900">8</b> 个相似历史模式
              </p>
            </div>
            <Link to="/personal/retrieval" className="ui-button">
              看命中明细
            </Link>
          </div>
        </section>

        <section className="ui-card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[20px] font-semibold text-slate-900">最近预警</h2>
              <p className="mt-1 text-[13px] text-slate-500">
                {view.monthWarnings.length
                  ? `本月 ${view.monthWarnings.length} 条 · ${view.monthBreakdown}`
                  : "本月暂无新提醒"}
              </p>
            </div>
            <Link
              to="/personal/alerts"
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12.5px] text-slate-600 hover:border-primary-300 hover:text-primary-600"
            >
              {view.monthWarnings.length > 2 ? `全部 ${view.monthWarnings.length} 条` : '全部'}
            </Link>
          </div>

          <ul className="mt-4 grid gap-3">
            {view.monthWarnings.slice(0, 2).map((alert) => (
              <li key={alert.id} className="rounded-xl border border-slate-100 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12.5px] tabular-nums text-slate-400">
                    {alert.createdAt}
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-[12.5px] font-medium ${LEVEL_TEXT[alert.level]}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${LEVEL_DOT[alert.level]}`}
                      />
                      {LEVEL_LABEL[alert.level]}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[12.5px] ${
                        STATUS_META[alert.status]?.cls ?? "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {STATUS_META[alert.status]?.label ?? alert.status}
                    </span>
                  </span>
                </div>
                <p className="mt-2 text-[14px] font-medium text-slate-700">{alert.title}</p>
                <p className="mt-1.5 text-[12.5px] leading-5 text-slate-500">
                  {alert.reason}
                </p>
              </li>
            ))}
            {!view.monthWarnings.length && (
              <li className="py-6 text-center text-[13px] text-slate-400">本月暂无新提醒。</li>
            )}
          </ul>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-3.5 text-[12.5px] text-slate-600">
        <span className="font-semibold text-slate-800">需要人聊聊？</span>
        <span>
          心理援助热线 <b className="tabular-nums text-slate-800">12356</b>（24 小时）
        </span>
        <span className="text-slate-300">·</span>
        <Link to="/personal/alerts" className="hover:text-primary-600">
          预约校心理中心
        </Link>
        <span className="text-slate-300">·</span>
        <span>
          紧急联系人 <b className="tabular-nums text-slate-800">138 **** 6621</b>
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 子组件 */

/** 动作块：一行标题 + 一行状态（状态说明"为什么现在点"） */
function ActionStack({
  to,
  title,
  meta,
  primary = false,
  padY = 8,
}: {
  to: string;
  title: string;
  meta: string;
  primary?: boolean;
  padY?: number;
}) {
  return (
    <Link
      to={to}
      style={{ paddingTop: padY, paddingBottom: padY }}
      className={`grid min-w-[168px] gap-0 rounded-lg px-4 transition-colors ${
        primary ? "ui-button-primary" : "ui-button"
      }`}
    >
      <span className="text-[14px] font-semibold leading-5">{title}</span>
      <span className={`text-[12px] leading-5 ${primary ? "opacity-85" : "opacity-70"}`}>
        {meta}
      </span>
    </Link>
  );
}
