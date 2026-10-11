import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
  Moon,
  Plus,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link, useSearchParams } from "react-router-dom";
import { getDashboardData, type DashboardResponse } from "../services/mockApi";
import {
  ChartRange,
  DashboardError,
  DashboardLoading,
  MetricCard,
  PanelHeading,
} from "../components/DashboardUI";
import StatusBadge from "../components/StatusBadge";
import {
  questionnaires,
  type QuestionnaireDefinition,
} from "../data/questionnaireData";
import type { AlertLevel, WarningEvent } from "../data/mockData";
import { getCurrentSession } from "../auth/session";

/** 预警四级在本页的统一外观：胶囊文字色 / 分数带色块 */
const levelStyles: Record<AlertLevel, { label: string; pill: string; bar: string }> = {
  green: { label: "稳定", pill: "bg-success-50 text-success-600", bar: "bg-success-500" },
  yellow: { label: "关注", pill: "bg-warning-50 text-warning-600", bar: "bg-warning-500" },
  orange: { label: "警告", pill: "bg-orange-50 text-orange-600", bar: "bg-orange-500" },
  red: { label: "高危", pill: "bg-danger-50 text-danger-600", bar: "bg-danger-500" },
};

/** 问候语跟着时段走，和下面的提示语同源，避免早上说"夜深了" */
function timeGreeting(hour: number): string {
  if (hour >= 5 && hour < 9) return "早上好";
  if (hour >= 9 && hour < 12) return "上午好";
  if (hour >= 12 && hour < 14) return "中午好";
  if (hour >= 14 && hour < 18) return "下午好";
  if (hour >= 18 && hour < 23) return "晚上好";
  return "夜深了";
}

/** 按当前时段给一句更贴合当下的话，避免早上也在讲"先稳定睡眠" */
function timeBasedTip(hour: number): string {
  if (hour >= 5 && hour < 9) {
    return "早上好，新的一天，先给自己一个平稳的开始。";
  }
  if (hour >= 9 && hour < 12) {
    return "上午精神最好，先把最重要的一件事做完。";
  }
  if (hour >= 12 && hour < 14) {
    return "中午先好好吃饭，再眯二十分钟——午休别省。";
  }
  if (hour >= 14 && hour < 16) {
    return "刚睡醒容易发懵，先喝口水，慢慢把状态找回来。";
  }
  if (hour >= 16 && hour < 18) {
    return "这个点最容易累，允许自己慢一点，别硬撑。";
  }
  if (hour >= 18 && hour < 23) {
    return "先稳定睡眠，再降低学习压力，慢慢找回自己的节奏。";
  }
  return "夜深了，先把电子设备放远一点，睡眠是最好的修复。";
}

function calendarDaysAgo(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const today = new Date();
  return Math.floor((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - date.getTime()) / 86400000);
}

/**
 * 分数带不另写阈值表：直接拿量表自己的 scoring() 在 0..满分 上扫一遍，
 * 分档因此永远和「筛查结果页」一致（PHQ-9 15 分落在哪一档，两边不会打架）。
 */
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

export default function Dashboard() {
  const [searchParams] = useSearchParams();
  const requestedPreview = import.meta.env.DEV ? searchParams.get("alertPreview") : null;
  // 预览全部四档（原先只支持 red / orange，黄档没法预览）
  const previewLevel: AlertLevel | null =
    requestedPreview === "red"
      ? "red"
      : requestedPreview === "orange"
        ? "orange"
        : requestedPreview === "yellow"
          ? "yellow"
          : requestedPreview === "green"
            ? "green"
            : null;
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [recent, setRecent] = useState(false);
  useEffect(() => {
    let active = true;
    getDashboardData()
      .then((result) => {
        if (active) setData(result);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [reload]);
  if (failed)
    return (
      <DashboardError
        retry={() => {
          setFailed(false);
          setReload(reload + 1);
        }}
      />
    );
  if (!data) return <DashboardLoading />;
  const {
    moodTrend,
    warningEvents,
    actionPlan,
    screeningRecords,
    userProfile,
    questionnaireCatalog,
  } = data;
  const signedInUsername = getCurrentSession()?.username || "同学";

  // ── 最近一次筛查：分数、等级、分档都由量表定义推导 ──────────────────────
  const lastRecord = screeningRecords.find((item) => item.status === "completed");
  const definition = questionnaires.find(
    (item) =>
      item.id === lastRecord?.questionnaire ||
      item.name === lastRecord?.questionnaire,
  );
  const lastResult = lastRecord && definition ? definition.scoring(lastRecord.score) : undefined;
  const bands = scoringBands(definition, lastRecord?.maxScore ?? 0);

  // ── KPI：情绪均值 / 睡眠均值都从同一条趋势数据算，不写死 ────────────────
  const avg = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const half = Math.floor(moodTrend.length / 2);
  const moodDelta = Math.round(avg(moodTrend.slice(half).map((p) => p.mood)) - avg(moodTrend.slice(0, half).map((p) => p.mood)));
  const avgSleep = avg(moodTrend.map((p) => p.sleep)).toFixed(1);

  // ── 本月预警：以数据里最新的那个月为准，避免演示数据（3 月）恒显示 0 ──────
  const latestMonth = warningEvents[0]?.createdAt.slice(0, 7) ?? "";
  const monthWarnings = warningEvents.filter((item) => item.createdAt.startsWith(latestMonth));
  const statusLabels: Record<WarningEvent["status"], string> = {
    new: "新触发",
    tracking: "跟踪中",
    resolved: "已解决",
  };
  const monthBreakdown = (["new", "tracking", "resolved"] as const)
    .map((status) => ({ status, count: monthWarnings.filter((item) => item.status === status).length }))
    .filter((item) => item.count > 0)
    .map((item) => `${item.count} 条${statusLabels[item.status]}`)
    .join(" · ");

  // 近 7 天且有未解决预警时，行动计划按等级在最前面补一条对应行动
  const recentWarnings = warningEvents.flatMap((alert) => {
    if (alert.status === "resolved") return [];
    const daysAgo = calendarDaysAgo(alert.createdAt);
    return daysAgo !== null && daysAgo >= 0 && daysAgo < 7 ? [{ alert, daysAgo }] : [];
  });
  const latestWarning = recentWarnings.sort((a, b) => b.alert.createdAt.localeCompare(a.alert.createdAt))[0];
  const levelPlan =
    latestWarning?.alert.level === "red"
      ? [{ id: "PLAN-ALERT-RED", title: "预约心理辅导", duration: "本周内", status: "new" as const }]
      : latestWarning?.alert.level === "orange"
        ? [{ id: "PLAN-ALERT-ORANGE", title: "与可信赖的人聊一聊", duration: "本周内", status: "new" as const }]
        : latestWarning?.alert.level === "yellow"
          ? [{ id: "PLAN-ALERT-YELLOW", title: "继续每日情绪记录", duration: "每日", status: "new" as const }]
          : [];
  const planItems = [...levelPlan, ...actionPlan];

  const trend = recent ? moodTrend.slice(-7) : moodTrend;
  const dayTip = timeBasedTip(new Date().getHours());
  const tooltip = {
    borderRadius: 12,
    border: "1px solid #e4e7ec",
    fontSize: 12,
    boxShadow: "0 4px 16px #1018280a",
  };
  // 演示用：把某一档预警的样子直接放进「最近预警」列表首位
  const previewItem: WarningEvent | null = previewLevel
    ? {
        id: "PREVIEW",
        level: previewLevel,
        title: `预警示例（${levelStyles[previewLevel].label}）`,
        reason: "这里演示四级预警的配色与措辞，不计入真实记录。",
        suggestion: "",
        status: "new",
        createdAt: "示例",
        updatedAt: "示例",
      }
    : null;

  return (
    <div className="space-y-6">
      {previewLevel && (
        <div className="ui-card flex flex-wrap items-center justify-between gap-3 border-primary-200 bg-primary-50/50 px-4 py-3 text-xs text-slate-600">
          <span>预警样式预览，不计入真实记录。</span>
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/personal/dashboard?alertPreview=green" className="text-success-600 hover:underline">绿色示例</Link>
            <Link to="/personal/dashboard?alertPreview=yellow" className="text-warning-600 hover:underline">黄色示例</Link>
            <Link to="/personal/dashboard?alertPreview=orange" className="text-orange-600 hover:underline">橙色示例</Link>
            <Link to="/personal/dashboard?alertPreview=red" className="text-danger-600 hover:underline">红色示例</Link>
            <Link to="/personal/dashboard" className="text-primary-600 hover:underline">退出预览</Link>
          </div>
        </div>
      )}

      {/* 页头：问候 + 时段提示 + 开始筛查（原型里的 pagehead，不再套一整张卡片） */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-800">
            {timeGreeting(new Date().getHours())}，{signedInUsername}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">{dayTip}</p>
          <p className="mt-1 text-xs text-slate-400">
            {[userProfile?.stage, userProfile?.major, userProfile?.campus]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Link to="/personal/screening" className="ui-button ui-button-primary">
          <Plus className="h-4 w-4" />
          开始筛查
        </Link>
      </div>

      {/* 4 个 KPI：最近一次筛查 / 连续记录 / 本月预警 / 近 10 天情绪均值 */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="最近一次筛查"
          value={lastRecord ? `${lastRecord.score} / ${lastRecord.maxScore}` : "暂无"}
          icon={Activity}
          hint={
            lastRecord
              ? `${definition?.name ?? lastRecord.questionnaire} · ${lastResult?.label ?? lastRecord.moodTag} · ${lastRecord.date}`
              : "完成一次筛查，了解当前状态"
          }
        />
        <MetricCard
          label="连续记录"
          value="12 天"
          icon={ClipboardCheck}
          trend="+3 天"
          hint="较上周连续记录"
        />
        <MetricCard
          label="本月预警"
          value={`${monthWarnings.length} 条`}
          icon={AlertTriangle}
          hint={
            monthWarnings.length
              ? `${latestMonth} · ${monthBreakdown}`
              : "本月暂无新提醒"
          }
        />
        <MetricCard
          label="近 10 天情绪均值"
          value={`${Math.round(avg(moodTrend.map((p) => p.mood)))}`}
          icon={TrendingUp}
          hint={
            moodDelta === 0
              ? "与前一周期基本持平"
              : `较前一周期${moodDelta < 0 ? "下降" : "上升"} ${Math.abs(moodDelta)}`
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* 情绪与压力趋势（含表格视图） */}
        <section className="ui-card p-5 sm:p-6 xl:col-span-2">
          <PanelHeading
            title="情绪与压力趋势"
            description="两个序列同为 0–100 分，共用一个值轴"
            action={<ChartRange recent={recent} onChange={setRecent} />}
          />
          <div className="mb-5 flex gap-5 text-xs text-slate-500">
            <span className="flex items-center gap-2">
              <i className="h-2 w-2 rounded-full bg-primary-500" />
              情绪指数
            </span>
            <span className="flex items-center gap-2">
              <i className="h-2 w-2 rounded-full bg-violet-300" />
              压力指数
            </span>
          </div>
          <div className="h-[240px] min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 5, right: 8, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="mood-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#465fff" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#465fff" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#f2f4f7" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#98a2b3" }}
                  axisLine={false}
                  tickLine={false}
                  dy={10}
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#98a2b3" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip contentStyle={tooltip} />
                <Area
                  type="monotone"
                  dataKey="mood"
                  name="情绪指数"
                  stroke="#465fff"
                  strokeWidth={2.5}
                  fill="url(#mood-fill)"
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="stress"
                  name="压力指数"
                  stroke="#b3a0f9"
                  strokeWidth={2}
                  fill="transparent"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <details className="mt-5 border-t border-slate-100 pt-4">
            <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-primary-600">
              以表格查看数据
            </summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] text-xs">
                <caption className="sr-only">情绪与压力趋势数据表</caption>
                <thead>
                  <tr className="text-slate-400">
                    <th scope="col" className="py-2 text-left font-medium">日期</th>
                    <th scope="col" className="py-2 text-right font-medium">情绪</th>
                    <th scope="col" className="py-2 text-right font-medium">压力</th>
                    <th scope="col" className="py-2 text-right font-medium">睡眠（小时）</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums text-slate-600">
                  {moodTrend.map((point) => (
                    <tr key={point.date} className="border-t border-slate-100">
                      <td className="py-2">{point.date}</td>
                      <td className="py-2 text-right">{point.mood}</td>
                      <td className="py-2 text-right">{point.stress}</td>
                      <td className="py-2 text-right">{point.sleep}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>

        {/* 最近一次筛查：分数 + 分数带 + 下一步建议 + 两个动作 */}
        <section className="ui-card flex flex-col p-6" aria-label="最近一次筛查">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-800">最近一次筛查</h2>
              <p className="mt-1.5 text-xs leading-5 text-slate-500">
                {lastRecord
                  ? `${definition?.name ?? lastRecord.questionnaire} · ${lastRecord.date}`
                  : "还没有完成的筛查记录"}
              </p>
            </div>
            {lastResult && (
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${levelStyles[lastResult.level].pill}`}>
                {levelStyles[lastResult.level].label}
              </span>
            )}
          </div>
          {lastRecord ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[32px] font-semibold leading-none tracking-tight text-slate-800 tabular-nums">
                  {lastRecord.score}
                  <span className="ml-1 text-base font-normal text-slate-400">/ {lastRecord.maxScore}</span>
                </p>
                <span className="text-xs font-medium text-slate-500">{lastResult?.label}</span>
              </div>
              {bands.length > 0 && (
                <>
                  <div
                    className="mt-5 flex gap-1"
                    role="img"
                    aria-label={`分档：${bands.map((band) => `${band.from}–${band.to} ${levelStyles[band.level].label}`).join("，")}；本次 ${lastRecord.score} 分`}
                  >
                    {bands.map((band) => {
                      const active = lastRecord.score >= band.from && lastRecord.score <= band.to;
                      return (
                        <span
                          key={band.level}
                          className={`h-2 rounded-full ${levelStyles[band.level].bar} ${active ? "" : "opacity-40"}`}
                          style={{ flexGrow: band.to - band.from + 1 }}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-[11px] tabular-nums text-slate-400">
                    {bands.map((band) => (
                      <span key={band.level}>
                        {band.from}–{band.to} {levelStyles[band.level].label}
                      </span>
                    ))}
                  </div>
                </>
              )}
              <p className="mt-5 border-t border-slate-100 pt-4 text-xs leading-6 text-slate-500">
                下一步建议：{lastResult?.description ?? "按建议继续记录状态，必要时预约心理辅导。"}
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link to="/personal/retrieval" className="ui-button ui-button-primary">
                  <Sparkles className="h-4 w-4" />
                  查看分析报告
                </Link>
                <Link to="/personal/screening" className="ui-button">
                  重新筛查
                </Link>
              </div>
              <p className="mt-auto pt-5 text-xs leading-5 text-slate-400">
                筛查结果仅供参考，不构成诊断。
              </p>
            </>
          ) : (
            <>
              <p className="text-[32px] font-semibold leading-none text-slate-800">暂无</p>
              <p className="mt-4 text-xs leading-6 text-slate-500">
                完成一次量表后，这里会显示分数所处区间与下一步建议。
              </p>
              <div className="mt-5">
                <Link to="/personal/screening" className="ui-button ui-button-primary">
                  <Plus className="h-4 w-4" />
                  开始筛查
                </Link>
              </div>
            </>
          )}
        </section>

        {/* 左侧下半：今日行动计划 + 睡眠时长 */}
        <div className="space-y-6 xl:col-span-2">
          <section className="ui-card p-6">
            <PanelHeading
              title="今日行动计划"
              description="从一件小事开始，为自己留一点时间"
            />
            <div className="space-y-4">
              {planItems.map((plan, index) => (
                <div
                  key={plan.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-4"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-xs font-medium text-primary-500 tabular-nums">
                      0{index + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-slate-700">{plan.title}</p>
                      <p className="mt-1 text-xs text-slate-400">建议时长 · {plan.duration}</p>
                    </div>
                  </div>
                  <StatusBadge status={plan.status} />
                </div>
              ))}
            </div>
          </section>

          <section className="ui-card p-6">
            <PanelHeading
              title="睡眠时长"
              description="近 10 天 · 单位小时（与上图的 0–100 分不同量纲，故独立成图）"
              action={<span className="text-xs tabular-nums text-slate-400">均值 {avgSleep} h</span>}
            />
            <div className="h-[120px] min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={moodTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#f2f4f7" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "#98a2b3" }}
                    axisLine={false}
                    tickLine={false}
                    dy={6}
                    minTickGap={24}
                  />
                  <YAxis
                    domain={[4, 8]}
                    ticks={[4, 6, 8]}
                    tickFormatter={(value: number) => `${value}h`}
                    tick={{ fontSize: 11, fill: "#98a2b3" }}
                    axisLine={false}
                    tickLine={false}
                    width={46}
                  />
                  <Tooltip contentStyle={tooltip} />
                  <Line
                    type="monotone"
                    dataKey="sleep"
                    name="睡眠时长"
                    stroke="#465fff"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        {/* 右侧下半：最近预警 + 可用量表 */}
        <div className="space-y-6">
          <section className="ui-card p-6">
            <PanelHeading
              title="最近预警"
              description={
                monthWarnings.length ? `本月 ${monthWarnings.length} 条` : "本月暂无新提醒"
              }
              action={
                <Link
                  to="/personal/alerts"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600 hover:border-primary-300 hover:text-primary-600"
                >
                  全部
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
            <ul className="space-y-4">
              {previewItem && (
                <li key={previewItem.id} className="rounded-xl border border-primary-200 bg-primary-50/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs tabular-nums text-slate-400">{previewItem.createdAt}</span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${levelStyles[previewItem.level].pill}`}>
                      {levelStyles[previewItem.level].label}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-700">{previewItem.title}</p>
                  <p className="mt-1.5 text-xs leading-5 text-slate-500">{previewItem.reason}</p>
                </li>
              )}
              {warningEvents.map((alert) => (
                <li key={alert.id} className="rounded-xl border border-slate-100 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs tabular-nums text-slate-400">{alert.createdAt}</span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${levelStyles[alert.level].pill}`}>
                      {levelStyles[alert.level].label}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-700">{alert.title}</p>
                  <p className="mt-1.5 text-xs leading-5 text-slate-500">{alert.reason}</p>
                  <div className="mt-3">
                    <StatusBadge status={alert.status} />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="ui-card p-6">
            <PanelHeading
              title="可用量表"
              description="选择一个开始作答，约 2–4 分钟"
            />
            <ul>
              {questionnaireCatalog.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 border-t border-slate-100 py-3 first:border-t-0 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700">{item.name}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-400">
                      {item.questions} 题 · 约 {item.minutes} 分钟 · {item.target}
                    </p>
                  </div>
                  <Link
                    to={`/personal/screening?paper=${item.id}`}
                    className="inline-flex shrink-0 items-center rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-primary-300 hover:text-primary-600"
                  >
                    开始
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {/* 说明：睡眠信息各自成图，这里给一句口径，避免和上面的 0–100 分混淆 */}
      <p className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <Moon className="h-3.5 w-3.5" />
        情绪、压力与睡眠均取自最近 10 次记录；筛查结果仅供参考，不构成诊断。
      </p>
    </div>
  );
}
