interface AdminStatusBadgeProps {
  status: string;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  completed: { label: '已完成', className: 'bg-success-50 text-success-600' },
  in_progress: { label: '进行中', className: 'bg-primary-50 text-primary-500' },
  pending: { label: '待处理', className: 'bg-slate-100 text-slate-600' },
  processing: { label: '处理中', className: 'bg-primary-50 text-primary-500' },
  resolved: { label: '已解决', className: 'bg-success-50 text-success-600' },
  closed: { label: '已关闭', className: 'bg-slate-100 text-slate-500' },
  active: { label: '活跃', className: 'bg-primary-50 text-primary-500' },
  monitoring: { label: '监控中', className: 'bg-warning-50 text-warning-600' },
};

export default function AdminStatusBadge({ status }: AdminStatusBadgeProps) {
  const config = statusConfig[status] || { label: status, className: 'bg-slate-100 text-slate-600' };

  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}
