import { useState } from 'react';
import { Loader2, LogOut, WifiOff } from 'lucide-react';
import { logout } from '../../auth/session';

/**
 * 管理端「必须连后端才能用」的页面在离线演示下的统一说明。
 *
 * 为什么不在离线时硬造演示数据：数据审核、预警处置工作台的写操作会让人以为
 * 已经保存/推送成功，刷新后却全部消失。这里只如实说明当前状态，并给一个
 * 「退出演示、重新登录」的动作，避免用户看到一屏「接口不存在 / 凭证过期」。
 */
export default function OfflineBackendNotice({
  feature,
  detail,
}: {
  feature: string;
  detail?: string;
}) {
  const [busy, setBusy] = useState(false);

  const relogin = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await logout();
      const base = import.meta.env.BASE_URL || '/';
      window.location.href = `${base}#/login`;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ui-card mx-auto max-w-2xl p-7">
      <div className="flex items-start gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-50 text-amber-600">
          <WifiOff className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">当前是离线演示模式</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            登录时没有连上后端，{feature}需要使用服务端数据，离线演示里无法完成这一步。
          </p>
          {detail && <p className="mt-2 text-sm leading-6 text-slate-500">{detail}</p>}
          <p className="mt-2 text-[12.5px] leading-5 text-slate-400">
            这不是「没有数据」。请确认网络和后端服务可用，再退出演示并重新登录。
          </p>
          <button
            type="button"
            onClick={() => void relogin()}
            disabled={busy}
            className="ui-button ui-button-primary mt-5 inline-flex items-center gap-2 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            {busy ? '正在退出…' : '退出演示并重新登录'}
          </button>
        </div>
      </div>
    </div>
  );
}
