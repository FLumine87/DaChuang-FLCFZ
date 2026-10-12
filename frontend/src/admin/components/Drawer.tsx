import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** 抽屉宽度，默认 440px */
  width?: string;
}

/**
 * 右侧抽屉：从屏幕右缘滑入，带遮罩。
 * - Esc 关闭
 * - 点击遮罩关闭
 * - 打开时锁定 body 滚动，关闭后恢复
 * - 焦点移入抽屉，关闭时归还给触发元素
 */
export default function Drawer({
  open,
  onClose,
  title,
  children,
  width = 'w-full max-w-[440px]',
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    // 聚焦抽屉，保证键盘用户可操作
    const t = setTimeout(() => panelRef.current?.focus(), 50);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
      restoreFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 遮罩 */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/30 animate-[fadeIn_.15s_ease-out]"
        aria-hidden="true"
      />

      {/* 面板 */}
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title || '详情'}
        className={`relative ${width} h-full bg-slate-50 shadow-2xl flex flex-col
                    outline-none animate-[slideIn_.22s_cubic-bezier(0.16,1,0.3,1)]`}
      >
        {title && (
          <div className="flex items-center justify-between px-5 h-14 bg-white border-b border-slate-200 shrink-0">
            <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 cursor-pointer"
              aria-label="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideIn {
          from { transform: translateX(100%) }
          to   { transform: translateX(0) }
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-\\[fadeIn_\\.15s_ease-out\\],
          .animate-\\[slideIn_\\.22s_cubic-bezier\\(0\\.16\\,1\\,0\\.3\\,1\\)\\] {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
