import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  Binary,
  BookOpenCheck,
  Check,
  ChevronRight,
  FileText,
  HeartPulse,
  Images,
  MessageCircle,
  Mic2,
  PenLine,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link } from "react-router-dom";
import { getCurrentSession } from "../auth/session";
import {
  ChartRange,
  DashboardError,
  DashboardLoading,
  PanelHeading,
} from "../components/DashboardUI";
import type { AlertLevel } from "../data/mockData";
import { getDashboardData, type DashboardResponse } from "../services/mockApi";

const levelAppearance: Record<
  AlertLevel,
  { label: string; badge: string; dot: string; headline: string }
> = {
  green: {
    label: "状态平稳",
    badge: "bg-emerald-400/15 text-emerald-100",
    dot: "bg-emerald-300",
    headline: "最近状态比较平稳，继续保持自己的节奏",
  },
  yellow: {
    label: "建议留意",
    badge: "bg-amber-300/15 text-amber-100",
    dot: "bg-amber-300",
    headline: "状态正在变化，值得多留意一点",
  },
  orange: {
    label: "需要关注",
    badge: "bg-orange-300/15 text-orange-100",
    dot: "bg-orange-300",
    headline: "最近状态有些波动，先把节奏慢下来",
  },
  red: {
    label: "优先照顾自己",
    badge: "bg-rose-300/15 text-rose-100",
    dot: "bg-rose-300",
    headline: "最近有些辛苦，今天先照顾好自己",
  },
};

function greeting(hour: number) {
  if (hour < 5) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export default function DashboardV2() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [recent, setRecent] = useState(true);
  const [checkedPlanIds, setCheckedPlanIds] = useState<string[]>([]);

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

  if (failed) {
    return (
      <DashboardError
        retry={() => {
          setFailed(false);
          setReload((value) => value + 1);
        }}
      />
    );
  }
  if (!data) return <DashboardLoading />;

  const { moodTrend, warningEvents, actionPlan, screeningRecords } = data;
  const username = getCurrentSession()?.username || "同学";
  const latestPoint = moodTrend[moodTrend.length - 1];
  const previousPoint = moodTrend[moodTrend.length - 2];
  const moodDelta = latestPoint && previousPoint ? latestPoint.mood - previousPoint.mood : 0;
  const latestActiveWarning = [...warningEvents]
    .filter((item) => item.status !== "resolved")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const currentLevel = latestActiveWarning?.level ?? "green";
  const currentAppearance = levelAppearance[currentLevel];
  const trend = recent ? moodTrend.slice(-7) : moodTrend;
  const completedPlans = actionPlan.filter(
    (plan) => plan.status === "resolved" || checkedPlanIds.includes(plan.id),
  ).length;
  const lastRecord = screeningRecords.find((item) => item.status === "completed");

  const signals = [
    {
      icon: PenLine,
      label: "情绪记录",
      value: latestPoint ? `${latestPoint.mood} / 100` : "暂无",
      note:
        moodDelta > 0
          ? `较上次回升 ${moodDelta}`
          : moodDelta < 0
            ? `较上次下降 ${Math.abs(moodDelta)}`
            : "与上次持平",
      accent: "bg-indigo-50 text-indigo-600",
    },
    {
      icon: Activity,
      label: "压力状态",
      value: latestPoint ? `${latestPoint.stress} / 100` : "暂无",
      note: latestPoint && latestPoint.stress >= 75 ? "近期压力偏高" : "处于日常范围",
      accent: "bg-rose-50 text-rose-600",
    },
    {
      icon: HeartPulse,
      label: "睡眠恢复",
      value: latestPoint ? `${latestPoint.sleep} 小时` : "暂无",
      note: latestPoint && latestPoint.sleep < 6.5 ? "今晚可以早点休息" : "睡眠节奏不错",
      accent: "bg-emerald-50 text-emerald-600",
    },
  ];

  const pipeline = [
    {
      icon: Images,
      eyebrow: "多模态输入",
      title: "文字 · 语音 · 图像",
      description: "从多种记录中捕捉状态变化",
    },
    {
      icon: Binary,
      eyebrow: "核心能力 01",
      title: "动态跨模态哈希检索",
      description: "快速找到相似的历史风险模式",
      featured: true,
    },
    {
      icon: BookOpenCheck,
      eyebrow: "核心能力 02",
      title: "RAG 有据分析",
      description: "结合可信知识生成可解释结论",
      featured: true,
    },
    {
      icon: ShieldCheck,
      eyebrow: "安全出口",
      title: "分级预警 · 人工复核",
      description: "为后续咨询与处置提供依据",
    },
  ];

  const togglePlan = (id: string, locked: boolean) => {
    if (locked) return;
    setCheckedPlanIds((items) =>
      items.includes(id) ? items.filter((item) => item !== id) : [...items, id],
    );
  };

  const tooltipStyle = {
    borderRadius: 12,
    border: "1px solid #e4e7ec",
    fontSize: 12,
    boxShadow: "0 8px 24px #10182812",
  };

  return (
    <div className="space-y-7 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary-100 bg-primary-50/50 px-4 py-3 text-xs">
        <span className="font-medium text-primary-700">改进版个人首页 · 用于和当前版本对照</span>
        <Link to="/personal/dashboard" className="inline-flex items-center gap-1 text-slate-500 hover:text-primary-600">
          返回当前版本
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <section className="relative overflow-hidden rounded-[28px] bg-[#17213c] px-6 py-7 text-white shadow-[0_20px_60px_rgba(23,33,60,0.18)] sm:px-8 sm:py-9">
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-[#6575ff]/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 right-1/4 h-52 w-52 rounded-full bg-[#56c5a8]/10 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[1.4fr_0.72fr] lg:items-end">
          <div>
            <p className="text-sm text-white/60">
              {greeting(new Date().getHours())}，{username}
            </p>
            <div className={`mt-5 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${currentAppearance.badge}`}>
              <i className={`h-1.5 w-1.5 rounded-full ${currentAppearance.dot}`} />
              {currentAppearance.label}
            </div>
            <h2 className="mt-4 max-w-2xl text-2xl font-semibold leading-snug tracking-tight sm:text-[32px]">
              {currentAppearance.headline}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/65">
              这不是单一量表的判断。文字、语音与图像会共同参与分析，帮助你更早看见连续的状态变化。
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                to="/personal/data-collection"
                className="inline-flex items-center gap-2 rounded-xl bg-[#ffffff] px-4 py-2.5 text-sm font-medium text-[#17213c] transition hover:-translate-y-0.5 hover:bg-[#f2f4f7]"
              >
                <Plus className="h-4 w-4" />
                开始多模态记录
              </Link>
              <Link
                to="/personal/retrieval"
                className="inline-flex items-center gap-2 rounded-xl border border-[#ffffff26] bg-[#ffffff0d] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#ffffff1a]"
              >
                查看分析依据
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-[#ffffff1a] bg-[#ffffff12] p-5 backdrop-blur-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-white/55">今日综合状态</p>
                <div className="mt-2 flex items-end gap-2">
                  <span className="text-5xl font-semibold">{latestPoint?.mood ?? "--"}</span>
                  <span className="pb-1.5 text-xs text-white/45">/ 100</span>
                </div>
              </div>
              {moodDelta !== 0 && (
                <span className={`rounded-lg px-2.5 py-1 text-xs ${moodDelta > 0 ? "bg-[#6ee7b726] text-[#a7f3d0]" : "bg-[#fda4af26] text-[#fecdd3]"}`}>
                  {moodDelta > 0 ? "+" : ""}{moodDelta} 较上次
                </span>
              )}
            </div>
            <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[#ffffff1a]">
              <div
                className="h-full rounded-full bg-[#7f8dff] transition-all"
                style={{ width: `${latestPoint?.mood ?? 0}%` }}
              />
            </div>
            <p className="mt-4 text-xs leading-5 text-white/55">
              综合状态用于观察变化趋势，不是医学诊断。高风险结果仍需人工复核。
            </p>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary-500">最近信号</p>
            <h3 className="mt-1.5 text-lg font-semibold text-slate-800">这几天，哪些地方在变化</h3>
          </div>
          <p className="text-xs text-slate-400">更新于最近一次记录</p>
        </div>
        <div className="grid overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_8px_30px_rgba(16,24,40,0.04)] sm:grid-cols-3 sm:divide-x sm:divide-slate-100">
          {signals.map((signal) => (
            <div key={signal.label} className="flex items-start gap-3 border-b border-slate-100 p-5 last:border-b-0 sm:border-b-0">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${signal.accent}`}>
                <signal.icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </span>
              <div>
                <p className="text-xs text-slate-400">{signal.label}</p>
                <p className="mt-1 text-lg font-semibold text-slate-800">{signal.value}</p>
                <p className="mt-1 text-xs text-slate-500">{signal.note}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="ui-card overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium text-primary-600">平台核心链路</p>
            <h3 className="mt-1.5 text-xl font-semibold text-slate-800">动态跨模态哈希检索 + RAG 心理筛查预警</h3>
            <p className="mt-2 text-sm text-slate-500">一次综合评估如何从原始记录走向可解释、可复核的预警结果</p>
          </div>
          <Link to="/personal/retrieval" className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700">
            体验完整检索过程
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="grid md:grid-cols-2 xl:grid-cols-4">
          {pipeline.map((step, index) => (
            <div
              key={step.title}
              className={`relative min-h-48 border-b border-slate-100 p-6 md:border-r xl:border-b-0 ${step.featured ? "bg-primary-50/45" : "bg-white"}`}
            >
              {step.featured && (
                <span className="absolute right-4 top-4 rounded-full bg-primary-100 px-2 py-1 text-[12px] font-semibold text-primary-600">
                  核心
                </span>
              )}
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${step.featured ? "bg-primary-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                <step.icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </span>
              <p className="mt-5 text-[12px] font-medium uppercase tracking-[0.12em] text-slate-400">
                0{index + 1} · {step.eyebrow}
              </p>
              <h4 className="mt-2 text-sm font-semibold leading-5 text-slate-800">{step.title}</h4>
              <p className="mt-2 text-xs leading-5 text-slate-500">{step.description}</p>
              {index < pipeline.length - 1 && (
                <span className="absolute -right-3 top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-slate-100 bg-white text-slate-300 xl:flex">
                  <ChevronRight className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.55fr_0.85fr]">
        <section className="ui-card p-5 sm:p-6">
          <PanelHeading
            title="最近状态变化"
            description="持续变化比单次分数更值得关注"
            action={<ChartRange recent={recent} onChange={setRecent} />}
          />
          <div className="mb-5 flex gap-5 text-xs text-slate-500">
            <span className="flex items-center gap-2">
              <i className="h-2 w-2 rounded-full bg-primary-500" />
              情绪状态
            </span>
            <span className="flex items-center gap-2">
              <i className="h-2 w-2 rounded-full bg-rose-300" />
              压力状态
            </span>
          </div>
          <div className="h-[270px] min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 5, right: 8, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="dashboard-mood-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5b6dff" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#5b6dff" stopOpacity={0.01} />
                  </linearGradient>
                  <linearGradient id="dashboard-stress-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fda4af" stopOpacity={0.12} />
                    <stop offset="100%" stopColor="#fda4af" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#f2f4f7" />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: "#98a2b3" }} axisLine={false} tickLine={false} dy={10} minTickGap={24} />
                <YAxis tick={{ fontSize: 12, fill: "#98a2b3" }} axisLine={false} tickLine={false} domain={[0, 100]} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="mood" name="情绪状态" stroke="#5b6dff" strokeWidth={2.5} fill="url(#dashboard-mood-fill)" isAnimationActive={false} />
                <Area type="monotone" dataKey="stress" name="压力状态" stroke="#f58b9b" strokeWidth={2} fill="url(#dashboard-stress-fill)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="ui-card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-primary-500">今天先做这些</p>
              <h3 className="mt-1.5 text-lg font-semibold text-slate-800">给自己三个小任务</h3>
            </div>
            <span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-600">
              {completedPlans}/{actionPlan.length}
            </span>
          </div>
          <div className="mt-5 space-y-2">
            {actionPlan.map((plan) => {
              const locked = plan.status === "resolved";
              const done = locked || checkedPlanIds.includes(plan.id);
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => togglePlan(plan.id, locked)}
                  className="group flex w-full items-start gap-3 rounded-xl px-2 py-3 text-left transition hover:bg-slate-50"
                >
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${done ? "border-primary-500 bg-primary-500 text-white" : "border-slate-200 text-transparent group-hover:border-primary-300"}`}>
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm font-medium leading-5 ${done ? "text-slate-400 line-through" : "text-slate-700"}`}>
                      {plan.title}
                    </span>
                    <span className="mt-1 block text-xs text-slate-400">约 {plan.duration}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <Link to="/personal/alerts" className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-primary-600">
            查看完整关怀计划
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </section>
      </div>

      <section className="overflow-hidden rounded-[24px] bg-[#eef1ff] p-6 dark:bg-slate-100 sm:p-7">
        <div className="grid gap-7 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-primary-600 shadow-sm dark:bg-slate-100">
              <Sparkles className="h-5 w-5" strokeWidth={1.8} />
            </span>
            <p className="mt-5 text-xs font-medium text-primary-600">RAG 状态解读</p>
            <h3 className="mt-1.5 text-xl font-semibold text-slate-800">结论后面，也要看得见依据</h3>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              最近的压力上升与睡眠减少同时出现，情绪记录中也多次提到学习任务。系统会把检索到的相似模式与可信知识结合，给出可追溯的解释与建议。
            </p>
            <Link to="/personal/retrieval" className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary-600 hover:text-primary-700">
              查看相似案例与引用依据
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="rounded-2xl bg-white/75 p-2 shadow-sm backdrop-blur dark:bg-slate-100/60">
            <div className="flex items-start gap-3 rounded-xl px-3 py-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                <MessageCircle className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-medium text-slate-700">文字线索</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">“赶进度”“睡不着”等压力相关表达比前一周更多。</p>
              </div>
            </div>
            <div className="mx-3 border-t border-slate-100" />
            <div className="flex items-start gap-3 rounded-xl px-3 py-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                <Mic2 className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-medium text-slate-700">语音线索</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">最近一次记录中的语速与停顿变化，和压力上升同时出现。</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {lastRecord && (
        <section className="flex flex-col gap-4 border-t border-slate-100 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
              <FileText className="h-[18px] w-[18px]" />
            </span>
            <div>
              <p className="text-sm font-medium text-slate-700">辅助信息 · 最近完成 {lastRecord.questionnaire}</p>
              <p className="mt-1 text-xs text-slate-400">{lastRecord.date} · 问卷只作为多维评估中的一项参考</p>
            </div>
          </div>
          <Link to="/personal/screening" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-primary-600">
            查看问卷记录
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </section>
      )}
    </div>
  );
}
