interface AlertBadgeProps {
  level: 'green' | 'yellow' | 'orange' | 'red';
  size?: 'sm' | 'md';
  /** 额外类名（如 flex 行里用 shrink-0 防止徽章被挤压变形/推出容器） */
  className?: string;
}

const levelConfig = {
  green: { label: '稳定', bg: 'bg-success-50', text: 'text-success-600', dot: 'bg-success-500' },
  yellow: { label: '关注', bg: 'bg-warning-50', text: 'text-warning-600', dot: 'bg-warning-500' },
  orange: { label: '警告', bg: 'bg-orange-50', text: 'text-orange-600', dot: 'bg-orange-500' },
  red: { label: '危险', bg: 'bg-danger-50', text: 'text-danger-600', dot: 'bg-danger-500' },
};

export default function AlertBadge({ level, size = 'md', className = '' }: AlertBadgeProps) {
  const safeLevel = level && level in levelConfig ? level : 'green';
  const config = levelConfig[safeLevel];
  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium ${config.bg} ${config.text} ${sizeClass} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}
