/** 移动端基础 UI 积木（触屏尺寸：可点区域 ≥ 44px） */
import type { ReactNode } from 'react';

export function Card({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl border border-slate-200/80 shadow-sm ${
        onClick ? 'active:bg-slate-50 transition-colors' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-1 mb-2 mt-1">
      <h2 className="text-[15px] font-semibold text-slate-800">{title}</h2>
      {action && (
        <button
          onClick={onAction}
          className="text-xs text-primary-600 font-medium px-2 py-1 -mr-2"
        >
          {action}
        </button>
      )}
    </div>
  );
}

export function Spinner({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
      <div className="w-7 h-7 rounded-full border-2 border-slate-200 border-t-primary-500 animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
      {icon && <div className="text-slate-200 mb-3">{icon}</div>}
      <p className="text-sm text-slate-500">{title}</p>
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  className = '',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`w-full min-h-[48px] rounded-xl bg-primary-600 text-white text-[15px] font-medium active:bg-primary-700 disabled:opacity-40 disabled:active:bg-primary-600 transition-colors ${className}`}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`min-h-[44px] px-4 rounded-xl border border-slate-200 text-slate-600 text-sm active:bg-slate-50 transition-colors ${className}`}
    >
      {children}
    </button>
  );
}

export function Chip({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 min-h-[34px] px-3.5 rounded-full text-xs border transition-colors ${
        active
          ? 'bg-primary-50 border-primary-300 text-primary-700 font-medium'
          : 'border-slate-200 text-slate-500 bg-white'
      }`}
    >
      {children}
    </button>
  );
}

/** 顶部错误/成功提示条 */
export function Banner({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'success' | 'info';
  children: ReactNode;
}) {
  const styles = {
    error: 'bg-danger-50 border-danger-200 text-danger-700',
    success: 'bg-success-50 border-success-500/30 text-success-600',
    info: 'bg-primary-50 border-primary-200 text-primary-700',
  }[kind];
  return (
    <div className={`rounded-xl border px-3.5 py-2.5 text-[13px] leading-5 ${styles}`}>
      {children}
    </div>
  );
}

export function ListRow({
  title,
  subtitle,
  right,
  onClick,
  icon,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-4 min-h-[60px] py-3 ${
        onClick ? 'active:bg-slate-50 transition-colors' : ''
      }`}
    >
      {icon && <div className="shrink-0">{icon}</div>}
      <div className="min-w-0 flex-1">
        <div className="text-[14px] text-slate-800 truncate">{title}</div>
        {subtitle && <div className="text-xs text-slate-400 mt-0.5 truncate">{subtitle}</div>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
