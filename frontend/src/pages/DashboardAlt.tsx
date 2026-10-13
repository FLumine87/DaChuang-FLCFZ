/* 个人端首页 · 另开的一版（「情绪 / 睡眠 / 压力」版）
 *
 * 与 `Dashboard.tsx`（「本次检测结果」版：量表+检索+RAG+预警并成一张卡、
 * 模态分布替掉三条曲线）并存，两版互不影响：
 *
 *   /personal/dashboard       → Dashboard.tsx     当前采用
 *   /personal/dashboard-alt   → 本文件            另存对照
 *
 * 版式取自样张 design/home-redesign/home-e.html：
 *   首屏（一句主题 + 一个主按钮）→ 独立预警块 →
 *   你的最近（情绪/睡眠/压力三行 + 最近记录）→ 今天可以做的 → 常驻求助条
 *
 * ⚠️ 数据说明：情绪 / 睡眠 / 压力三条曲线取自 moodTrend，而 moodTrend 是
 * 前端 mock 造的演示数据，后端没有这三路信号。演示可以，对外要如实标注。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { getDashboardData, type DashboardResponse } from "../services/mockApi";
import type { AlertLevel, MoodTrendPoint, PersonalScreeningRecord } from "../data/mockData";

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

function avg(points: MoodTrendPoint[], key: "mood" | "stress" | "sleep", n = 7) {
  const slice = points.slice(-n);
  if (!slice.length) return 0;
  return slice.reduce((s, p) => s + p[key], 0) / slice.length;
}

/** 后半段比前半段的变化量（正数=上升） */
function delta(points: MoodTrendPoint[], key: "mood" | "stress" | "sleep") {
  if (points.length < 4) return 0;
  const half = Math.floor(points.length / 2);
  const a = points.slice(0, half).reduce((s, p) => s + p[key], 0) / half;
  const b =
    points.slice(half).reduce((s, p) => s + p[key], 0) / (points.length - half);
  return b - a;
}

/** 迷你折线 */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="w-[96px]" />;
  const w = 96;
  const h = 26;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (w - 4) + 2;
      const y = h - 4 - ((v - min) / span) * (h - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[26px] w-[96px] shrink-0" aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke="var(--color-primary-500)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const LEVEL_LABEL: Record<string, string> = {
  red: "需关注",
  orange: "需关注",
  yellow: "留意",
  green: "平稳",
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

function modalityOf(r: PersonalScreeningRecord) {
  const kind = r.supplement?.kind;
  if (kind === "audio") return "语音";
  if (kind === "image") return "图像";
  return "文本";
}

/* ------------------------------------------------------------------ 页面 */

export default function DashboardAlt() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});

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
    const trend = data.moodTrend ?? [];
    const records = data.screeningRecords ?? [];
    const warning = (data.warningEvents ?? []).find((w) => w.status !== "resolved");
    return {
      name: data.userProfile?.name ?? "",
      date: todayLabel(),
      records,
      last: records[0],
      warning,
      plan: data.actionPlan ?? [],
      sleep: avg(trend, "sleep"),
      stress: Math.round(avg(trend, "stress")),
      moodValues: trend.map((p) => p.mood),
      sleepValues: trend.map((p) => p.sleep),
      stressValues: trend.map((p) => p.stress),
      moodDelta: delta(trend, "mood"),
      sleepDelta: delta(trend, "sleep"),
      stressDelta: delta(trend, "stress"),
    };
  }, [data]);

  if (error) {
    return <div className="ui-card p-6 text-sm text-slate-600">首页数据加载失败：{error}</div>;
  }
  if (!view) {
    return (
      <div className="grid gap-5">
        <div className="h-[140px] animate-pulse rounded-2xl bg-slate-100" />
        <div className="h-[220px] animate-pulse rounded-2xl bg-slate-100" />
      </div>
    );
  }

  const level: AlertLevel = view.last?.level ?? "green";
  const moodWord = view.moodDelta > 2 ? "好转" : view.moodDelta < -2 ? "走低" : "波动";
  const stressWord = view.stress >= 55 ? "偏高" : view.stress >= 40 ? "中等" : "较低";
  const headline =
    view.moodDelta > 2
      ? "这周比上周平稳一些"
      : view.moodDelta < -2
        ? "这周状态有些走低"
        : "这周状态基本平稳";

  return (
    <div className="grid gap-6">
      {/* ============================ 首屏 ============================ */}
      <header className="flex flex-wrap items-start justify-between gap-8 xl:gap-14">
        <div className="min-w-0">
          <p className="text-[20px] font-medium leading-none">
            <span className="text-primary-500">
              {greeting()}
              {view.name ? `，${view.name}` : ""}
            </span>
            <span className="text-slate-400"> · {view.date}</span>
          </p>
          <h1 className="mt-4 text-[44px] font-medium leading-[1.2] tracking-[0.25px] text-slate-900">
            今天，想说说自己吗？
          </h1>
          <p className="mt-3 text-[13px] leading-[1.75] text-slate-500">
            一次记录约 2–3 分钟，写几句、说一段、或者拍一张都可以。
            <br />
            系统会把三种线索一起看。
          </p>
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          <Link
            to="/personal/data-collection"
            className="grid min-w-[190px] place-items-center rounded-lg border border-transparent bg-primary-500 px-6 py-3 text-[15px] font-semibold text-white shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-colors hover:bg-primary-600"
          >
            记录一下现在
          </Link>
          <span className="text-[12.5px] text-slate-500">
            {view.last ? `${view.last.date} 记过一次` : "今天还没有记录"}
          </span>
        </div>
      </header>

      {/* ==================== 需要你处理（有预警才出现） ==================== */}
      {view.warning && (
        <section className="ui-card p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-danger-50 px-2 py-0.5 text-[12.5px] font-medium text-danger-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-danger-500" />
                  红色预警
                </span>
                <span className="text-[12.5px] text-slate-400">
                  触发于 {view.warning.createdAt}
                </span>
              </div>
              <p className="mt-3 text-[17px] font-semibold text-slate-900">
                {view.warning.title}
              </p>
              <p className="mt-1.5 max-w-[62ch] text-[14px] leading-[1.75] text-slate-600">
                {view.warning.reason}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Link to="/personal/alerts" className="ui-button ui-button-primary">
                现在可以做什么
              </Link>
              <Link to="/personal/alerts" className="ui-button">
                标记已处理
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ==================== 你的最近 + 最近记录 ==================== */}
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
            {headline}
          </p>

          <div className="mt-5">
            <MetricRow
              name="情绪"
              spark={<Spark values={view.moodValues} />}
              value={moodWord}
              delta={
                view.moodDelta > 1
                  ? "较上周 好转"
                  : view.moodDelta < -1
                    ? "较上周 走低"
                    : "与上周持平"
              }
              tone={view.moodDelta > 1 ? "good" : view.moodDelta < -1 ? "bad" : "flat"}
            />
            <MetricRow
              name="睡眠"
              spark={<Spark values={view.sleepValues} />}
              value={`${view.sleep.toFixed(1)} 小时`}
              delta={`较上周 ${view.sleepDelta >= 0 ? "↑" : "↓"} ${Math.abs(
                view.sleepDelta
              ).toFixed(1)} 小时`}
              tone={view.sleepDelta >= 0 ? "good" : "bad"}
            />
            <MetricRow
              name="压力"
              spark={<Spark values={view.stressValues} />}
              value={stressWord}
              delta={`较上周 ${view.stressDelta >= 0 ? "↑" : "↓"} ${Math.abs(
                Math.round(view.stressDelta)
              )}`}
              tone={view.stressDelta <= 0 ? "good" : "bad"}
            />
          </div>

          <p className="mt-5 border-t border-slate-100 pt-4 text-[14px] leading-[1.75] text-slate-600">
            这次的模式和{" "}
            <Link to="/personal/retrieval" className="text-primary-600 hover:text-primary-700">
              历史记录里的相似时刻
            </Link>{" "}
            很像 —— 都是任务堆叠后睡眠先掉。
          </p>
        </section>

        <section className="ui-card p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-[13px] text-slate-400">最近记录</span>
            <Link
              to="/personal/cases"
              className="text-[13px] text-slate-500 hover:text-primary-600"
            >
              查看全部
            </Link>
          </div>
          <ul className="mt-3">
            {view.records.slice(0, 5).map((r) => (
              <li
                key={r.id}
                className="grid grid-cols-[48px_36px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-slate-100 py-3 text-[14px] first:border-t-0"
              >
                <span className="tabular-nums text-[12.5px] text-slate-400">
                  {r.date?.slice(5) ?? "—"}
                </span>
                <span className="text-[12.5px] text-slate-400">{modalityOf(r)}</span>
                <span className="truncate text-slate-600">{r.moodTag}</span>
                <span
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] ${
                    LEVEL_TEXT[r.level] ?? "text-slate-500"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${LEVEL_DOT[r.level] ?? "bg-slate-400"}`}
                  />
                  {LEVEL_LABEL[r.level] ?? "—"}
                </span>
              </li>
            ))}
            {!view.records.length && (
              <li className="py-6 text-center text-[13px] text-slate-400">还没有记录。</li>
            )}
          </ul>
        </section>
      </div>

      {/* ==================== 今天可以做的 ==================== */}
      <section className="ui-card p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="text-[20px] font-semibold text-slate-900">今天可以做的</h2>
            <p className="mt-1 text-[13px] text-slate-500">从一件小事开始，完成后点一下打勾</p>
          </div>
          <span className="text-[12.5px] tabular-nums text-slate-400">
            {Object.values(done).filter(Boolean).length} / {view.plan.length}
          </span>
        </div>

        <ul className="mt-4 grid gap-2">
          {view.plan.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={!!done[item.id]}
                onClick={() => setDone((s) => ({ ...s, [item.id]: !s[item.id] }))}
                className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:bg-slate-50"
              >
                <span
                  className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border ${
                    done[item.id]
                      ? "border-primary-500 bg-primary-500 text-white"
                      : "border-slate-300"
                  }`}
                >
                  {done[item.id] && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-[14px] ${
                      done[item.id] ? "text-slate-400 line-through" : "text-slate-800"
                    }`}
                  >
                    {item.title}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] text-slate-400">
                    {item.duration}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-[12.5px] leading-6 text-slate-400">
          这些建议来自{" "}
          <Link to="/personal/retrieval" className="text-primary-600 hover:text-primary-700">
            RAG 分析
          </Link>
          ，依据是相似历史模式里恢复得比较快的那几条路径。
        </p>
      </section>

      {/* ==================== 常驻求助条 ==================== */}
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

/** 「你的最近」里的一行：名称 + 迷你折线 + 当前值 + 环比 */
function MetricRow({
  name,
  spark,
  value,
  delta,
  tone,
}: {
  name: string;
  spark: ReactNode;
  value: string;
  delta: string;
  tone: "good" | "bad" | "flat";
}) {
  const toneCls =
    tone === "good"
      ? "text-success-600"
      : tone === "bad"
        ? "text-warning-600"
        : "text-slate-400";
  return (
    <div className="grid grid-cols-[52px_96px_minmax(0,1fr)_auto] items-center gap-4 border-t border-slate-100 py-3 first:border-t-0">
      <span className="text-[14px] text-slate-400">{name}</span>
      {spark}
      <span className="text-[14px] font-semibold text-slate-800">{value}</span>
      <span className={`whitespace-nowrap text-[12.5px] ${toneCls}`}>{delta}</span>
    </div>
  );
}
