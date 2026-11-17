interface AdminAlertBadgeProps {
  level: 'green' | 'yellow' | 'orange' | 'red' | 'unknown';
  size?: 'sm' | 'md';
}

const levelConfig = {
  unknown: { label: '待评估', bg: 'bg-slate-100', text: 'text-slate-500', dot: 'bg-slate-400' },
  green: { label: '正常', bg: 'bg-success-50', text: 'text-success-600', dot: 'bg-success-500' },
  yellow: { label: '关注', bg: 'bg-warning-50', text: 'text-warning-600', dot: 'bg-warning-500' },
  orange: { label: '警告', bg: 'bg-orange-50', text: 'text-orange-600', dot: 'bg-orange-500' },
  red: { label: '危险', bg: 'bg-danger-50', text: 'text-danger-600', dot: 'bg-danger-500' },
};

export default function AdminAlertBadge({ level, size = 'md' }: AdminAlertBadgeProps) {
  const safeLevel = level && level in levelConfig ? level : 'unknown';
  const config = levelConfig[safeLevel];
  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${config.bg} ${config.text} ${sizeClass}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}
