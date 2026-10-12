import { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, Check, AlertTriangle, Info, Loader2 } from 'lucide-react';

export interface NotifyItem {
  id: string | number;
  title: string;
  description?: string;
  time?: string;
  level?: 'danger' | 'warning' | 'info';
  onClick?: () => void;
}

interface Props {
  items: NotifyItem[];
  /** 未读数量；传0 则不显示红点 */
  unread: number;
  loading?: boolean;
  /** 切换已读（本地标记） */
  onRead?: () => void;
  emptyText?: string;
}

/**
 * 通知铃铛：点击展开下拉面板。
 * - 点外面/ Esc 关闭
 * - 打开时标记已读（红点清零）
 * - 支持点击条目跳转到对应页面
 */
export default function NotificationBell({
  items,
  unread,
  loading,
  onRead,
  emptyText = '暂无新通知',
}: Props) {
  const [open, setOpen] = useState(false);
  const [localUnread, setLocalUnread] = useState(unread);
  const [marked, setMarked] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 外部未读数变化时同步（尚未手动标记已读时）
  useEffect(() => {
    if (!marked) setLocalUnread(unread);
  }, [unread, marked]);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && localUnread > 0) {
      setLocalUnread(0);
      setMarked(true);
      onRead?.();
    }
  };

  const levelMeta = {
    danger: { color: 'text-danger-600', bg: 'bg-danger-50', Icon: AlertTriangle },
    warning: { color: 'text-warning-600', bg: 'bg-warning-50', Icon: AlertTriangle },
    info: { color: 'text-primary-600', bg: 'bg-primary-50', Icon: Info },
  } as const;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        className="relative text-primary-600 hover:text-primary-800 transition-colors cursor-pointer"
        aria-label={`通知${localUnread > 0 ? `（${localUnread} 条未读）` : ''}`}
        aria-expanded={open}
      >
        {loading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <Bell className="w-5 h-5" />
        )}
        {localUnread > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-danger-500 text-white
                       text-[10px] rounded-full flex items-center justify-center tabular-nums"
          >
            {localUnread > 99 ? '99+' : localUnread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-80 bg-white rounded-xl border border-slate-200
                     shadow-xl overflow-hidden z-50"
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-800">通知</h3>
            {localUnread > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                <Check className="w-3 h-3" /> 已全部标记为已读
              </span>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs">加载中...</span>
              </div>
            ) : items.length === 0 ? (
              <p className="text-center py-10 text-slate-400 text-xs">{emptyText}</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {items.map((it) => {
                  const meta = levelMeta[it.level ?? 'info'];
                  const Icon = meta.Icon;
                  return (
                    <button
                      key={it.id}
                      onClick={() => {
                        it.onClick?.();
                        close();
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <div className="flex items-start gap-2.5">
                        <span className={`w-6 h-6 rounded-lg ${meta.bg} ${meta.color} flex items-center justify-center shrink-0 mt-0.5`}>
                          <Icon className="w-3.5 h-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-slate-800 leading-5">{it.title}</p>
                          {it.description && (
                            <p className="text-[11px] text-slate-500 mt-0.5 leading-4 line-clamp-2">
                              {it.description}
                            </p>
                          )}
                          {it.time && <p className="text-[10px] text-slate-400 mt-1">{it.time}</p>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
