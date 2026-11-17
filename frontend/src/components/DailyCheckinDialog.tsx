import { useEffect, useRef } from 'react';
import { api, type DailyCheckinItem } from '../services/api';
import { getCurrentSession } from '../auth/session';
import { isCheckinMutedToday } from '../services/dailyCheckinFlags';
import { usePageActive } from '../services/pageActivity';

/** 只领取服务端允许展示的问询，所有入口共用每日三次预算。 */
export default function DailyCheckinDialog({ active, onEnsure }: {
  active: boolean;
  onEnsure: (item: DailyCheckinItem) => void;
}) {
  const pageActive = usePageActive();
  const userId = getCurrentSession()?.username;
  const current = useRef({ active: active || !pageActive, onEnsure });
  useEffect(() => { current.current = { active: active || !pageActive, onEnsure }; });
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    let pending = false;
    const load = async () => {
      if (pending || current.current.active || isCheckinMutedToday(userId) || document.hidden) return;
      pending = true;
      try {
        const r = await api.presentDailyCheckin(userId);
        if (alive && r.checkin?.status === 'pending' && !isCheckinMutedToday(userId)) {
          current.current.onEnsure(r.checkin);
        }
      } catch {
        // 不知道服务端预算时不自行补发，避免超额提醒。
      } finally { pending = false; }
    };
    // 延迟到 effect 安装完毕，避免 StrictMode 重放产生一次不可见展示。
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 60_000);
    return () => { alive = false; window.clearTimeout(initial); window.clearInterval(timer); };
  }, [userId]);
  return null;
}
