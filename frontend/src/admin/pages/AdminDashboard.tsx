import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Plus,
  Search,
  TrendingUp,
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
import {
  getAdminDashboardData,
  type AdminDashboardResponse,
} from "../../services/mockApi";
import {
  ChartRange,
  DashboardError,
  DashboardLoading,
  MetricCard,
  PanelHeading,
} from "../../components/DashboardUI";
import AdminAlertBadge from "../components/AdminAlertBadge";

export default function AdminDashboard() {
  const [data, setData] = useState<AdminDashboardResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [recent, setRecent] = useState(false);
  useEffect(() => {
    let active = true;
    getAdminDashboardData()
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
  const trend = recent ? data.trendData.slice(-7) : data.trendData;
  const total = data.alertDistribution.reduce(
    (sum, item) => sum + item.value,
    0,
  );
  const monthlyAlerts = data.monthlyAlertCounts ?? { yellow: 0, red: 0 };
  const monthlyAlertMax = Math.max(monthlyAlerts.yellow, monthlyAlerts.red, 1);
  const monthlyAlertBars = [
    { label: "黄色预警", value: monthlyAlerts.yellow, color: "bg-amber-400", dot: "bg-amber-400" },
    { label: "红色预警", value: monthlyAlerts.red, color: "bg-red-500", dot: "bg-red-500" },
  ];
  const tooltip = {
    borderRadius: 12,
    border: "1px solid #e4e7ec",
    fontSize: 12,
    boxShadow: "0 4px 16px #1018280a",
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <section className="ui-card p-5 sm:col-span-2 xl:p-6">
          <PanelHeading
            title="本月预警"
            description="按触发时间统计黄色与红色预警"
          />
          <div className="space-y-4" role="img" aria-label={`本月黄色预警 ${monthlyAlerts.yellow} 条，红色预警 ${monthlyAlerts.red} 条`}>
            {monthlyAlertBars.map((item) => (
              <div key={item.label}>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-slate-600">
                    <i className={`h-2.5 w-2.5 rounded-full ${item.dot}`} />
                    {item.label}
                  </span>
                  <span className="font-semibold tabular-nums text-slate-800">{item.value} 条</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${item.color}`}
                    style={{ width: `${(item.value / monthlyAlertMax) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
        <MetricCard
          label="待处理预警"
          value="9"
          icon={AlertTriangle}
          trend="-3%"
          hint="较上月待处理数量"
        />
        <MetricCard
          label="本月完成率"
          value="87%"
          icon={TrendingUp}
          trend="+5%"
          hint="较上月筛查完成率"
        />
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section className="ui-card p-5 sm:p-6 xl:col-span-2">
          <PanelHeading
            title="筛查趋势"
            description="查看筛查数量与预警变化"
            action={<ChartRange recent={recent} onChange={setRecent} />}
          />
          <div className="mb-5 flex items-center gap-5 text-xs text-slate-500">
            <span className="flex items-center gap-2">
              <i className="h-2 w-2 rounded-full bg-primary-500" />
              筛查人数
            </span>
            <span className="flex items-center gap-2">
              <i className="h-2 w-2 rounded-full bg-primary-300" />
              预警数量
            </span>
          </div>
          <div className="h-[275px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={trend}
                margin={{ top: 5, right: 8, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id="screening-fill"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#465fff" stopOpacity={0.18} />
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
                  allowDecimals={false}
                />
                <Tooltip contentStyle={tooltip} />
                <Area
                  type="monotone"
                  dataKey="count"
                  name="筛查人数"
                  stroke="#465fff"
                  strokeWidth={2.5}
                  fill="url(#screening-fill)"
                />
                <Area
                  type="monotone"
                  dataKey="alerts"
                  name="预警数量"
                  stroke="#9cb9ff"
                  strokeWidth={2}
                  fill="transparent"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="ui-card overflow-hidden">
          <div className="p-6 pb-0">
            <PanelHeading
              title="本月筛查目标"
              description="按计划推进，让关怀持续发生"
            />
            <div className="relative mx-auto max-w-[270px]">
              <svg
                viewBox="0 0 240 150"
                role="img"
                aria-label="本月筛查完成率 87%"
              >
                <path
                  d="M 25 120 A 95 95 0 0 1 215 120"
                  fill="none"
                  stroke="#f2f4f7"
                  strokeWidth="12"
                  strokeLinecap="round"
                />
                <path
                  d="M 25 120 A 95 95 0 0 1 215 120"
                  fill="none"
                  stroke="#465fff"
                  strokeWidth="12"
                  strokeLinecap="round"
                  pathLength="100"
                  strokeDasharray="87 100"
                />
              </svg>
              <div className="absolute inset-x-0 bottom-7 text-center">
                <p className="text-4xl font-semibold tracking-tight text-slate-800">
                  87<span className="text-2xl">%</span>
                </p>
                <span className="mt-2 inline-block rounded-full bg-success-50 px-2.5 py-1 text-xs font-medium text-success-600">
                  较上月 +5%
                </span>
              </div>
            </div>
            <p className="mb-6 text-center text-xs leading-6 text-slate-500">
              本月已完成 156 次筛查
              <br />
              及时跟进预警，持续完善健康档案。
            </p>
          </div>
          <div className="grid grid-cols-2 border-t border-slate-100 bg-slate-50/60 px-6 py-5 text-center">
            <div className="border-r border-slate-200">
              <p className="text-xs text-slate-500">本月筛查</p>
              <p className="mt-1.5 text-lg font-semibold text-slate-800">
                156{" "}
                <span className="text-xs font-normal text-slate-400">次</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">待处理预警</p>
              <p className="mt-1.5 text-lg font-semibold text-slate-800">
                9 <span className="text-xs font-normal text-slate-400">条</span>
              </p>
            </div>
          </div>
        </section>
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section className="ui-card overflow-hidden xl:col-span-2">
          <div className="px-6 pt-6">
            <PanelHeading
              title="最新预警"
              description="优先关注需要跟进的筛查记录"
              action={
                <Link to="/admin/alerts" className="ui-button py-2 text-xs">
                  查看全部
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
          </div>
          <div className="ui-table-scroll">
            <table className="ui-table">
              <thead>
                <tr>
                  <th className="text-left">筛查对象</th>
                  <th className="text-left">风险等级</th>
                  <th className="text-left">跟进人员</th>
                  <th className="text-left">触发时间</th>
                </tr>
              </thead>
              <tbody>
                {data.alertRecords.slice(0, 4).map((alert) => (
                  <tr key={alert.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-50 text-sm font-medium text-primary-500">
                          {alert.name.slice(0, 1)}
                        </span>
                        <div>
                          <p className="font-medium text-slate-700">
                            {alert.name}
                          </p>
                          <p
                            className="mt-1 max-w-52 truncate text-xs text-slate-400"
                            title={alert.trigger}
                          >
                            {alert.trigger}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <AdminAlertBadge level={alert.level} size="sm" />
                    </td>
                    <td className="text-slate-500">{alert.assignee}</td>
                    <td className="whitespace-nowrap text-xs text-slate-400">
                      {alert.createdAt}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.alertRecords.length && (
            <p className="p-8 text-center text-sm text-slate-400">
              暂无预警记录
            </p>
          )}
        </section>
        <section className="ui-card p-6">
          <PanelHeading
            title="风险等级分布"
            description="当前筛查结果的风险构成"
          />
          <div className="relative h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.alertDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={62}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="value"
                  stroke="none"
                >
                  {data.alertDistribution.map((item) => (
                    <Cell key={item.name} fill={item.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltip} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-semibold text-slate-800">
                {total}
              </span>
              <span className="mt-1 text-xs text-slate-400">筛查记录</span>
            </div>
          </div>
          <div className="mt-3 space-y-3">
            {data.alertDistribution.map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between text-sm"
              >
                <span className="flex items-center gap-2 text-slate-500">
                  <i
                    className="h-2 w-2 rounded-full"
                    style={{ background: item.color }}
                  />
                  {item.name}
                </span>
                <span className="font-medium text-slate-700">
                  {item.value}
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {total ? Math.round((item.value / total) * 100) : 0}%
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link to="/admin/screening" className="ui-button ui-button-primary">
          <Plus className="h-4 w-4" />
          管理筛查
        </Link>
        <Link to="/admin/agent-workbench" className="ui-button">
          <AlertTriangle className="h-4 w-4" />
          预警处置工作台
        </Link>
        <Link to="/admin/retrieval" className="ui-button">
          <Search className="h-4 w-4" />
          检索与分析
        </Link>
      </div>
    </div>
  );
}
