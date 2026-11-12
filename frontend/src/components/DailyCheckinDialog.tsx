import { useEffect, useRef, useState } from 'react';
import { BellRing, MessageCircleHeart, X } from 'lucide-react';
import { api, type DailyCheckinItem } from '../services/api';
import { getCurrentSession } from '../auth/session';
import { isCheckinMutedToday, markCheckinDeclined, markCheckinLater } from '../services/dailyCheckinFlags';
import AiCompanionBot from './AiCompanionBot';

/* ── 今日问询：进入「AI 陪伴对话」页当天首次自动弹窗（2026-11-07） ───────────────
 *
 * 演进过程：
 *   ① 最初是 APScheduler 每天 20:00 定时跑 —— 到点时用户多半不在线，
 *      问题只能躺在库里等人来翻；
 *   ② 改成"登录进系统就触发"，挂在外壳上 —— 但用户在首页/量表页也会被弹，
 *      和"想聊两句"的时机不一定对得上；
 *   ③ 现在改为**只在打开 AI 陪伴对话页时弹**，且自动弹出、不需要用户先点
 *      「回复」按钮。问询出现的那一刻，用户正好在对话页、正好想聊 —— 时机最自然。
 *
 * 什么时候弹（判据只有一条，避免出现"标记憋住弹窗"的陷阱）：
 *   **今天的问询状态仍是 pending，且用户今天没有主动关掉它** → 弹。
 *
 *   这里刻意**不用**"今天已触发过"这类本机标记来拦住弹窗。曾经有过一个
 *   `psych_checkin_ensured` 标记（初衷是省一次 HTTP 请求），但它带来一个
 *   真实的问题：只要今天触发过一次，之后即使问询**从未被回答**也不再弹 ——
 *   用户清了服务端记录重测，弹窗照样不出来，看着像功能坏了。
 *   而省请求这件事本来就不需要它：服务端 `ensure` 是幂等的，今天已有记录
 *   直接复用、**不重复调大模型**，所以放心每次都调。
 *
 * 一天只问一次的保证：
 *   服务端 `POST /checkin/ensure` 幂等（今天已有记录直接复用，不重复生成、
 *   不重复消耗 LLM 额度）—— 这是真正的保证；客户端只负责表达"用户当下
 *   不想被打扰"（稍后回复 / 不想回复 / 关闭），分别落到下面两个标记。
 *
 * 三个选项（用户 2026-11-07 指定）：
 *   · 回复      → 在对话页原地进入回答态（无需再点一次「回复」）
 *   · 稍后回复  → 今天不再弹，但保留 pending，可随时在待回复区回复
 *   · 不想回复  → 服务端置 declined，今天不再弹也不在待回复列表出现
 */

interface DailyCheckinDialogProps {
  /**
   * 只做"拉取 + 状态判断"，不渲染弹窗：由调用方把问询渲染成对话流卡片。
   * 聊天页现在用这种方式（2026-11-12），其他页面仍可用默认的弹窗形态。
   */
  inline?: boolean;
  /**
   * 用户点「回复」时的回调：由聊天页接管（原地进入回答态）。
   * 不传则退化为跳转（保留旧的 /me/chat 跳转行为，便于在别处复用）。
   */
  onReply?: (item: DailyCheckinItem) => void;
  /**
   * 拿到今天的问询后的回调（无论是否弹窗）。
   * 聊天页用它把这条同步进页内「待回复」横幅 —— 否则用户点了「稍后回复」
   * 关掉弹窗后，横幅还是空的（因为它挂载时 ensure 还没跑完）。
   */
  onEnsure?: (item: DailyCheckinItem) => void;
  /** 未提供 onReply 时的跳转地址前缀，默认 /personal */
  root?: string;
}

export default function DailyCheckinDialog({ inline = false, onReply, onEnsure, root = '/personal' }: DailyCheckinDialogProps) {
  const userId = getCurrentSession()?.username ?? null;
  const [item, setItem] = useState<DailyCheckinItem | null>(null);
  const [busy, setBusy] = useState(false);
  /* 一次挂载只触发一轮：React 严格模式下 effect 会跑两次，这里挡住第二次 */
  const startedRef = useRef(false);

  useEffect(() => {
    if (!userId || startedRef.current) return;
    startedRef.current = true;

    /* 用户今天已经明确表达过"待会说"或"不想回复" → 不再打扰。
       注意这里**没有**"今天已触发过就不弹"的闸门：只要问询还没被处理，
       重开页面就该继续弹，否则会出现"清了记录也弹不出来"的假故障。 */
    if (isCheckinMutedToday(userId)) {
      return;
    }
    void (async () => {
      try {
        /* ensure 幂等：今天已有记录直接复用（不重复生成、不重复调大模型），
           所以这里放心每次都调，无需本机标记来省钱。 */
        const r = await api.ensureDailyCheckin(userId);
        if (!r.checkin) return;
        /* 无论弹不弹窗都先报给聊天页：让它把这条挂进页内横幅，
           这样用户点「稍后回复」关掉弹窗后，横幅仍在、随时能回。 */
        onEnsure?.(r.checkin);
        /* 只有 pending 才弹：已回复 / 已过期 / 已「不想回复」都不该再打扰 */
        if (r.checkin.status !== 'pending') return;
        /* inline：问询由调用方渲染成对话流卡片，本组件不弹窗 */
        if (!inline) setItem(r.checkin);
      } catch {
        /* 问询是可选增强（后端未起 / 8001 未连都属正常），静默跳过，不打断对话 */
      }
    })();
  }, [userId]);

  if (!item) return null;

  /** 稍后回复：今天不再弹，但保留 pending（还能在待回复区回复） */
  const handleLater = () => {
    markCheckinLater(userId ?? '');
    setItem(null);
  };

  /** 不想回复：服务端置 declined，今天不再弹、也不在待回复列表出现 */
  const handleDecline = async () => {
    if (busy) return;
    setBusy(true);
    /* 先关窗再请求：用户已经表达了"不想回复"，不该因为网络慢就把他卡在弹窗里。
       失败也不重弹（本机标记兜住），服务端下次 ensure 仍会给出 pending，
       但用户当天已明确拒绝过，不该再被追着问。 */
    markCheckinDeclined(userId ?? '');
    setItem(null);
    try {
      await api.declineCheckin(item.id, userId ?? '');
    } catch {
      /* 静默：拒绝是"减负"操作，失败不必弹错误打扰用户 */
    } finally {
      setBusy(false);
    }
  };

  /** 回复：交给聊天页原地进入回答态（避免"点回复还要再点一次"） */
  const handleReply = () => {
    const target = item;
    setItem(null);
    if (onReply) {
      onReply(target);
    } else {
      window.location.hash = `#${root}/me/chat`;
    }
  };

  return (
    /* 居中弹窗：fixed inset-0 + items-center justify-center，body 尺寸内水平垂直都居中 */
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="今日关怀问询"
    >
      <div className="ui-card w-full max-w-md p-6 shadow-[0_24px_70px_-36px_rgba(16,24,40,0.45)]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* 机器人形象与聊天页同一套：让"问询"和"陪你聊"看起来是同一个人 */}
            <AiCompanionBot size={44} className="shrink-0" />
            <div>
              <h3 className="text-base font-semibold text-slate-800">今天过得怎么样？</h3>
              <p className="mt-0.5 text-xs text-slate-400">每日一问 · {item.checkin_date}</p>
            </div>
          </div>
          <button
            onClick={handleLater}
            aria-label="关闭"
            className="cursor-pointer text-slate-400 transition-colors hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="rounded-xl bg-primary-50 p-4 text-sm leading-relaxed text-slate-700">
          {item.message}
        </div>

        <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-slate-400">
          <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          回答内容会整理进你的个人知识图谱。一天只问一次，稍后可在「AI 陪伴对话」里回复。
        </p>

        {/* 三个选项：回复（主）/ 稍后回复 / 不想回复（弱化的文字按钮） */}
        <div className="mt-5 flex items-center gap-2">
          <button
            onClick={handleReply}
            className="flex-1 cursor-pointer rounded-xl bg-primary-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600"
          >
            <MessageCircleHeart className="mr-1.5 inline h-4 w-4 align-[-2px]" />
            回复
          </button>
          <button
            onClick={handleLater}
            className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-800"
          >
            稍后回复
          </button>
          <button
            onClick={handleDecline}
            disabled={busy}
            className="cursor-pointer rounded-xl px-3 py-2.5 text-sm text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600 disabled:opacity-50"
          >
            不想回复
          </button>
        </div>
      </div>
    </div>
  );
}
