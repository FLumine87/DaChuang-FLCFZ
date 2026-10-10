import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  RefreshCw,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

export function MetricCard({
  label,
  value,
  icon: Icon,
  hint,
  encouragement,
  action,
  valueNote,
  valueClassName,
  iconClassName,
  trend,
  positive = true,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  hint?: string;
  encouragement?: string;
  action?: ReactNode;
  valueNote?: string;
  valueClassName?: string;
  iconClassName?: string;
  trend?: string;
  positive?: boolean;
}) {
  return (
    <div className="ui-card p-5 xl:p-6">
      <div className="mb-5 flex items-start justify-between gap-2">
        <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${iconClassName ?? "bg-slate-100 text-slate-700"}`}>
          <Icon className="h-6 w-6" strokeWidth={1.7} />
        </div>
        {action}
      </div>
      <p className="text-sm text-slate-500">{label}</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
        <div className="flex items-start gap-2">
          <p className={`text-[28px] font-semibold leading-tight tracking-tight tabular-nums ${valueClassName ?? "text-slate-800"}`}>
            {value}
          </p>
          {valueNote && <span className="pt-1 text-[11px] text-slate-400">{valueNote}</span>}
        </div>
        {trend && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${positive ? "bg-success-50 text-success-600" : "bg-danger-50 text-danger-600"}`}
          >
            {trend.startsWith("-") ? (
              <ArrowDown className="h-3 w-3" />
            ) : (
              <ArrowUp className="h-3 w-3" />
            )}
            {trend}
          </span>
        )}
      </div>
      {hint && <p className="mt-3 text-xs leading-5 text-slate-400">{hint}</p>}
      {encouragement && <p className="mt-4 text-xs leading-6 text-slate-500">{encouragement}</p>}
    </div>
  );
}

export function PanelHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-slate-800">{title}</h2>
        {description && (
          <p className="mt-1.5 text-xs leading-5 text-slate-500">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function DashboardLoading() {
  return (
    <div className="space-y-6" role="status" aria-label="正在加载统计数据">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="ui-card animate-pulse p-6">
            <div className="mb-5 h-12 w-12 rounded-xl bg-slate-100" />
            <div className="h-3 w-24 rounded bg-slate-100" />
            <div className="mt-3 h-8 w-28 rounded bg-slate-100" />
          </div>
        ))}
      </div>
      <div className="ui-card flex h-80 items-center justify-center gap-3 text-sm text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
        正在加载统计数据…
      </div>
    </div>
  );
}

export function DashboardError({ retry }: { retry: () => void }) {
  return (
    <div
      className="ui-card flex flex-col items-center gap-4 py-16 text-center"
      role="alert"
    >
      <TriangleAlert className="h-8 w-8 text-warning-500" />
      <p className="text-sm text-slate-500">
        暂时无法加载统计数据，请稍后重试。
      </p>
      <button className="ui-button" onClick={retry}>
        <RefreshCw className="h-4 w-4" />
        重新加载
      </button>
    </div>
  );
}

export function ChartRange({
  recent,
  onChange,
}: {
  recent: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div
      className="inline-flex rounded-lg bg-slate-100 p-1"
      aria-label="趋势显示范围"
    >
      {[
        { label: "全部", value: false },
        { label: "近 7 次", value: true },
      ].map((item) => (
        <button
          key={item.label}
          aria-pressed={recent === item.value}
          onClick={() => onChange(item.value)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${recent === item.value ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
