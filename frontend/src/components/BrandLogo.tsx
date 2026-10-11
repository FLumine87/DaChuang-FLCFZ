import { Activity } from "lucide-react";

export default function BrandLogo({ compact = false, subtitle = "心理筛查与健康管理" }: { compact?: boolean; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-500 text-white">
        <Activity className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </span>
      {!compact && (
        <div className="sidebar-label">
          <span className="block text-sm font-semibold tracking-tight text-slate-900">
            心理筛查预警
          </span>
          <span className="block text-[11px] tracking-wide text-slate-400">
            {subtitle}
          </span>
        </div>
      )}
    </div>
  );
}
