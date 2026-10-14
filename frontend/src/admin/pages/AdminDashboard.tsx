import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
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
  getDashboardStats,
  type AdminDashboardResponse,
  type DashboardStats,
} from "../../services/mockApi";
/* 预警处置概览用的是分页接口 /api/admin/alerts，返回 { items, total, page, pageSize }
   信封而不是裸数组。以前这里用 mockApi.getAdminAlerts()（按数组返回），
   下面 alerts.filter() 就抛 "alerts.filter is not a function"，整页白屏。 */
import { listAdminAlerts } from "../../services/adminApi";
import { type AlertRecord } from "../data/adminMockData";
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
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
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
    // 顶部指标改走真实聚合查询（/api/dashboard/stats）；失败时保持「—」占位，不影响页面其余部分
    getDashboardStats()
      .then((result) => {
        if (active) setStats(result);
      })
      .catch(() => {});
    // 预警处置概览用的原始记录（与管理端预警页同一个接口，不新增后端依赖）
    listAdminAlerts({})
      .then((page) => {
        if (active) setAlerts(page.items);
      })
      .catch(() => {});
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
  // 预警处置概览：由预警记录聚合（状态分布 + 处理人分布）
  /* 「未分配」的判定：后端对没有处理人的预警，assignee 字段填的是哨兵值
     「未分配」而非空串（见 backend _admin_alert_dict 的
     assignee_name or "未分配"），早期只判空串导致指标恒为 0
     （2026-10-14 修复：库里 45 条未分配曾显示 0）。 */
  const isUnassigned = (a: AlertRecord) => !a.assignee || a.assignee === "未分配";
  const alertStats = {
    pending: alerts.filter((a) => a.status === "pending").length,
    processing: alerts.filter((a) => a.status === "processing").length,
    resolved: alerts.filter((a) => a.status === "resolved").length,
    // 没有任何处理人的预警：唯一一个「需要立刻认领」的信号
    unassigned: alerts.filter(isUnassigned).length,
    byAssignee: Object.entries(
      alerts.reduce<Record<string, number>>((acc, a) => {
        if (isUnassigned(a)) return acc;
        acc[a.assignee] = (acc[a.assignee] ?? 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]),
  };
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
      {/* 注：顶部「待处理预警 / 本月完成率」等指标及其变化幅度目前是前端常量，
          未接入 /api/dashboard/stats；下方趋势与分布来自真实聚合查询。 */}
      {/* 首行按「要做的 → 风险总量 → 整体进度」排序：
          未分配预警（需立刻认领）→ 本月预警（黄/红总量）→ 本月完成率（进展） */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          label="未分配预警"
          value={alerts.length === 0 ? "—" : String(alertStats.unassigned)}
          icon={AlertTriangle}
          hint={
            alerts.length === 0
              ? "暂无预警记录"
              : alertStats.unassigned === 0
                ? "全部预警都已有处理人"
                : "还没有人认领，建议尽快分配"
          }
          action={
            <Link
              to="/admin/alerts"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600 hover:border-primary-300 hover:text-primary-600"
            >
              去分配
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        />
        <section className="ui-card p-5 xl:p-6">
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
          label="本月完成率"
          value={stats ? `${stats.completion_rate}%` : "—"}
          icon={TrendingUp}
          hint={
            stats
              ? `本月已完成 ${stats.monthly_screenings} 件 · 累计 ${stats.total_screenings} 件`
              : "统计接口暂不可用"
          }
          action={
            <Link
              to="/admin/screening"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600 hover:border-primary-300 hover:text-primary-600"
            >
              看明细
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
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
                <CartesianGrid vertical={false} className="chart-grid" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: "#98a2b3" }}
                  axisLine={false}
                  tickLine={false}
                  dy={10}
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "#98a2b3" }}
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
          <div className="p-6">
            {/* 原来是「本月筛查目标」仪表盘：把 87% / 261 件又画了一遍（与上面两块重复），
                且底部「待处理预警 9 条」是写死的常量。这里换成真正的新信息：
                处置状态分布 + 处理人分布，数据直接来自管理端预警接口，无需新后端。 */}
            <PanelHeading
              title="预警处置概览"
              description="按处理状态与处理人分布，决定先跟谁"
            />
            <div className="space-y-2">
              {[
                { label: "待处理", value: alertStats.pending, cls: "text-slate-800" },
                { label: "处理中", value: alertStats.processing, cls: "text-primary-600" },
                { label: "已解决", value: alertStats.resolved, cls: "text-success-600" },
              ].map((s) => (
                <div key={s.label} className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">{s.label}</span>
                  <span className={`font-medium tabular-nums ${s.cls}`}>
                    {alerts.length === 0 ? "—" : s.value}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-5 space-y-2">
              <p className="text-xs font-medium text-slate-500">处理人分布</p>
              {alertStats.byAssignee.length === 0 ? (
                <p className="text-sm text-slate-400">暂无分配记录</p>
              ) : (
                alertStats.byAssignee.map(([name, count]) => (
                  <div key={name} className="flex items-center justify-between text-sm">
                    <span className="truncate text-slate-700">{name}</span>
                    <span className="shrink-0 tabular-nums text-slate-500">{count} 条</span>
                  </div>
                ))
              )}
            </div>
            {/* 收尾：处置完成度。既填掉被左侧趋势图拉高后的空档，也提供一个「率」的视角
                （上面的计数回答“各有多少”，这里回答“整体推进到哪了”） */}
            <div className="mt-6">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>处置完成度</span>
                <span className="tabular-nums">
                  {alerts.length === 0
                    ? "—"
                    : `${alertStats.resolved} / ${alerts.length} 条 · ${Math.round(
                        (alertStats.resolved / alerts.length) * 100
                      )}%`}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-success-500 transition-all"
                  style={{
                    width: alerts.length === 0 ? "0%" : `${(alertStats.resolved / alerts.length) * 100}%`,
                  }}
                />
              </div>
            </div>
            <Link
              to="/admin/alerts"
              className="mt-5 inline-flex items-center gap-1 text-sm text-primary-600 hover:underline"
            >
              查看全部预警 <ArrowRight className="h-3.5 w-3.5" />
            </Link>
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
      {/* 跳转已集成进上方两个方块（MetricCard 的 action），此处不再重复放按钮 */}
    </div>
  );
}
