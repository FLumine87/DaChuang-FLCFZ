import { Activity } from "lucide-react";

/* tone="light"：用于品牌色底（如登录页顶栏），文字与标志块反白；
   默认 "dark" 保持侧边栏等浅色场景的原样。 */
export default function BrandLogo({
  compact = false,
  tone = "dark",
  showSubtitle = true,
}: {
  compact?: boolean;
  tone?: "dark" | "light";
  /* 顶栏用「品牌 ｜ 页面名」时只要单行品牌名，关掉副标题；
     侧边栏默认保留副标题。 */
  showSubtitle?: boolean;
}) {
  const light = tone === "light";
  return (
    <div className="flex items-center gap-3">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm ${
          light ? "bg-white text-primary-600" : "bg-primary-500 text-white"
        }`}
      >
        <Activity className="h-6 w-6" strokeWidth={2.5} aria-hidden="true" />
      </span>
      {!compact && (
        <div className="sidebar-label">
          <span
            className={`block text-lg font-semibold tracking-tight ${
              light ? "text-white" : "text-slate-900"
            }`}
          >
            心理筛查预警
          </span>
          {showSubtitle && (
            <span
              className={`block text-[12px] tracking-wide ${
                light ? "text-white/70" : "text-slate-400"
              }`}
            >
              心理筛查与健康管理
            </span>
          )}
        </div>
      )}
    </div>
  );
}
