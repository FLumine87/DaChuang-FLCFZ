import { useState, useEffect } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  UserCog,
  PhoneCall,
  CalendarClock,
  ClipboardList,
  Loader2,
  X,
} from 'lucide-react';
import type { AlertRecord } from '../data/adminMockData';
import { getAdminCounselors, updateAdminAlert } from '../../services/mockApi';
import AdminAlertBadge from './AdminAlertBadge';
import AdminStatusBadge from './AdminStatusBadge';

interface Props {
  alert: AlertRecord;
  /** 处置成功后回调，父组件据此刷新列表 */
  onUpdated: (updated: { status: AlertRecord['status']; assignee: string }) => void;
  /** 可选：抽屉模式下由外部控制关闭按钮（抽屉标题栏已有关闭按钮时可不传） */
  onClose?: () => void;
}

/** 各等级的建议处置动作（依据心理危机干预的一般实践，非医疗诊断） */
const SUGGESTIONS = {
  red: {
    title: '高危· 建议 24 小时内处置',
    tone: 'bg-danger-50 border-danger-200 text-danger-700',
    actions: ['立即电话联系当事人', '安排面对面危机评估', '通知监护人/辅导员', '上报校心理中心负责人'],
  },
  orange: {
    title: '中危 · 建议 3 日内跟进',
    tone: 'bg-orange-50 border-orange-200 text-orange-700',
    actions: ['预约一对一访谈', '持续观察情绪变化', '必要时转介专业咨询'],
  },
  yellow: {
    title: '轻度 · 建议纳入常规跟踪',
    tone: 'bg-warning-50 border-warning-200 text-warning-700',
    actions: ['一周内回访一次', '推送自助调节资源', '记录情绪波动曲线'],
  },
  green: {
    title: '稳定 · 保持观察',
    tone: 'bg-success-50 border-success-200 text-success-700',
    actions: ['归档记录', '无需额外干预'],
  },
} as const;

const NEXT_STATUS = [
  { value: 'processing', label: '开始处理' },
  { value: 'resolved', label: '标记已解决' },
  { value: 'closed', label: '关闭预警' },
] as const;

type AlertStatus = AlertRecord['status'];

const STATUS_SET: AlertStatus[] = ['pending', 'processing', 'resolved', 'closed'];

/** 后端返回的 status 是 string，收窄到联合类型（未知值回退为原状态） */
function toStatus(value: string, fallback: AlertStatus): AlertStatus {
  return (STATUS_SET as string[]).includes(value) ? (value as AlertStatus) : fallback;
}

export default function AlertDetailPanel({ alert, onUpdated, onClose }: Props) {
  const [counselors, setCounselors] = useState<{ id: number; name: string; role: string }[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setNotes('');
    setError('');
    getAdminCounselors()
      .then(setCounselors)
      .catch(() => setCounselors([]));
  }, [alert.id]);

  const suggestion = SUGGESTIONS[alert.level] ?? SUGGESTIONS.green;
  const isClosed = alert.status === 'resolved' || alert.status === 'closed';

  const save = async (patch: Parameters<typeof updateAdminAlert>[1]) => {
    setSaving(true);
    setError('');
    try {
      const res = await updateAdminAlert(alert.id, patch);
      onUpdated({ status: toStatus(res.status, alert.status), assignee: res.assignee });
      setNotes('');
    } catch (e) {
      setError((e as Error).message || '操作失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header（抽屉模式下隐藏重复的关闭按钮） */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="font-semibold text-slate-800 font-mono text-sm">{alert.id}</h3>
            <AdminAlertBadge level={alert.level} />
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {alert.name} · 关联筛查 {alert.screeningId || '—'}
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 cursor-pointer"
            aria-label="关闭详情"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="p-5 space-y-5">
        {/* 触发原因 */}
        <section>
          <h4 className="text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            触发原因
          </h4>
          <p className="text-sm text-slate-700 leading-6">{alert.trigger || alert.description}</p>
          {alert.description && alert.description !== alert.trigger && (
            <p className="text-sm text-slate-600 leading-6 mt-2">{alert.description}</p>
          )}
        </section>

        {/* 基本信息 */}
        <section>
          <h4 className="text-xs font-medium text-slate-500 mb-2 flex items-center gap-1.5">
            <ClipboardList className="w-3.5 h-3.5" />
            处置信息
          </h4>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-500">当前状态</dt>
            <dd><AdminStatusBadge status={alert.status} /></dd>
            <dt className="text-slate-500">处理人</dt>
            <dd className="text-slate-700">{alert.assignee}</dd>
            <dt className="text-slate-500">创建时间</dt>
            <dd className="text-slate-700">{alert.createdAt}</dd>
            <dt className="text-slate-500">最近更新</dt>
            <dd className="text-slate-700">{alert.updatedAt}</dd>
          </dl>
        </section>

        {/* 建议处置 */}
        <section>
          <h4 className="text-xs font-medium text-slate-500 mb-2 flex items-center gap-1.5">
            <PhoneCall className="w-3.5 h-3.5" />
            建议处置
          </h4>
          <div className={`rounded-lg border px-3.5 py-3 ${suggestion.tone}`}>
            <p className="text-sm font-medium">{suggestion.title}</p>
            <ul className="mt-2 space-y-1">
              {suggestion.actions.map((a) => (
                <li key={a} className="text-xs leading-5 flex items-start gap-1.5">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-current shrink-0" />
                  {a}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 处置操作 */}
        <section>
          <h4 className="text-xs font-medium text-slate-500 mb-2 flex items-center gap-1.5">
            <UserCog className="w-3.5 h-3.5" />
            执行处置
          </h4>

          {isClosed ? (
            <p className="text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-2.5 leading-5">
              该预警已{alert.status === 'resolved' ? '解决' : '关闭'}，如需重新跟进可由列表页筛选其他状态。
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {NEXT_STATUS.filter((s) => s.value !== alert.status).map((s) => (
                  <button
                    key={s.value}
                    onClick={() => save({ status: s.value })}
                    disabled={saving}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                                font-medium transition-colors cursor-pointer disabled:opacity-50
                                disabled:cursor-not-allowed ${
                                  s.value === 'resolved'
                                    ? 'bg-success-600 text-white hover:bg-success-700'
                                    : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                                }`}
                  >
                    {s.value === 'resolved' && <CheckCircle2 className="w-3.5 h-3.5" />}
                    {s.label}
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1.5">分配处理人</label>
                <select
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) save({ assignee_id: Number(v) });
                  }}
                  disabled={saving}
                  className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm bg-white
                             focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer
                             disabled:opacity-50"
                >
                  <option value="">选择咨询师…</option>
                  {counselors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}（{c.role === 'admin' ? '管理员' : '咨询师'}）
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1.5">跟进记录</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="记录沟通情况、后续安排…"
                  className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm resize-none
                             focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <button
                  onClick={() => save({ follow_up_notes: notes })}
                  disabled={saving || !notes.trim()}
                  className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                             bg-primary-600 text-white text-xs font-medium hover:bg-primary-700
                             transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarClock className="w-3.5 h-3.5" />}
                  保存记录
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="mt-2 text-xs text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</p>
          )}
        </section>
      </div>
    </div>
  );
}
