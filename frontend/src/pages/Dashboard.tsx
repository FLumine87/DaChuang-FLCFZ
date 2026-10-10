import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
  Moon,
  Plus,
  Sparkles,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
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
import LatestScreeningCard from "../components/LatestScreeningCard";
import type { WarningEvent } from "../data/mockData";

const warningAppearance: Record<WarningEvent["level"], { label: string; valueClassName: string; iconClassName: string }> = {
  green: { label: "绿色", valueClassName: "text-success-600", iconClassName: "bg-success-50 text-success-600" },
  yellow: { label: "黄色", valueClassName: "text-warning-600", iconClassName: "bg-warning-50 text-warning-600" },
  orange: { label: "橙色", valueClassName: "text-orange-600", iconClassName: "bg-orange-50 text-orange-600" },
  red: { label: "红色", valueClassName: "text-danger-600", iconClassName: "bg-danger-50 text-danger-600" },
};

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

export default function Dashboard() {
  const [searchParams] = useSearchParams();
  const requestedPreview = import.meta.env.DEV ? searchParams.get("alertPreview") : null;
  // 预览全部四档（原先只支持 red / orange，黄档没法预览）
  const previewLevel: "red" | "yellow" | "orange" | null =
    requestedPreview === "red"
      ? "red"
      : requestedPreview === "orange"
        ? "orange"
        : requestedPreview === "yellow"
          ? "yellow"
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
    warningDistribution,
    warningEvents,
    actionPlan,
    screeningRecords,
    userProfile,
  } = data;
  const recentWarnings = warningEvents.flatMap((alert) => {
    if (alert.status === "resolved") return [];
    const daysAgo = calendarDaysAgo(alert.createdAt);
    return daysAgo !== null && daysAgo >= 0 && daysAgo < 7 ? [{ alert, daysAgo }] : [];
  });
  const latestWarning = recentWarnings.sort((a, b) => b.alert.createdAt.localeCompare(a.alert.createdAt))[0];
  const displayedWarning = previewLevel
    ? { level: previewLevel, daysAgo: 0 }
    : latestWarning
      ? { level: latestWarning.alert.level, daysAgo: latestWarning.daysAgo }
      : null;
  const warningStyle = displayedWarning ? warningAppearance[displayedWarning.level] : null;
  const warningHint = !displayedWarning
    ? "近7天暂无新提醒，继续保持，你正在认真照顾自己。"
    : displayedWarning.daysAgo !== 0
      ? "请查看预警详情，留意后续状态变化。"
      : displayedWarning.level === "red"
        ? "请尽快查看提醒，和专业人员一起评估。"
        : displayedWarning.level === "orange"
          ? "及时关注这份提醒，和可信赖的人或专业人员聊聊。"
          : "请查看今天的预警详情，留意自己的状态。";

  // A：红/橙预警时，把该条预警的「建议动作」直接带到卡面上，
  //    不用点进预警中心才知道该做什么（预警记录里本来就有 suggestion 字段）。
  const warningAdvice =
    !previewLevel && latestWarning?.alert.suggestion ? latestWarning.alert.suggestion : null;

  // B：今日行动计划按预警等级动态增补。
  //    原先三条来自后端常量，与预警等级零联动；这里按等级在前面插入对应行动项。
  const levelPlan =
    displayedWarning?.level === "red"
      ? [{ id: "PLAN-ALERT-RED", title: "预约心理辅导", duration: "本周内", status: "new" as const }]
      : displayedWarning?.level === "orange"
        ? [{ id: "PLAN-ALERT-ORANGE", title: "与可信赖的人聊一聊", duration: "本周内", status: "new" as const }]
        : displayedWarning?.level === "yellow"
          ? [{ id: "PLAN-ALERT-YELLOW", title: "继续每日情绪记录", duration: "每日", status: "new" as const }]
          : [];
  const planItems = [...levelPlan, ...actionPlan];
  const latestSleep = moodTrend[moodTrend.length - 1]?.sleep ?? 0;
  const dayTip = timeBasedTip(new Date().getHours());
  const lastRecord = screeningRecords.find(
    (item) => item.status === "completed",
  );
  const trend = recent ? moodTrend.slice(-7) : moodTrend;
  const total = warningDistribution.reduce((sum, item) => sum + item.value, 0);
  const tooltip = {
    borderRadius: 12,
    border: "1px solid #e4e7ec",
    fontSize: 12,
    boxShadow: "0 4px 16px #1018280a",
  };

  return (
    <div className="space-y-6">
      {previewLevel && (
        <div className="ui-card flex flex-wrap items-center justify-between gap-3 border-primary-200 bg-primary-50/50 px-4 py-3 text-xs text-slate-600">
          <span>预警卡片示例预览，不计入真实记录。</span>
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/personal/dashboard?alertPreview=red" className="text-danger-600 hover:underline">红色示例</Link>
            <Link to="/personal/dashboard?alertPreview=orange" className="text-orange-600 hover:underline">橙色示例</Link>
            <Link to="/personal/dashboard?alertPreview=yellow" className="text-warning-600 hover:underline">黄色示例</Link>
            <Link to="/personal/dashboard" className="text-primary-600 hover:underline">退出预览</Link>
          </div>
        </div>
      )}
      <section className="ui-card flex flex-wrap items-center justify-between gap-5 p-6">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-500">
            <Sparkles className="h-7 w-7" strokeWidth={1.5} />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-slate-800">
              欢迎回来，{userProfile?.name || "同学"}
            </h2>
            <p className="mt-1.5 text-xs leading-5 text-slate-500">
              {[userProfile?.stage, userProfile?.major, userProfile?.campus]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p className="mt-2 text-xs text-slate-400">{dayTip}</p>
          </div>
        </div>
        <Link to="/personal/screening" className="ui-button ui-button-primary">
          <Plus className="h-4 w-4" />
          开始今日筛查
        </Link>
      </section>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="连续打卡"
          value="12 天"
          icon={ClipboardCheck}
          trend="+3 天"
          hint="较上周连续记录"
          encouragement="每一次记录，都是对自己的关心。"
        />
        <LatestScreeningCard record={lastRecord} />
        <MetricCard
          label="活跃预警"
          value={warningStyle?.label ?? "暂无"}
          valueNote={displayedWarning ? (displayedWarning.daysAgo === 0 ? "今天" : `${displayedWarning.daysAgo}天前`) : undefined}
          valueClassName={warningStyle?.valueClassName}
          iconClassName={warningStyle?.iconClassName}
          icon={AlertTriangle}
          hint={warningAdvice ? `${warningHint} 建议：${warningAdvice}` : warningHint}
          action={
            <Link to="/personal/alerts" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600 hover:border-primary-300 hover:text-primary-600">
              查看全部
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        />
        <MetricCard
          label="最近睡眠时长"
          value={`${latestSleep} 小时`}
          icon={Moon}
          hint="来自最近一次睡眠记录"
        />
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section className="ui-card p-5 sm:p-6 xl:col-span-2">
          <PanelHeading
            title="情绪与压力趋势"
            description="留意状态的变化，关注每一次积极调整"
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
          <div className="h-[280px] min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={trend}
                margin={{ top: 5, right: 8, left: -25, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="mood-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#465fff" stopOpacity={0.2} />
                    <stop
                      offset="100%"
                      stopColor="#465fff"
                      stopOpacity={0.01}
                    />
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
                />
                <Area
                  type="monotone"
                  dataKey="stress"
                  name="压力指数"
                  stroke="#b3a0f9"
                  strokeWidth={2}
                  fill="transparent"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="ui-card p-6">
          <PanelHeading
            title="历史风险分布"
            description="了解近期筛查结果的整体情况"
          />
          <div className="relative h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={warningDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={65}
                  outerRadius={88}
                  paddingAngle={3}
                  dataKey="value"
                  stroke="none"
                >
                  {warningDistribution.map((item) => (
                    <Cell key={item.name} fill={item.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltip} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-semibold text-slate-800">
                {total}
              </span>
              <span className="mt-1 text-xs text-slate-400">历史记录</span>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {warningDistribution.map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="flex items-center gap-2 text-slate-500">
                  <i
                    className="h-2 w-2 rounded-full"
                    style={{ background: item.color }}
                  />
                  {item.name}
                </span>
                <span className="font-medium text-slate-700">{item.value}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
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
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-xs font-medium text-primary-500">
                  0{index + 1}
                </span>
                <div>
                  <p className="text-sm font-medium text-slate-700">
                    {plan.title}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    建议时长 · {plan.duration}
                  </p>
                </div>
              </div>
              <StatusBadge status={plan.status} />
            </div>
          ))}
        </div>
      </section>
      <div className="flex flex-wrap gap-3">
        <Link to="/personal/retrieval" className="ui-button">
          <Sparkles className="h-4 w-4" />
          查看分析建议
        </Link>
        <Link to="/personal/data-collection" className="ui-button">
          <Plus className="h-4 w-4" />
          记录今日状态
        </Link>
      </div>
    </div>
  );
}
