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
import AlertBadge from "../components/AlertBadge";
import StatusBadge from "../components/StatusBadge";
import LatestScreeningCard from "../components/LatestScreeningCard";

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
  const activeWarnings = warningEvents.filter(
    (item) => item.status !== "resolved",
  ).length;
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
          value={`${activeWarnings} 条`}
          icon={AlertTriangle}
          hint={
            activeWarnings > 0 ? "及时查看并跟进预警提醒" : "暂无需要跟进的预警，继续保持，你正在认真照顾自己。"
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
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
        <section className="ui-card p-6">
          <PanelHeading
            title="最近筛查记录"
            description="每一次记录，都让你更了解自己"
            action={
              <Link
                to="/personal/screening"
                className="text-xs text-primary-500 hover:text-primary-600"
              >
                查看全部
                <ArrowRight className="ml-1 inline h-3.5 w-3.5" />
              </Link>
            }
          />
          <div className="space-y-4">
            {screeningRecords.slice(0, 3).map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-4"
              >
                <div>
                  <p className="text-sm font-medium text-slate-700">
                    {item.questionnaire}
                    <span className="ml-3 text-slate-500">
                      {item.score}/{item.maxScore} 分
                    </span>
                  </p>
                  <p className="mt-1.5 text-xs text-slate-400">
                    {item.date} · {item.moodTag}
                  </p>
                </div>
                <AlertBadge level={item.level} size="sm" />
              </div>
            ))}
          </div>
          {!screeningRecords.length && (
            <p className="py-6 text-sm text-slate-400">暂无筛查记录</p>
          )}
        </section>
      </div>
      <section className="ui-card overflow-hidden">
        <div className="px-6 pt-6">
          <PanelHeading
            title="最新预警提醒"
            description="关注自己的状态，让每一条提醒得到回应"
            action={
              <Link to="/personal/alerts" className="ui-button text-xs">
                查看全部
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
        </div>
        <div className="divide-y divide-slate-100">
          {warningEvents.map((alert) => (
            <div
              key={alert.id}
              className="flex flex-wrap items-center justify-between gap-4 px-6 py-5"
            >
              <div className="flex min-w-0 items-start gap-4">
                <AlertBadge level={alert.level} size="sm" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-700">
                    {alert.title}
                  </p>
                  <p className="mt-1.5 text-xs leading-5 text-slate-500">
                    {alert.reason}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-400">
                <span>{alert.createdAt}</span>
                <StatusBadge status={alert.status} />
              </div>
            </div>
          ))}
        </div>
        {!warningEvents.length && (
          <p className="p-8 text-center text-sm text-slate-400">暂无预警提醒</p>
        )}
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
