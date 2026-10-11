import { Activity } from "lucide-react";

export default function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-500 text-white shadow-sm">
        <Activity className="h-6 w-6" strokeWidth={2.5} aria-hidden="true" />
      </span>
      {!compact && (
        <div className="sidebar-label">
          <span className="block text-lg font-semibold tracking-tight text-slate-900">
            心理筛查预警
          </span>
          <span className="block text-[11px] tracking-wide text-slate-400">
            心理筛查与健康管理
          </span>
        </div>
      )}
    </div>
  );
}
