import { AlertTriangle, Loader2 } from 'lucide-react';

/**
 * 管理端详情抽屉 / 右侧详情的「未保存离开」确认。
 *
 * 为什么不用 window.confirm：三个选项（保存 / 放弃 / 继续编辑）在原生确认框里
 * 表达不清，而且不能显示"正在保存"。这里做成页面内小对话框，文案与按钮一一对应。
 */
export default function UnsavedChangesDialog({
  open,
  title = '还有未保存的修改',
  description,
  saving = false,
  canSave = true,
  saveDisabledHint,
  onSave,
  onDiscard,
  onContinue,
}: {
  open: boolean;
  title?: string;
  description: string;
  saving?: boolean;
  canSave?: boolean;
  saveDisabledHint?: string;
  onSave: () => void;
  onDiscard: () => void;
  onContinue: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/45"
        onClick={() => { if (!saving) onContinue(); }}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            <p className="mt-1.5 text-sm leading-6 text-slate-600">{description}</p>
            {!canSave && saveDisabledHint && (
              <p className="mt-2 text-xs leading-5 text-amber-700">{saveDisabledHint}</p>
            )}
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onContinue}
            disabled={saving}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            继续编辑
          </button>
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            className="rounded-lg border border-rose-200 px-4 py-2 text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-40"
          >
            放弃修改
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !canSave}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-40"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? '保存中…' : '保存并离开'}
          </button>
        </div>
      </div>
    </div>
  );
}
