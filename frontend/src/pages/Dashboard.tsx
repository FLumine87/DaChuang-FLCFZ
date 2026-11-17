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
 * 检测结果首栏展示统一的近期综合风险，单次量表分数在对应报告中查看。
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  getDashboardData,
  search,
  type DashboardResponse,
  type SearchResponse,
} from "../services/mockApi";
import { questionnaires } from "../data/questionnaireData";
import {
  type AlertLevel,
  type RetrievalResult,
} from "../data/mockData";
import { getDraft } from "../services/firstRun";
import { dashboardInputTime, latestDashboardInput } from "../services/dashboardInput";
import { usePageActive } from "../services/pageActivity";
import { getCurrentSession } from "../auth/session";
import { USE_MOCK, clearToken } from "../services/http";
import ActionPlanCard from "../components/ActionPlanCard";
import RiskSummaryCard from "../components/RiskSummaryCard";

/* ------------------------------------------------------------------ 小工具 */

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const INPUT_LABEL = { scale: "量表筛查", text: "文字筛查", audio: "语音筛查", image: "图像筛查" };

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

/** 把后端可能返回的 "2026-03-18" / "2026-03-18 09:12" / ISO 统一解析成日期 */
function parseDateValue(value?: string | null): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw)
    ? raw.replace(" ", "T")
    : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthOf(value?: string | null): string {
  const date = parseDateValue(value);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** 等级外观沿用旧版口径：稳定 / 关注 / 警告 / 高危，分数带与预警列表共用 */
const LEVEL_LABEL: Record<string, string> = {
  unknown: "未评估",
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
  unknown: "text-slate-500",
  green: "text-success-600",
  yellow: "text-warning-600",
  orange: "text-orange-600",
  red: "text-danger-600",
};
const LEVEL_DOT: Record<string, string> = {
  green: "bg-success-500", yellow: "bg-warning-500",
  orange: "bg-orange-500", red: "bg-danger-500",
};
/* ------------------------------------------------------------------ 页面 */

export default function Dashboard() {
  const pageActive = usePageActive();
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
    if (!pageActive) return;
    let alive = true;
    getDashboardData()
      .then((d) => {
        if (alive) { setData(d); setError(null); }
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "加载失败");
      });
    return () => {
      alive = false;
    };
  }, [pageActive]);

  const view = useMemo(() => {
    if (!data) return null;
    const records = data.screeningRecords ?? [];
    /* 采集补充总计（挂记录 + 挂用户名下）。新账号还没做过筛查时，
       采集内容就靠这份数据在「最近一次输入」里露脸。 */
    const supplements = data.supplements ?? [];
    /* 左栏展示最新一次量表结果：跳过 pending（还没答完的那条） */
    const last = records.find((r) => r.status === "completed") ?? records[0];
    const def = questionnaires.find((q) => q.id === last?.questionnaire);
    const result = def && last ? def.scoring(last.score) : null;

    /* 「最近 30 天」必须按今天的日期筛，而不是把全部历史累计进来。
       演示数据是 3 月样例，11 月登录时不应显示成"最近 30 天"；样例只在
       下方明确标注为「样例月份」。 */
    const now = new Date();
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const inLast30Days = (value?: string | null) => {
      const date = parseDateValue(value);
      return Boolean(date && date >= cutoff && date <= now);
    };
    const recentRecords = records.filter(r => r.status === "completed" && inLast30Days(r.date));
    const recentSupplements = supplements.filter(s => inLast30Days(s.createdAt));
    const counts: Record<string, number> = { 量表: recentRecords.length, 文本: 0, 语音: 0, 图像: 0 };
    recentSupplements.forEach(s => {
      const key = s.kind === "audio" ? "语音" : s.kind === "image" ? "图像" : "文本";
      counts[key]++;
    });
    // The authoritative totals cover the complete ledger, not the dashboard preview limits.
    if (data.screeningActivity) {
      const {scale,text,audio,image} = data.screeningActivity.byKind;
      Object.assign(counts, {量表:scale,文本:text,语音:audio,图像:image});
    }
    const totalRecords = Object.values(counts).reduce((sum,n)=>sum+n,0);
    const maxCount = Math.max(1, ...Object.values(counts));

    /* 演示数据所在的月份：只在"最近 30 天/本月为空"时展示，避免把旧样例说成现在 */
    const allMonths = [
      ...records.map((r) => monthOf(r.date)),
      ...supplements.map((s) => monthOf(s.createdAt)),
      ...(data.warningEvents ?? []).map((w) => monthOf(w.createdAt)),
    ].filter(Boolean);
    const latestSampleMonth = allMonths.sort().at(-1) ?? "";
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const sampleMonth = latestSampleMonth && latestSampleMonth !== currentMonth ? latestSampleMonth : "";

    const warning = (data.warningEvents ?? []).find((w) => w.status !== "resolved");

    /* 行动计划已改为独立组件 ActionPlanCard（后端 action_plans 表落库，
       支持自己写计划、手动完成、归档与截止时间）。这里不再拼 levelPlan /
       planItems —— 那套"按预警等级补一条 + 静态三条"的口径已被取代，
       留着只会让页面出现两套互相矛盾的待办。 */

    /* 「最近预警」按**当前自然月**统计；当前月没有、但库里只有旧样例时，
       不把旧数据说成「本月」，而是明确标注「样例月份 3 月」。 */
    const warnings = data.warningEvents ?? [];
    const monthWarnings = warnings.filter(
      (w) => String(w.createdAt ?? "").slice(0, 7) === currentMonth,
    );
    const sampleWarnings = sampleMonth
      ? warnings.filter((w) => String(w.createdAt ?? "").slice(0, 7) === sampleMonth)
      : [];
    const displayWarnings = monthWarnings.length ? monthWarnings : sampleWarnings;
    const warningPeriodLabel = monthWarnings.length
      ? "本月"
      : sampleMonth
        ? `样例月份 ${Number(sampleMonth.slice(5))} 月`
        : "本月";
    const monthCounts = displayWarnings.reduce<Record<string, number>>((acc, w) => {
      const label = LEVEL_LABEL[w.level] ?? "—";
      acc[label] = (acc[label] ?? 0) + 1;
      return acc;
    }, {});

    /* 草稿只用于继续作答的入口，不计入已提交的最近一次输入。 */
    const draft = getDraft();
    const draftDefinition = draft ? questionnaires.find((q) => q.id === draft.scaleId) : undefined;
    const pendingDraft =
      draft && !draft.recordId && draftDefinition
        ? {
            scaleId: draft.scaleId,
            name: draftDefinition.name,
            answered: Object.keys(draft.answers ?? {}).length,
            total: draftDefinition.questions.length,
            updatedAt: draft.updatedAt,
          }
        : null;
    const input = latestDashboardInput(data);
    const supplement = input?.supplement;
    const inputAnalysis = supplement?.analysis ?? null;
    const ranked = (inputAnalysis?.hits ?? []).map<RetrievalResult>(hit=>({
      id:hit.id,similarity:hit.similarity,modality:['text','audio','image','multimodal'].includes(hit.modality || '') ? hit.modality as RetrievalResult['modality'] : 'text',
      summary:hit.summary || '',tags:hit.tags || [],date:hit.date || '',
      alertLevel:['green','yellow','orange','red'].includes(hit.alertLevel)?hit.alertLevel as AlertLevel:'unknown',
    })).sort((a,b)=>b.similarity-a.similarity);

    /* 「查看检索依据」要带着这次的输入跳到检索页，否则用户到了那边还得再输一遍。
       没有补充文字时用「量表名 + 本次分档」兜底 —— 这是卡里确实显示过的内容，
       不是编出来的查询词。 */
    const retrievalQuery =
      input?.text.trim()
        ? input.text.trim()
        : last
          ? `${def?.name ?? last.questionnaire}：${result?.label ?? LEVEL_LABEL[last.level] ?? last.level}`
          : "";

    return {
      /* 首页问候用**登录用户名**，不用 userProfile.name。
         两者不是一个来源：右上角头像用的是 token 里的 username，
         而 userProfile.name 在演示数据里是"林晓"、真后端里是"本地演示用户" ——
         同一屏出现两个名字，说的却是同一个人。
         Cases.tsx 早就这么处理了（注释：避免演示资料中的姓名覆盖当前账号），
         这里对齐同一口径。 */
      name: getCurrentSession()?.username || data.userProfile?.name || "",
      input,
      inputAnalysis,
      top: ranked[0],
      second: ranked[1],
      date: todayLabel(),
      records,
      totalRecords,
      last,
      def,
      result,
      counts,
      maxCount,
      warning,
      monthWarnings,
      displayWarnings,
      warningPeriodLabel,
      sampleMonth,
      pendingDraft,
      retrievalQuery,
      monthBreakdown: Object.entries(monthCounts)
        .map(([k, v]) => `${k} ${v}`)
        .join(" · "),
    };
  }, [data]);

  /* 有文本输入就走真检索（POST /api/personal/search），拿到这条输入对应的
     相似记录与 RAG 解释。语音/图像输入这里不重跑 —— 首页手上没有原始媒体，
     只有特征描述，重跑等于拿描述当媒体去检索，结论不可信。
     失败（401 / 后端未起）时不伪造结果，由界面如实显示"没跑成"。 */
  const inputText = view?.input?.kind === "text" ? view.input.text.trim() : "";
  const inputKey = view?.input ? `${view.input.id}:${view.input.at}` : "";
  const [liveResult, setLive] = useState<{
    key: string;
    top?: RetrievalResult;
    second?: RetrievalResult;
    report?: SearchResponse<RetrievalResult>["report"];
    error?: string;
  } | null>(null);
  const live = liveResult?.key === inputKey ? liveResult : null;

  useEffect(() => {
    let alive = true;
    /* 输入变了（含被清空）就先清掉上一次的实时结果，免得旧结果挂在新输入上。
       两个 setLive(null) 都推到下一个 tick：react-hooks/set-state-in-effect 不允许
       在 effect 体里同步 setState，界面表现与原来一致。 */
    const resetTimer = window.setTimeout(() => {
      if (alive) setLive(null);
    }, 0);

    if (inputText) {
      search(inputText)
        .then((res) => {
          if (alive)
            setLive({
              key: inputKey,
              top: res.results?.[0],
              second: res.results?.[1],
              report: res.report,
            });
        })
        .catch((e) => {
          if (alive) setLive({ key: inputKey, error: e instanceof Error ? e.message : "检索失败" });
        });
    }

    return () => {
      alive = false;
      window.clearTimeout(resetTimer);
    };
  }, [inputText, inputKey]);

  /* 数据没拿到时的两种状态要分开，不能混：
       · 还在加载（error 为空）→ 骨架屏，会自己结束；
       · 加载失败（error 有值）→ 明确的失败卡 + 重新登录入口。
     之前两种情况混在一个分支里，失败时会「提示 + 骨架屏」永久挂着不动，
     看起来就是整页崩了。 */
  if (error) {
    const expired = /凭证|401|过期|无效/.test(error);
    return (
      <div className="ui-card p-6">
        <p className="text-[15px] font-medium text-slate-800">首页数据加载失败</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">{error}</p>
        <p className="mt-2 text-[12.5px] leading-5 text-slate-500">
          {expired
            ? "登录凭证有效期为 30 分钟，过期后所有接口都会返回 401。重新登录即可恢复。"
            : "后端可能没启动或网络不通。确认后端在跑之后刷新页面。"}
        </p>
        <button
          type="button"
          onClick={() => {
            clearToken();
            window.location.hash = "#/login";
          }}
          className="ui-button ui-button-primary mt-4"
        >
          重新登录
        </button>
      </div>
    );
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
  const hasVoiceOrImage = view.counts["语音"] + view.counts["图像"] > 0;

  /* 仅展示这条输入的实时结果或其保存的分析，禁止使用其他记录的样例。
     后端返回的是 alert_level（snake_case），前端类型写的是 alertLevel，两边都认。 */
  const matched = live && !live.error ? live.top : view.top;
  /* 相似度第二高的一条，紧跟第一条展示 */
  const matched2 = live && !live.error ? live.second : view.second;
  const matchedLevel = (raw: unknown): AlertLevel | 'unknown' => {
    const r = raw as { alertLevel?: AlertLevel | 'unknown'; alert_level?: AlertLevel | 'unknown' } | undefined;
    return r?.alertLevel ?? r?.alert_level ?? "unknown";
  };
  const matchedLevelOf = matchedLevel(matched);
  const savedAssessmentHref = view.input?.supplement
    ? `/personal/screening?tab=retrieval&assessmentSupplementId=${view.input.supplement.id}`
    : null;

  return (
    <div className="grid gap-6">
      {/* 右栏在 1024–1535 收窄到 380px：1440 以下的内容区只有 ~920–1090px，
        430px 的卡片会把左栏挤到 500px 以内 —— 54px 的标题与"不换行"的灰字
        都会横向溢出、压到卡片上（1270×750 实测）。2xl 再放开到 430。 */}
      {/* 1180 以下改成单列：1024–1179 时内容区只有 670–820px，
          380px 的计划卡会剩不下左栏（标题要断成三行，灰字压到卡片上）。 */}
      <div className="dashboard-hero grid gap-6 min-[1180px]:grid-cols-[minmax(0,1fr)_minmax(0,380px)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,430px)]">
      {/* ============ 首屏：左标题 + 右「今日行动计划」（缩小后移到右上角） ============ */}
      {/* 左栏：标题 + 灰字 + 两个动作，整块在左栏内垂直居中（对齐右侧计划卡的高度） */}
      <div className="lg:flex lg:flex-col lg:justify-center" style={{ paddingTop: tune.offset }}>
      {/* hero-stagger：三行从左向右依次登场（动效定义见 index.css） */}
      <header className="hero-stagger">
        <p className="font-medium leading-none" style={{ fontSize: tune.line1 }}>
          <span className="text-primary-500">
            {greeting()}
            {view.name ? `，${view.name}` : ""}
          </span>
          <span className="text-slate-400"> · {view.date}</span>
        </p>
        {/* 字号走 .dash-hero-title（见 index.css）。
            不能写 Tailwind 的 text-*：全局 `h1 { font-size: 1.625rem }` 在 @layer
            之外，会压过分层的工具类，写了也是死代码（本文件多处已注明）。
            原来是内联 style={{ fontSize: tune.title }}，tune.title 是调参面板留下的
            常量 54（as const，无任何响应式逻辑），于是在 390px 手机上也是 54px，
            撑成两行巨字、占掉近半屏。 */}
        <h1 className="dash-hero-title font-medium leading-[1.14] tracking-[0.25px] text-slate-900" style={{ marginTop: tune.line1Gap }}>
          你最近的状态，都在这里
        </h1>
        {/* 灰体小字：一句话交代这一页有什么，避免标题后面直接跳到大卡片 */}
        <p className="mt-4 leading-8 text-slate-500" style={{ fontSize: tune.sub }}>
          近期的检测结果、最近一段时间的记录，以及需要你留意的地方，都整理在这一页。
        </p>
      </header>
        {/* 两个动作：从「今日行动计划」卡里拿出来，放到标题灰字下面 */}
        {/* 手机端**不换行**、两张卡等宽等高；lg 以上恢复原来的"按内容宽度 + 可换行"。
            原来只有 flex-wrap：390px 下可用宽度 342px，而两张卡的自然宽度是
            168（min-w-[168px]）+ 12（gap）+ 242 = 422px，必然换行，
            于是第一张窄、第二张宽，左边缘对不上（用户截图反馈"这两个没有对齐很奇怪"）。
            手机端改成 flex-nowrap + 子项 flex-1 basis-0：两张各占一半、天然对齐；
            min-w-[168px] 在手机上会让 flex-1 失效（不能收缩到 168 以下），
            所以把它限制到 lg 以上（见 ActionStack）。 */}
        <div
          className="flex flex-nowrap items-stretch lg:flex-wrap lg:items-center"
          style={{
            marginTop: tune.btnPos === "bottom" ? "auto" : tune.gap,
            paddingTop: tune.btnPos === "bottom" ? tune.gap : 0,
            gap: tune.btnGap,
            justifyContent: tune.align,
          }}
        >
          <ActionStack
            padY={tune.btnPad}
            to="/personal/screening?tab=text"
            primary
            title="记录一下现在"
            meta={view.last ? `${view.last.date} 记过一次` : "今天还没有记录"}
          />
          <ActionStack
            padY={tune.btnPad}
            to={
              view.pendingDraft
                ? `/personal/first/questionnaire?scale=${encodeURIComponent(view.pendingDraft.scaleId)}`
                : "/personal/screening?tab=scale"
            }
            title={view.pendingDraft ? "继续上次作答" : "评估心理状态"}
            meta={
              view.pendingDraft
                ? `${view.pendingDraft.name} · 已答 ${view.pendingDraft.answered}/${view.pendingDraft.total} 题`
                : view.last
                  ? `上次评估 ${view.last.date} · 建议每 2 周一次`
                  : "还没做过评估 · 约 3 分钟"
            }
          />
        </div>

        {/* 中途退出后回到首页：明确给一个「继续作答」入口，并显示已答进度。
            草稿按账号保存在本次标签页里，刷新后仍在。 */}
        {view.pendingDraft && (
          <Link
            to={`/personal/first/questionnaire?scale=${encodeURIComponent(view.pendingDraft.scaleId)}`}
            className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-primary-200 bg-primary-50/60 px-4 py-3 text-[13px] text-primary-700 transition-colors hover:bg-primary-50"
          >
            <span>
              上次的《{view.pendingDraft.name}》还没答完，已保存到第{" "}
              {Math.min(view.pendingDraft.answered + 1, view.pendingDraft.total)} 题附近
            </span>
            <span className="shrink-0 font-medium">继续作答 →</span>
          </Link>
        )}
      </div>

      {/* ============ ③ 今日行动计划（右栏） ============
          已拆成独立组件：待进行 / 归档两个分区、手动标注完成、自己写计划、
          右上角制定时间戳、按截止时间排序，逻辑都在 ActionPlanCard 里。 */}
      <ActionPlanCard />

      {/* ==================== 常驻求助条 ==================== */}
      </div>


      {/* ============ ① 近期的检测结果（取最近一条记录，新用户就是刚做的那次）：内部分三栏，压到与下面一排同高 ============ */}
      <section className="ui-card p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="text-[20px] font-semibold text-slate-900">近期的检测结果</h2>
            <p className="mt-1 text-[13px] text-slate-500">
              {view.input
                ? `${new Date(dashboardInputTime(view.input.at)).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai',hour12:false})} · ${INPUT_LABEL[view.input.kind]}`
                : "还没有检测记录"}
            </p>
          </div>
        </div>

        {view.input ? (
          <>
            <div className="mt-5 grid gap-6 border-t border-slate-100 pt-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-8">
              {/* 栏一：近30天综合风险，替代单次量表分数展示。 */}
              <div className="min-w-0"><RiskSummaryCard presentation="column" /></div>

              {/* 栏二：检索 */}
              <div className="lg:border-l lg:border-slate-100 lg:pl-8">
                <p className="flex items-center gap-1.5 text-[15px] font-semibold text-slate-700">
                  最近一次输入
                </p>
                {/* 量表显示实际提交结果；文字用原文；媒体显示原始文件信息。 */}
                <p className="mt-2 line-clamp-2 border-l-2 border-slate-200 pl-3 text-[13.5px] leading-[1.6] text-slate-700">
                  「{view.input.text}」
                </p>
                <p className="mt-2 text-xs text-slate-400">{INPUT_LABEL[view.input.kind]} · {new Date(dashboardInputTime(view.input.at)).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</p>
                {/* 这次采集的哈希检索结论（等级 + 结论，一行压住版面） */}
                {view.inputAnalysis?.conclusion && (
                  <p className="mt-2 line-clamp-2 border-l-2 border-slate-200 pl-3 text-[12.5px] leading-[1.6] text-slate-500">
                    <span className="font-medium text-slate-600">
                      {view.inputAnalysis.levelLabel ?? ""}
                    </span>
                    <span className="mx-1">·</span>
                    {view.inputAnalysis.conclusion}
                  </p>
                )}

                {matched && (
                  <>
                    <div className="mt-4 rounded-xl border border-slate-100 p-3">
                      <p className="flex items-center gap-1.5 text-[12px] text-slate-400">
                        检索到的最相似记录
                        <span
                          className={`rounded px-1 text-[11px] font-medium ${
                            !USE_MOCK
                              ? "bg-success-50 text-success-600"
                              : "bg-slate-100 text-slate-400"
                          }`}
                        >
                          {USE_MOCK ? "演示" : live?.top ? "实时" : "已保存"}
                        </span>
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
                        <span className="flex items-baseline gap-2">
                          <span className="text-[13.5px] font-medium tabular-nums text-slate-700">
                            {matched.id}
                          </span>
                          <span className="text-[12px] text-slate-400">
                            {matched.date}
                          </span>
                        </span>
                        <span className="flex items-baseline gap-2">
                          <span
                            className={`text-[12.5px] font-medium ${LEVEL_TEXT[matchedLevelOf]}`}
                          >
                            {LEVEL_LABEL[matchedLevelOf]}
                          </span>
                          <span className="text-[15px] font-semibold tabular-nums text-slate-900">
                            {Math.round(matched.similarity * 100)}%
                          </span>
                        </span>
                      </div>
                      <p className="mt-1.5 line-clamp-1 text-[13px] leading-[1.6] text-slate-600">
                        {matched.summary}
                      </p>

                      {matched2 && (
                        <>
                          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-slate-100 pt-2.5">
                            <span className="flex items-baseline gap-2">
                              <span className="text-[13.5px] font-medium tabular-nums text-slate-700">
                                {matched2.id}
                              </span>
                              <span className="text-[12px] text-slate-400">{matched2.date}</span>
                            </span>
                            <span className="flex items-baseline gap-2">
                              <span
                                className={`text-[12.5px] font-medium ${LEVEL_TEXT[matchedLevel(matched2)]}`}
                              >
                                {LEVEL_LABEL[matchedLevel(matched2)]}
                              </span>
                              <span className="text-[15px] font-semibold tabular-nums text-slate-900">
                                {Math.round(matched2.similarity * 100)}%
                              </span>
                            </span>
                          </div>
                          <p className="mt-1.5 line-clamp-1 text-[13px] leading-[1.6] text-slate-600">
                            {matched2.summary}
                          </p>
                        </>
                      )}
                      {live?.error && (
                        <p className="mt-1 text-[11.5px] text-danger-600">
                          实时检索没跑成：{live.error}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* 栏三：RAG */}
              <div className="lg:border-l lg:border-slate-100 lg:pl-8">
                <p className="flex items-center gap-1.5 text-[15px] font-semibold text-slate-700">
                  RAG 给出的解释与建议
                  {!USE_MOCK && live?.report && (
                    <span className="rounded bg-success-50 px-1 text-[11px] font-medium text-success-600">
                      实时
                    </span>
                  )}
                </p>
                {live?.report ? (
                  /* 真 RAG：解释 + 建议都来自 POST /api/personal/search 的 report */
                  <>
                    <p className="mt-2 text-[14px] leading-[1.7] text-slate-600">
                      {live.report.summary}
                    </p>
                    <ul className="mt-3 grid gap-1 text-[13.5px] leading-[1.7] text-slate-600">
                      {(live.report.recommendations ?? []).slice(0, 3).map((r, i) => (
                        <li key={i}>· {r}</li>
                      ))}
                    </ul>
                    {live.report.riskLevel && (
                      <p className="mt-2 text-[11.5px] text-slate-400">
                        风险等级：{live.report.riskLevel}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-[14px] leading-[1.7] text-slate-600">
                      {view.input?.scale?.retrieval?.summary || view.inputAnalysis?.conclusion || '这次输入尚未保存解释与建议，可打开对应记录查看或继续分析。'}
                    </p>
                    {(view.input.scale?.retrieval?.advice ?? []).length > 0 && <ul className="mt-3 grid gap-1 text-[13.5px] leading-[1.7] text-slate-600">
                      {view.input.scale?.retrieval?.advice?.slice(0,3).map((advice,i)=><li key={i}>· {advice}</li>)}
                    </ul>}
                  </>
                )}
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
                    「近期综合风险」→ 左栏展开维度与依据；单次量表分数仍可在本次报告中查看 */}
                <Link
                  to={
                    savedAssessmentHref ?? (view.retrievalQuery
                      ? `/personal/screening?tab=retrieval&q=${encodeURIComponent(view.retrievalQuery)}`
                      : "/personal/screening?tab=retrieval")
                  }
                  className="ui-button ui-button-primary"
                >
                  查看检索依据
                </Link>
                <Link
                  to={
                    savedAssessmentHref ?? (view.input?.recordId
                      ? `/personal/records?record=${encodeURIComponent(view.input.recordId)}`
                      : "/personal/records")
                  }
                  className="ui-button"
                >
                  {view.input.recordId ? "查看本次报告" : "查看本次记录"}
                </Link>
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="mt-5 grid gap-6 border-t border-slate-100 pt-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,2.15fr)] lg:gap-8">
              <div className="min-w-0"><RiskSummaryCard presentation="column" /></div>
              <div className="min-w-0 lg:border-l lg:border-slate-100 lg:pl-8">
            <p className="text-[14px] text-slate-500">
              还没有检测记录 —— 从下面「评估心理状态」开始，大约 3 分钟。
            </p>
              </div>
            </div>
          </>
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
            这 30 天你完成了 {view.totalRecords} 次筛查
          </p>
          {view.totalRecords === 0 && (
            <p className="mt-2 text-[12.5px] leading-6 text-slate-400">
              {view.sampleMonth
                ? `最近 30 天还没有新记录。页面里的 ${Number(view.sampleMonth.slice(5))} 月数据是演示样例，不计入最近 30 天。`
                : "最近 30 天还没有新记录，从上方「记录一下现在」开始即可。"}
            </p>
          )}

          <div className="mt-5">
            {(["量表", "文本", "语音", "图像"] as const).map((k) => (
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
              ? `语音 ${view.counts["语音"]} 次、图像 ${view.counts["图像"]} 次 —— 与量表、文字筛查一起保存在「筛查记录」。`
              : "量表、文字、语音和图像筛查统一计入记录，可按自己的需要选择。"}
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 lg:mt-auto">
            <div>
              <p className="text-[13px] text-slate-400">检索命中</p>
              <p className="mt-1.5 text-[15px] text-slate-600">
                <b className="text-[20px] tabular-nums text-slate-900">8</b> 个相似历史模式
              </p>
            </div>
            <Link to="/personal/screening?tab=retrieval" className="ui-button">
              看命中明细
            </Link>
          </div>
        </section>

        <section className="ui-card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[20px] font-semibold text-slate-900">最近预警</h2>
              <p className="mt-1 text-[13px] text-slate-500">
                {view.displayWarnings.length
                  ? `${view.warningPeriodLabel} ${view.displayWarnings.length} 条 · ${view.monthBreakdown}`
                  : "本月暂无新提醒"}
              </p>
            </div>
            <Link
              to="/personal/alerts"
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12.5px] text-slate-600 hover:border-primary-300 hover:text-primary-600"
            >
              {view.displayWarnings.length > 2 ? `全部 ${view.displayWarnings.length} 条` : '全部'}
            </Link>
          </div>

          <ul className="mt-4 grid gap-3">
            {view.displayWarnings.slice(0, 2).map((alert) => (
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
            {!view.displayWarnings.length && (
              <li className="py-6 text-center text-[13px] text-slate-400">本月暂无新提醒。</li>
            )}
            {view.sampleMonth && !view.monthWarnings.length && view.displayWarnings.length > 0 && (
              <li className="text-center text-[11.5px] text-slate-400">
                以上为 {Number(view.sampleMonth.slice(5))} 月演示样例；当前自然月暂无新提醒。
              </li>
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
        {/* 这里没有真正的预约能力，按钮名称不能写成"预约"。
            接入校心理中心的预约/联系方式后，再把入口和文案一起换掉。 */}
        <Link to="/personal/alerts" className="hover:text-primary-600">
          查看预警与求助方式
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
      /* 手机端：flex-1 basis-0 让两张卡严格等分（都从 0 开始长大，所以宽度相同），
         min-w-0 解除默认的最小内容宽度限制 —— 否则长文案"上次评估 2026-03-18 ·
         建议每 2 周一次"会把卡片顶宽，两张就不等宽了。
         lg 以上回到 min-w-[168px] + 不伸缩，保持桌面上"按内容宽度"的原样。
         content-start 让标题和状态从顶部排，两卡等高时文字不会被拉伸开。 */
      className={`grid min-w-0 flex-1 basis-0 content-start gap-0 rounded-lg px-4 transition-colors lg:flex-none lg:basis-auto lg:min-w-[168px] ${
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
