import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { loadNotices, readNotice, type Notice } from '../services/reviewApi';
import { USE_MOCK } from '../services/http';

export default function NotificationBell() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ unread: number; items: Notice[] } | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    let pending = false;
    async function refresh() {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try { const value = await loadNotices(); if (active) { setData(value); setError(''); } }
      catch (reason) { if (active) setError(reason instanceof Error ? reason.message : '读取通知失败'); }
      finally { pending = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [location.pathname, reload]);
  return <div className="relative">
    <button type="button" aria-label={data?.unread ? `站内通知，${data.unread} 条未读` : '站内通知'} aria-expanded={open}
      className="ui-button relative" onClick={() => { setOpen(!open); setReload((n) => n + 1); }}><Bell className="h-4 w-4" />
      {!!data?.unread && <span className="rounded-full bg-rose-600 px-1 text-xs text-white">{data.unread}</span>}</button>
    {open && createPortal(<section aria-label="站内通知列表" className="fixed right-4 top-16 z-[100] max-h-[70vh] w-80 max-w-[90vw] space-y-3 overflow-auto rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
      onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}>
      <div className="flex justify-between"><h3 className="font-semibold text-slate-800">站内通知</h3><button className="text-sm text-slate-500" onClick={() => setOpen(false)}>关闭通知</button></div>
      <p className="text-xs text-slate-500">打开页面时自动更新；约每30秒检查新通知。</p>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {USE_MOCK && <p className="text-xs text-amber-700">演示模式未连接真实通知。</p>}
      {!data && !error && <p role="status">正在加载通知…</p>}
      {data && !data.items.length && <p className="text-sm text-slate-500">暂无站内通知。</p>}
      {data?.items.map((item) => <div key={item.id} className="space-y-2 border-t border-slate-100 pt-2 text-sm">
        <p className="text-slate-700">{!item.read_at && <span className="text-primary-600">未读 · </span>}{item.message}</p>
        <p className="text-xs text-slate-500">{item.created_at}</p>
        <Link className="text-primary-600 hover:underline" to={item.path} onClick={() => setOpen(false)}>查看相关任务 →</Link>
        {!item.read_at && <button className="ml-3 text-xs text-slate-500" onClick={async () => {
          try { await readNotice(item.id); setReload((n) => n + 1); }
          catch (reason) { setError(reason instanceof Error ? reason.message : '标记失败'); }
        }}>标为已读</button>}
      </div>)}
    </section>, document.body)}
  </div>;
}
