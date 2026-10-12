import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  /** 左侧额外说明，如筛选结果数 */
  hint?: string;
}

/**
 * 分页条：页码 + 前后翻页 + 省略号。
 * 供管理端案例/预警/筛查列表共用。
 */
export default function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onChange,
  hint,
}: PaginationProps) {
  if (total === 0) return null;

  const pages = buildPages(page, totalPages);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-1">
      <p className="text-sm text-slate-500">
        {hint ?? `共 ${total} 条`}
        <span className="text-slate-400"> · 每页 {pageSize} 条</span>
      </p>

      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          aria-label="上一页"
          className="p-1.5 rounded-lg border border-slate-200 text-slate-600 bg-white
                     hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed
                     disabled:hover:bg-white transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`gap-${i}`} className="px-1.5 text-sm text-slate-400">
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onChange(p)}
              aria-current={p === page ? 'page' : undefined}
              className={`min-w-9 px-2.5 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${
                p === page
                  ? 'bg-primary-600 text-white font-medium'
                  : 'border border-slate-200 text-slate-600 bg-white hover:bg-slate-50'
              }`}
            >
              {p}
            </button>
          )
        )}

        <button
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="下一页"
          className="p-1.5 rounded-lg border border-slate-200 text-slate-600 bg-white
                     hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed
                     disabled:hover:bg-white transition-colors cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/** 生成页码序列：首页、当前页±1、末页，中间用 ... 省略 */
function buildPages(current: number, total: number): (number | '...')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const out: (number | '...')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push('...');
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push('...');
  out.push(total);
  return out;
}
