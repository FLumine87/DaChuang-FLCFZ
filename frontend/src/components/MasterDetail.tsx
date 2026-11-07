import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, MousePointerClick, PanelRightOpen, X } from 'lucide-react';

/**
 * 「左列表 + 右详情」的统一骨架（对应评审问题 5 / 9）。
 *
 * 之前该形态散落在三个页面里（个人端预警中心、管理端预警管理、管理端案例管理），
 * 各自的空态、加载态、是否默认选中、是否粘顶都不一样，于是反复出现同一类抱怨：
 * “不点就不知道右边会有内容”“看着像弹窗”。这里一次性收口四件事：
 *
 *   1. 空态永远在**顶部**，不再被左列拉到同高后垂直居中到首屏之外；
 *      并且空态是“图标 + 一句标题 + 一句说明”，看得出这里可以操作。
 *   2. 详情栏 `sticky` 且限高内滚 —— 列表再长，点完也能在视口里看到变化。
 *   3. 选中态与加载态**互斥**，加载用骨架屏，不再出现“返回列表 + 正在加载”两行并排。
 *   4. 关闭用标题栏右侧的 ×（分栏里换一张卡就是“返回”，不需要“返回列表”按钮）。
 *
 * 移动端是单列，详情排在列表下面；`selectionKey` 变化时会把详情栏滚进视口，
 * 但首屏自动选中的那一次不滚（否则一进页面就被拽到底部）。
 */

const WIDTH = {
  sm: 'lg:grid-cols-[minmax(0,1fr)_340px]',
  md: 'lg:grid-cols-[minmax(0,1fr)_minmax(340px,380px)]',
  lg: 'lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]',
} as const;

export function MasterDetail({
  list,
  detail,
  width = 'md',
}: {
  /** 左列：列表 + 分页等 */
  list: ReactNode;
  /** 右列：通常是一个 <DetailPanel> */
  detail: ReactNode;
  width?: keyof typeof WIDTH;
}) {
  return (
    /* items-start：两列各自按内容高度排，右侧不再被左列拉成一块大白板 */
    <div className={`grid items-start gap-5 ${WIDTH[width]}`}>
      <div className="min-w-0">{list}</div>
      {detail}
    </div>
  );
}

export function DetailPanel({
  selectionKey,
  title,
  subtitle,
  meta,
  onClose,
  collapsed = false,
  onExpand,
  loading = false,
  error = '',
  emptyIcon,
  emptyTitle = '选择一项查看详情',
  emptyDescription,
  children,
}: {
  /** 当前选中的 id；null 表示未选中。同时用来判断移动端是否要滚到详情 */
  selectionKey: string | null;
  title?: ReactNode;
  subtitle?: ReactNode;
  /** 标题栏右侧、关闭按钮左边的小徽标（风险等级等） */
  meta?: ReactNode;
  onClose?: () => void;
  /**
   * 收起态：点了标题栏的 × 之后不再把整块变成空态，而是留一张窄卡，
   * 上面写着“详情已收起 + 当前条目”，点一下就能展开回来。
   * 需要同时给 onExpand。
   */
  collapsed?: boolean;
  onExpand?: () => void;
  loading?: boolean;
  error?: string;
  emptyIcon?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  /* 首屏自动选中的那一次不滚动；用户后续点选才把详情拉进视口 */
  const autoSelected = useRef(true);

  useEffect(() => {
    if (!selectionKey) return;
    if (autoSelected.current) {
      autoSelected.current = false;
      return;
    }
    if (window.matchMedia('(max-width: 1023px)').matches) {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectionKey]);

  const hasSelection = selectionKey !== null;
  const isCollapsed = hasSelection && collapsed && Boolean(onExpand);

  return (
    <aside
      ref={ref}
      className={
        isCollapsed
          ? 'scroll-mt-24 lg:sticky lg:top-[88px]'
          : [
              'flex scroll-mt-24 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm',
              /* 粘顶：顶栏是 sticky 的 h-16，留 24px 呼吸位；限高后详情自己滚 */
              'lg:sticky lg:top-[88px] lg:max-h-[calc(100dvh-112px)]',
            ].join(' ')
      }
      aria-label="详情"
    >
      {isCollapsed ? (
        /* 收起态：一个小方框，写明当前是哪一条，点它展开回完整详情。
           好处：关掉详情后右侧不会突然变成一大块空白，选择也没有丢。 */
        <button
          type="button"
          onClick={onExpand}
          aria-expanded={false}
          aria-label="展开详情"
          title="展开详情"
          className="group flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-3.5 text-left shadow-sm transition-colors hover:border-primary-300 hover:bg-white"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-50 text-slate-400 transition-colors group-hover:bg-primary-50 group-hover:text-primary-600">
            <PanelRightOpen className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-slate-700">详情已收起</span>
            <span className="mt-0.5 block truncate text-xs text-slate-400">
              {title || '点击展开查看详情'}
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary-600">
            展开
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-hover:translate-y-0.5" />
          </span>
        </button>
      ) : hasSelection ? (
        <>
          <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="min-w-0">
              {(title || subtitle) && (
                <>
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {title}
                  </p>
                  {subtitle && (
                    <p className="mt-0.5 truncate text-xs text-slate-400">
                      {subtitle}
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {meta}
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  title="收起详情"
                  aria-label="收起详情"
                  className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </header>
          <div className="app-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {loading ? (
              <DetailSkeleton />
            ) : error ? (
              <p role="alert" className="text-sm text-rose-700">
                详情加载失败：{error}
              </p>
            ) : (
              children
            )}
          </div>
        </>
      ) : (
        <div className="flex min-h-[320px] flex-col items-center justify-center px-6 py-12 text-center lg:min-h-[420px]">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-50 text-slate-300">
            {emptyIcon ?? <MousePointerClick className="h-6 w-6" />}
          </span>
          <p className="mt-4 text-sm font-medium text-slate-600">{emptyTitle}</p>
          {emptyDescription && (
            <p className="mt-1.5 max-w-[280px] text-xs leading-5 text-slate-400">
              {emptyDescription}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}

/** 详情骨架：比一行“正在加载…”更像“马上就有内容”，也避免布局跳动 */
export function DetailSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="正在加载详情">
      <div className="space-y-2">
        <div className="h-3.5 w-2/3 animate-pulse rounded bg-slate-100" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-slate-100" />
      </div>
      <div className="h-24 animate-pulse rounded-xl bg-slate-50" />
      <div className="space-y-2">
        <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-slate-100" />
        <div className="h-3 w-4/6 animate-pulse rounded bg-slate-100" />
      </div>
    </div>
  );
}
