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
import {
  getDashboardData,
  search,
  type DashboardResponse,
  type SearchResponse,
} from "../services/mockApi";
import { questionnaires, type QuestionnaireDefinition } from "../data/questionnaireData";
import {
  retrievalResults,
  type AlertLevel,
  type PersonalScreeningRecord,
  type RetrievalResult,
} from "../data/mockData";
import { getDraft } from "../services/firstRun";
import { supplementModalityText } from "../services/localKg";
import { getCurrentSession } from "../auth/session";
import { USE_MOCK, clearToken } from "../services/http";

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
   为什么用它：新用户进来「最近一次输入」是空的，只放一句干巴巴的提示看不出"输入长什么样"；
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
    /* 采集补充总计（挂记录 + 挂用户名下）。新账号还没做过筛查时，
       采集内容就靠这份数据在「最近一次输入」里露脸。 */
    const supplements = data.supplements ?? [];
    /* 左栏展示最新一次量表结果：跳过 pending（还没答完的那条） */
    const last = records.find((r) => r.status === "completed") ?? records[0];
    const def = questionnaires.find((q) => q.id === last?.questionnaire);
    const bands = scoringBands(def, last?.maxScore ?? 0);
    const result = def && last ? def.scoring(last.score) : null;

    const counts: Record<string, number> = { 文本: 0, 语音: 0, 图像: 0 };
    records.forEach((r) => {
      const k = modalityOf(r);
      counts[k] = (counts[k] ?? 0) + 1;
    });
    /* 挂用户名下（未挂记录）的采集也计入：新账号采集后，
       「这 30 天你记录了 N 次」与模态条形图不该还是 0。
       挂记录的在上面已按记录计过，这里只补未挂记录的，避免重复计数。 */
    const userSupplements = supplements.filter((s) => !s.screeningId);
    userSupplements.forEach((s) => {
      const k = s.kind === "audio" ? "语音" : s.kind === "image" ? "图像" : "文本";
      counts[k] = (counts[k] ?? 0) + 1;
    });
    const totalRecords = records.length + userSupplements.length;
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
    /* 后端字段名可能不是 createdAt（真后端用 snake_case 时这里是 undefined），
       一旦 undefined.slice() 会直接抛错、整页白屏，所以先取字符串再切。 */
    const latestMonth = String(warnings[0]?.createdAt ?? "").slice(0, 7);
    const monthWarnings = warnings.filter((w) => w.createdAt.startsWith(latestMonth));
    const monthCounts = monthWarnings.reduce<Record<string, number>>((acc, w) => {
      const label = LEVEL_LABEL[w.level] ?? "—";
      acc[label] = (acc[label] ?? 0) + 1;
      return acc;
    }, {});

    /* 「最近一次输入」= 这张卡展示的那条记录的补充内容。
       记录优先、用户级采集兜底、草稿最后：草稿只服务首次引导那一次；
       新账号没有筛查记录时，采集挂在用户名下（supplements），
       用它保证"上传后一定看得到"，而不是只上传不挂靠。 */
    const draft = getDraft();
    const supplement =
      records.find((r) => r.supplement)?.supplement ??
      supplements[0] ??
      draft?.supplement;
    /* 文本取原文；音频 / 图片取**与检索历史同一段**模态文字描述
       （supplementModalityText 是两处共用的唯一实现：有分析描述就是
       「语音片段特征：…」/「记录到的非言语线索：…」，没有就回退成文件名）。
       以前这里对音频/图片直接摆了一段写死的"样例"描述，与历史记录对不上。 */
    const supplementText = supplementModalityText(supplement);
    const input = supplement
      ? { kind: supplement.kind, text: supplementText }
      : null;
    /* 哈希检索引擎对这次采集的分析报告（保存时同步生成，随补充挂载）：
       卡里展示风险等级与结论，把"采集 → 分析 → 结论"闭环带到这里 */
    const inputAnalysis = supplement?.analysis ?? null;

    /* 检索结果：取相似度最高的一条，其余用「还有 N 条」带过（版面只放得下一条） */
    const ranked = [...retrievalResults].sort((a, b) => b.similarity - a.similarity);

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
      bands,
      result,
      counts,
      maxCount,
      warning,
      planItems,
      monthWarnings,
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
  const [live, setLive] = useState<{
    top?: RetrievalResult;
    second?: RetrievalResult;
    report?: SearchResponse<RetrievalResult>["report"];
    error?: string;
  } | null>(null);

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
              top: res.results?.[0],
              second: res.results?.[1],
              report: res.report,
            });
        })
        .catch((e) => {
          if (alive) setLive({ error: e instanceof Error ? e.message : "检索失败" });
        });
    }

    return () => {
      alive = false;
      window.clearTimeout(resetTimer);
    };
  }, [inputText]);

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
  const activeBand = view.bands.findIndex(
    (b) => view.last && view.last.score >= b.from && view.last.score <= b.to
  );
  const hasVoiceOrImage = view.counts["语音"] + view.counts["图像"] > 0;

  /* 真检索成功就用真结果，否则退回演示数据。
     后端返回的是 alert_level（snake_case），前端类型写的是 alertLevel，两边都认。 */
  const matched = live?.top ?? view.top;
  /* 相似度第二高的一条，紧跟第一条展示 */
  const matched2 = live?.top ? live.second : view.second;
  const matchedLevel = (raw: unknown): AlertLevel => {
    const r = raw as { alertLevel?: AlertLevel; alert_level?: AlertLevel } | undefined;
    return r?.alertLevel ?? r?.alert_level ?? "green";
  };
  const matchedLevelOf = matched ? matchedLevel(matched) : "green";

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,430px)]">
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
        <p className="mt-4 leading-8 text-slate-500 lg:whitespace-nowrap" style={{ fontSize: tune.sub }}>
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
                /* min-w-0 不能省：<ul> 是 grid，而 grid item 默认 min-width:auto
                   = min-content；标题是 truncate（white-space:nowrap），
                   min-content 就是整句话的宽度 —— 栅格列会被撑开，truncate 根本没
                   机会生效。实测：卡片内容区 390px 时，18 字标题还装得下，
                   24 字就把 li 撑到 512px、横向溢出 104px。
                   父级那两层 min-w-0 管不住 grid item 自己这一层。 */
                className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-slate-100 p-4"
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
              {/* 栏一：量表给的分数
                  表头固定在顶（三栏表头必须对齐），**只有下面的分数+分数带**
                  在剩余高度里竖直居中 —— 这一栏内容比左右两栏矮，贴顶会显得上重下空。 */}
              <div className="flex flex-col">
                <p className="text-[15px] font-semibold text-slate-700">量表给的分数</p>
                <div className="flex flex-1 flex-col justify-center">
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
              </div>

              {/* 栏二：检索 */}
              <div className="lg:border-l lg:border-slate-100 lg:pl-8">
                <p className="flex items-center gap-1.5 text-[15px] font-semibold text-slate-700">
                  最近一次输入
                  {!view.input && (
                    <span className="rounded bg-slate-100 px-1 text-[11px] font-medium text-slate-400">
                      样例
                    </span>
                  )}
                </p>
                {view.input ? (
                  /* 文本给原文，音频/图片给该记录在检索历史里的同一段模态描述 */
                  <p className="mt-2 line-clamp-2 border-l-2 border-slate-200 pl-3 text-[13.5px] leading-[1.6] text-slate-700">
                    「{view.input.text}」
                  </p>
                ) : (
                  <p className="mt-2 line-clamp-2 border-l-2 border-slate-200 pl-3 text-[13.5px] leading-[1.6] text-slate-500">
                    「{SAMPLE_INPUT}」
                  </p>
                )}
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
                            !USE_MOCK && live?.top
                              ? "bg-success-50 text-success-600"
                              : live?.error
                                ? "bg-danger-50 text-danger-600"
                                : "bg-slate-100 text-slate-400"
                          }`}
                        >
                          {!USE_MOCK && live?.top ? "实时" : live?.error ? "未跑成" : "演示"}
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
                      入睡困难与注意力下降在你自己的历史里反复出现过；恢复较快的几条，
                      都是从「先把睡眠拉回来」开始的。
                    </p>
                    <ul className="mt-3 grid gap-1 text-[13.5px] leading-[1.7] text-slate-600">
                      <li>· 本周内预约一次校心理中心</li>
                      <li>· 睡前 30 分钟离开屏幕</li>
                      <li>· 继续每天记一条（缺语音/图像会打折）</li>
                    </ul>
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
                    「量表给的分数」→ 我的档案里的这条记录 */}
                <Link
                  to={
                    view.retrievalQuery
                      ? `/personal/retrieval?q=${encodeURIComponent(view.retrievalQuery)}`
                      : "/personal/retrieval"
                  }
                  className="ui-button ui-button-primary"
                >
                  查看检索依据
                </Link>
                <Link
                  to={
                    view.last
                      ? `/personal/screening?record=${encodeURIComponent(view.last.id)}`
                      : "/personal/screening"
                  }
                  className="ui-button"
                >
                  查看本次报告
                </Link>
              </span>
            </div>
          </>
        ) : (
          <>
            <p className="mt-5 border-t border-slate-100 pt-4 text-[14px] text-slate-500">
              还没有检测记录 —— 从下面「评估心理状态」开始，大约 3 分钟。
            </p>
            {/* 新账号还没做筛查时，采集内容挂在用户名下——这里也要让它露脸，
                否则「多模态采集」传完东西、首页什么都看不到（只上传不挂靠的剩余死角）。 */}
            {view.input && (
              <div className="mt-4 rounded-xl border border-slate-100 p-4">
                <p className="flex items-center gap-1.5 text-[15px] font-semibold text-slate-700">
                  最近一次输入
                  <span className="rounded bg-primary-50 px-1 text-[11px] font-medium text-primary-600">
                    来自多模态采集
                  </span>
                </p>
                <p className="mt-2 line-clamp-2 border-l-2 border-slate-200 pl-3 text-[13.5px] leading-[1.6] text-slate-700">
                  「{view.input.text}」
                </p>
                {view.inputAnalysis?.conclusion && (
                  <p className="mt-2 line-clamp-2 border-l-2 border-slate-200 pl-3 text-[12.5px] leading-[1.6] text-slate-500">
                    <span className="font-medium text-slate-600">
                      {view.inputAnalysis.levelLabel ?? ""}
                    </span>
                    <span className="mx-1">·</span>
                    {view.inputAnalysis.conclusion}
                  </p>
                )}
                <p className="mt-2 text-[12px] text-slate-400">
                  完成一次筛查后，这里会显示对应的分析与建议。
                </p>
              </div>
            )}
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
            这 30 天你记录了 {view.totalRecords} 次
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
