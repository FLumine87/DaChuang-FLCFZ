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
import { Link } from "react-router-dom";
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
  const warningStyle = latestWarning ? warningAppearance[latestWarning.alert.level] : null;
  const warningHint = !latestWarning
    ? "近7天暂无新提醒，继续保持，你正在认真照顾自己。"
    : latestWarning.daysAgo !== 0
      ? "请查看预警详情，留意后续状态变化。"
      : latestWarning.alert.level === "red"
        ? "请尽快查看提醒，和专业人员一起评估。"
        : latestWarning.alert.level === "orange"
          ? "及时关注这份提醒，和可信赖的人或专业人员聊聊。"
          : "请查看今天的预警详情，留意自己的状态。";
  const latestSleep = moodTrend[moodTrend.length - 1]?.sleep ?? 0;
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
            <p className="mt-2 text-xs text-slate-400">
              先稳定睡眠，再降低学习压力，慢慢找回自己的节奏。
            </p>
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
          valueNote={latestWarning ? (latestWarning.daysAgo === 0 ? "今天" : `${latestWarning.daysAgo}天前`) : undefined}
          valueClassName={warningStyle?.valueClassName}
          iconClassName={warningStyle?.iconClassName}
          icon={AlertTriangle}
          hint={warningHint}
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
          {actionPlan.map((plan, index) => (
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
