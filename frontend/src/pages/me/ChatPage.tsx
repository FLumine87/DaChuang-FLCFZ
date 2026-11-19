import { useEffect, useMemo, useRef, useState } from 'react';
import { stewardApi, streamSteward, useSteward } from '../../services/steward';
import { useLocation, useNavigate } from 'react-router-dom';
import { Send, Sparkles, RefreshCw, AlertTriangle, MessageCircleHeart, HardDrive, BellRing, Trash2 } from 'lucide-react';
import { api, type ChatTurn, type InferenceRunResult, type DailyCheckinItem } from '../../services/api';
import { getCurrentSession } from '../../auth/session';
import { briefErrorMessage } from '../../services/http';
import {
  buildLocalReport,
  collectLocalSignals,
  readLocalKg,
} from '../../services/localKg';
import {
  clearChatHistory,
  readChatHistory,
  saveChatHistory,
  type StoredChatMessage,
} from '../../services/chatHistory';
import { withTimeDividers } from '../../services/chatTime';
import DailyCheckinDialog from '../../components/DailyCheckinDialog';
import { markCheckinDeclined, markCheckinReplied } from '../../services/dailyCheckinFlags';
import RoamingBot from '../../components/RoamingBot';
import { usePageActive } from '../../services/pageActivity';

/** 消息结构与本机存储层一致（StoredChatMessage），避免两边各定义一份走样 */
type ChatMessage = StoredChatMessage;

const WELCOME = '您好，我是您的 AI 心理陪伴助手。愿意的话，我们可以聊聊近况。我只会在您允许时将聊天用于长期记忆；您可以随时查看或纠正我的理解，也可以选择临时对话。';

/**
 * 新一条欢迎语（带当前时间）。
 *
 * 为什么要带 at：对话里现在有时间节点，欢迎语是"这次对话的起点"，
 * 没有时间的话首条分隔线会空缺，看起来像时间功能坏了。
 */
function welcomeMessage(): ChatMessage {
  return { id: Date.now(), role: 'assistant', text: WELCOME, at: new Date().toISOString() };
}

// 本地兜底回复（后端未配置 LLM 对话时），语气温暖支持性
const FALLBACK_REPLIES = [
  '谢谢您愿意分享这些。我在认真听，也想多了解一点——能具体说说这件事带给您的感受吗？',
  '我能感受到这句话背后的分量。这样的时刻确实不容易，您已经在尽力面对了。',
  '收到。我把您提到的内容记下来了。如果愿意，可以再多聊一点，比如它对您的睡眠或心情有什么影响？',
  '我在。您说的这些对我很重要，我会一直在这里陪着您梳理。',
];

export default function ChatPage() {
  const pageActive = usePageActive();
  const session = getCurrentSession();
  const userId = session?.username ?? 'demo_user';
  const workspaceOwner=useRef(userId);
  const [temporary, setTemporary] = useState(false);
  const { data: stewardState } = useSteward();
  const generationVersion = useRef(0);
  const savedRegular = useRef<ChatMessage[]>([]);
  const [recovering, setRecovering] = useState(session?.role === 'user');
  const location = useLocation();
  const navigate = useNavigate();

  /* 消息从**本机聊天记录**载入（惰性初始化，同步读取，不会闪一下空页面）。
     此前是写死的单条欢迎语 —— 离开页面即清空，用户回到这里聊天记录全丢。
     读不到（首次进来 / 清空过）才放欢迎语。 */
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const stored = readChatHistory(userId);
    return stored.length ? stored : [welcomeMessage()];
  });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checkinError, setCheckinError] = useState('');
  /** 清空确认弹窗 */
  const [confirmClear, setConfirmClear] = useState(false);
  /** 是否还有历史可清（只有欢迎语时不必给清空入口） */
  const canClear = messages.some((m) => m.role === 'user');
  /** 本机（localStorage）已记录的三元组条数：L1 方案下这是"越聊越有"的唯一凭据 */
  const [localCount] = useState(() => readLocalKg(userId).triples.length);
  /** 服务端是否处于演示（mock）模式：右上角如实标注，不把演示抽取说成真实抽取 */
  const [mockServer] = useState<boolean | null>(null);
  /** 今日问询由服务端统一分配展示资格，卡片只呈现允许的这一轮。 */
  const [flowCheckin, setFlowCheckin] = useState<{
    item: DailyCheckinItem;
    message: string;
    note?: string;
    err?: string;
  } | null>(null);
  useEffect(() => {
    if (!flowCheckin || busy) return;
    const timer = window.setTimeout(() => setFlowCheckin(null), 120_000);
    return () => window.clearTimeout(timer);
  }, [flowCheckin, busy]);

  const bottomRef = useRef<HTMLDivElement>(null);

  /* ── 机器人（2026-11-08 第三轮：改为全屏游走） ──────────────────────────
     panelRef  —— 本页整块对话面板。机器人挂在整个页面内容区（宿主框由面板的
                  实时 rect 反推），位置全部相对面板推算（见 RoamingBot 文件头）。
     composerRef —— 输入行，用户一输入它就贴到这一行的外侧探身看
     peeking   —— 是否处于"探身看"姿态：输入框聚焦或有内容时为真
     为什么用"聚焦 或 有内容"而不是只看聚焦：用户按 Esc 或点到别处但字还没发，
     机器人立刻站回去会显得很跳；有内容就继续看着，直到输入被清空/发出。 */
  const panelRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const peeking = inputFocused || input.trim().length > 0;

  /** 渲染序列：给消息插时间分隔线（跨天 / 长间隔 / 首条） */
  const rows = useMemo(() => withTimeDividers(messages), [messages]);

  /* 消息一变就写回本机：用户消息、流式回复的增量文本、后到的抽取结果、离线兜底，
     全部自动落盘。写空消息由 saveChatHistory 内部滤掉（流式占位气泡不算）。 */
  useEffect(() => {
    if (!temporary && workspaceOwner.current === userId) saveChatHistory(userId, messages);
  }, [userId, messages, temporary]);

  useEffect(() => {
    if (session?.role !== 'user' || workspaceOwner.current !== userId) return;
    let alive = true;
    const revision = generationVersion.current;
    const recover = async () => {
      const runs = await stewardApi.history();
      if (!alive || generationVersion.current !== revision) return;
      if (runs.length) {
        setMessages(runs.flatMap(r => {
          const id = Number.parseInt(r.id.slice(0, 12), 16);
          return [{ id, role:'user' as const, text:r.message, at:r.created_at }, { id:id+1, role:'assistant' as const, text:r.reply || (r.status === 'failed' ? r.error : '回复仍在后台生成…'), at:r.created_at, runId:r.id, generationStatus:r.status }];
        }));
      }
      setRecovering(false);
      if (runs.some(r => r.status === 'queued' || r.status === 'running')) timeout = setTimeout(() => void recover().catch(() => setRecovering(false)), 1000);
    };
    let timeout: ReturnType<typeof setTimeout>;
    void recover().catch(() => { if (alive) setRecovering(false); });
    return () => { alive = false; clearTimeout(timeout); };
  }, [userId, session?.role]);

  /** 正在回复的每日问询：用户点"回复"或从弹窗跳来后置位，下一条发出的消息即作为它的答复 */
  const [answering, setAnswering] = useState<DailyCheckinItem | null>(null);
  const privacySources=JSON.stringify(stewardState?.settings);
  useEffect(() => {
    const id=flowCheckin?.item?.id ?? answering?.id;
    if (!pageActive || !id || id < 1) return;
    let alive=true;
    void api.getPendingCheckins(userId).then(result => {
      if (alive && !(result.pending ?? []).some(item => item.id === id)) {
        setFlowCheckin(null); setAnswering(null);
      }
    }).catch(() => {});
    return () => { alive=false; };
  },[pageActive,userId,flowCheckin?.item?.id,answering?.id,stewardState?.evidence_count,privacySources]);

  /* 从「每日问询」弹窗点「现在就聊聊」跳过来时，路由 state 里带着那条问询。
     两处都要用到它的 id：
       · 待回复列表拉回来时把这条排除掉（用户已在回复了，横幅不该重复挂着）；
       · 自动进入回答态。
     用 ref 存住"初始那一条"、用另一个 ref 记"是否已消费"——若把 item 本身清掉，
     异步返回的列表就没法再做排除，会出现"已进入回答态但横幅还在"。 */
  const incomingRef = useRef<DailyCheckinItem | null>(
    (location.state as { answerCheckin?: DailyCheckinItem } | null)?.answerCheckin ?? null,
  );
  const incomingConsumedRef = useRef(false);

  useEffect(() => {
    if (pageActive) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy, pageActive]);

  /** 开始回复某条每日问询：把它作为助手消息补进对话，并标记为当前待答复对象 */
  const startAnswer = (item: DailyCheckinItem) => {
    setAnswering(item);
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        role: 'assistant',
        text: `${item.message}\n（每日问询 · ${item.checkin_date}）`,
        at: new Date().toISOString(),
      },
    ]);
  };

  /* 兼容从别处跳转过来时带的问询（老路径）：自动进入回答态，只消费一次。
     正常情况下弹窗就在本页内，点「回复」直接调 startAnswer，不走这条路径。 */
  useEffect(() => {
    const incoming = incomingRef.current;
    if (!incoming || incomingConsumedRef.current) return;
    incomingConsumedRef.current = true;
    startAnswer(incoming);
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 取消手动回复；下一轮仍由服务端提醒预算决定。 */
  const cancelAnswer = () => {
    setAnswering(null);
  };

  /**
   * 「不想回复」某条问询（页内横幅用）：乐观地把横幅撤掉，再让服务端置 declined。
   * 失败不重挂横幅 —— 用户的意图已经表达清楚，不该因为网络问题再追着问一次。
   */
  const declineCheckin = (item: DailyCheckinItem) => {
    void api.declineCheckin(item.id, userId).catch(() => {
      /* 静默：拒绝是"减负"操作，失败不打扰用户 */
    });
  };

  /* ── 对话流卡片上的三个动作（与原来的弹窗一一对应） ─────────────────── */

  const replyFlowCheckin = () => {
    const target = flowCheckin?.item;
    setFlowCheckin(null);
    if (target) startAnswer(target);
  };

  /** 收起本次提醒，下一次需满足服务端的间隔和次数限制。 */
  const laterFlowCheckin = () => {
    setFlowCheckin(null);
  };

  /** 不想回复：服务端置 declined，本机标记今天不再打扰 */
  const declineFlowCheckin = () => {
    const target = flowCheckin?.item;
    if (target) declineCheckin(target);
    markCheckinDeclined(userId);
    setFlowCheckin(null);
  };

  /**
   * 清空本机聊天记录：删掉 `psych_chat:v1:<user>` 这个键，消息回到初始欢迎语。
   *
   * 边界说明（弹窗里也照实写）：只清**对话原文**，不动知识图谱三元组
   * （psych_kg:v1:*）与量表记录 —— 图谱是你长期积累的画像，不该因为
   * "清个聊天框"就一起没了。要清图谱请到「我的知识图谱」页。
   */
  const doClear = async () => {
    if (workspaceOwner.current !== getCurrentSession()?.username) return;
    if (!temporary && session?.role === 'user') {
      try { await stewardApi.clearHistory(); }
      catch { setError('服务端聊天记录暂未清空，请稍后重试。'); return; }
    }
    generationVersion.current += 1;
    if (!temporary) clearChatHistory(userId);
    setConfirmClear(false);
    setError('');
    setMessages([welcomeMessage()]);
  };

  const send = async (suggestion?: string, checkin?: DailyCheckinItem) => {
    const text = (suggestion ?? input).trim();
    if (!text || busy || recovering || workspaceOwner.current !== getCurrentSession()?.username) return;
    generationVersion.current += 1;
    if (!suggestion) setInput('');
    setError('');
    setCheckinError('');
    setBusy(true);

    /* 一条消息一个时间戳：用户消息与它的回复同刻创建，共用同一个 at，
       这样"你问 → 我答"会被划在同一段时间节点里，而不是被分隔线切开。 */
    const at = new Date().toISOString();
    const userMsg: ChatMessage = { id: Date.now(), role: 'user', text, at };
    /* 历史取"当前列表"的最近 6 轮（此时还没把本轮 user 消息放进去），
       供后端 LLM 保持上下文；离线兜底消息不进历史，避免污染语境。 */
    const history: ChatTurn[] = messages
      .filter((m) => !m.offline)
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text }));

    /* 若本条是每日问询的答复：只向后端提交"已回复"状态流转。
       三元组抽取不在这里做——回复内容会照常走下面的 /kg/extract，
       统一一条入图路径，避免同一条文本被抽取两次、图谱 cnt 翻倍。 */
    if (checkin ?? answering) {
      const target = (checkin ?? answering)!;
      if (target.id > 0) {
        try {
          await api.replyCheckin(target.id, userId, text);
        } catch (e) {
          setCheckinError(`问询回复未保存，请重试：${briefErrorMessage(e, '请求失败')}`);
          if (!suggestion) setInput(text);
          setBusy(false);
          return;
        }
      }
      markCheckinReplied(userId);
      setAnswering(null);
      setFlowCheckin(null);
    }

    if (workspaceOwner.current !== getCurrentSession()?.username) { setBusy(false); return; }

    /* 先把 user 消息插进去，再插一条**空的** assistant 消息占位。
       大模型改成流式返回后，增量文本会逐段追加到这条占位上 —— 用户几秒内
       就能看到开头，不必干等整段生成完（2026-10-15）。 */
    const replyId = Date.now() + 1;
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: replyId, role: 'assistant', text: '', at },
    ]);

    if (session?.role === 'user') void stewardApi.safety(text).then(result => {
      setMessages(prev => prev.map(m => m.id === replyId ? { ...m,crisisHits:result.crisis_hits } : m));
    }).catch(() => { /* Safety scanning does not gate or store temporary chat. */ });

    // Memory extraction now belongs to the consent-aware durable worker.
    // Temporary messages never enter the legacy graph or local memory store.

    let acc = '';
    let offline = false;
    let replyMock = true;
    let streamBroken = false;
    try {
      const stream = session?.role === 'user' && !temporary
        ? streamSteward(`message_${userMsg.id}`, text, history)
        : api.streamChatCompanion(userId, text, history, undefined, temporary);
      for await (const chunk of stream) {
        if ('run_id' in chunk && chunk.run_id) setMessages(prev => prev.map(m => m.id === replyId ? { ...m,runId:chunk.run_id as string,generationStatus:'running' } : m));
        if (chunk?.error) {
          // 上游流中断：不再把半截话当完整回复，转非流式重新生成
          streamBroken = true;
          break;
        }
        const delta = chunk?.delta;
        if (!delta) continue;
        acc += delta;
        const text = acc.trimStart();
        setMessages((prev) =>
          prev.map((m) => (m.id === replyId ? { ...m, text } : m)),
        );
      }
    } catch {
      streamBroken = true;
    }

    if (streamBroken && !offline && session?.role !== 'user') {
      /* 流式中断：自动改走非流式接口重新生成一份完整回复替换半截文本 */
      try {
        const full = await api.chatCompanion(userId, text, history);
        if (full.reply) {
          acc = full.reply;
          replyMock = Boolean(full.mock);
          setMessages((prev) =>
            prev.map((m) => (m.id === replyId ? { ...m, text: acc, replyMock } : m)),
          );
        } else {
          replyMock = true;
        }
      } catch {
        replyMock = true;
      }
    }

    if (!acc.trim()) {
      /* 大模型完全不可用（Mock / 断流且重试失败）→ 本地兜底文案 */
      const fallback = FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];
      acc = `${fallback}\n（离线模式：本条由本机规则整理，暂未连到服务端）`;
      offline = true;
      replyMock = true;
      setError(briefErrorMessage('未连接到服务端', '未连接到服务端'));
      setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, text: acc } : m)));
    }

    if (streamBroken && acc.trim() && !offline) {
      setError('本条回复未完整生成，已保留进度。刷新后可查看后台状态，或重试本条消息。');
    }
    setMessages(prev => prev.map(m => m.id === replyId ? { ...m,generationStatus:streamBroken ? 'failed' : 'done' } : m));

    setBusy(false);
  };

  const retryReply = async (message: ChatMessage) => {
    if (!message.runId || busy) return;
    setBusy(true); setError('');
    try {
      await stewardApi.retry(message.runId);
      while (true) {
        const run = await stewardApi.run(message.runId);
        setMessages(prev => prev.map(m => m.id === message.id ? { ...m,text:run.reply || '正在重新生成…',generationStatus:run.status } : m));
        if (run.status === 'failed') throw new Error(run.error);
        if (run.status === 'done') break;
        await new Promise(resolve => setTimeout(resolve,250));
      }
    } catch { setError('本条回复暂未生成成功，进度已保留，可稍后重试。'); }
    finally { setBusy(false); }
  };

  if (workspaceOwner.current !== userId) return <div className="p-4 text-sm text-slate-500">正在切换账号…</div>;

  return (
    /* chat-fullheight：配合 index.css 的 :has 规则把高度链打通到视口，
       消息少时输入框也贴在底部（主流对话软件的布局） */
    <div ref={panelRef} className="chat-fullheight relative flex flex-col flex-1 min-h-0 w-full max-w-3xl mx-auto">
      {/* 头部：不再放静态小头像 —— 机器人已经"活"在页面里走动（见文件末尾的
          RoamingBot），页头再钉一个不动的头像是同一形象出现两次，反而乱。 */}
      <div className="ui-card p-4 shrink-0">
        {session?.role === 'user' && <label className="mb-3 flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={temporary} disabled={busy || recovering} onChange={e => { generationVersion.current += 1; if (e.target.checked) { savedRegular.current=messages; setMessages([welcomeMessage()]); } else { setMessages(savedRegular.current.length ? savedRegular.current : [welcomeMessage()]); } setTemporary(e.target.checked); }} />临时对话：不保存本次消息，不形成长期记忆</label>}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary-600 shrink-0" /> AI 心理陪伴对话
            </h2>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              说出来，我陪您一起理一理 —— 它会在页面里陪着您走动
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canClear && (
              <button
                onClick={() => setConfirmClear(true)}
                title="清空聊天记录"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-medium hover:bg-slate-200 whitespace-nowrap cursor-pointer"
              >
                <Trash2 className="w-4 h-4 shrink-0" /> 清空记录
              </button>
            )}
            <DailyCheckinButton
              userId={userId}
              onMessage={(payload) => setFlowCheckin(payload)}
            />
            {session?.role === 'user' ? <button className="rounded-xl bg-primary-50 px-3 py-2 text-sm text-primary-600" onClick={() => navigate('/personal/me/kg')}>我的心理档案</button> : <RunInferenceButton userId={userId} />}
          </div>
        </div>

        {/* 状态徽标行：说明数据存在哪，避免被当成已写入图数据库 */}
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-500">
          <span>{temporary ? '临时内容不保存、不写入记忆' : stewardState?.settings.chat && stewardState.settings.enabled ? '已允许聊天参与个人记忆' : '聊天不参与长期记忆，可在心理档案中开启'}</span>
          {/* 聊天原文同样只存本机：说清它不会跑到服务端，也不跨设备 */}
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
            <HardDrive className="w-3 h-3" /> {temporary ? '本次仅保留在页面' : '聊天与生成进度存服务端'}
          </span>
          {/* L1：抽取结果存在本机，说清存在哪 */}
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
            <HardDrive className="w-3 h-3" /> 本机已记录 {localCount} 条
          </span>
          {mockServer && (
            <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] text-primary-600">
              演示模式抽取
            </span>
          )}
        </p>
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-warning-500" />
          <span>{error}</span>
        </div>
      )}
      {checkinError && <p role="alert" className="mt-3 text-sm text-amber-700">{checkinError}</p>}

      {answering && (
        <div className="mt-3 flex items-center gap-2 text-sm text-primary-700 bg-primary-50 border border-primary-100 rounded-lg px-3 py-2">
          <BellRing className="w-4 h-4 shrink-0" />
          <span className="flex-1">正在回复这条问询（{answering.checkin_date}）：发送后保存为答复，仅在您允许时用于个人记忆。</span>
          <button onClick={cancelAnswer} className="text-primary-600 hover:text-primary-800 text-xs cursor-pointer">
            取消
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto mt-4 space-y-4 pr-1 app-scrollbar">
        {rows.map(({ message: m, divider, title }) => (
          <div key={m.id}>
            {/* 时间节点：跨天 / 间隔较久 / 首条时插一条居中分隔线。
                「没有时间信息的旧消息」不显示 —— 不猜时间（见 chatTime.ts） */}
            {divider && (
              <div className="flex items-center gap-3 py-1">
                <span className="h-px flex-1 bg-slate-200" />
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-500">
                  {divider}
                </span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>
            )}
            <div className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                /* title：鼠标悬停看这条消息的完整时间（精确到分）。分隔线只给
                   "大致在什么时候"，具体时刻放这里，不占版面。 */
                title={title ?? undefined}
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-primary-500 text-white rounded-br-sm'
                    : 'ui-card text-slate-700 rounded-bl-sm'
                }`}
              >
                {/* 流式占位：回复气泡还没拿到第一个字时，就地显示思考动画；
                    有内容后同一气泡直接显示文本，不再有第二个"正在思考中" */}
                {m.text ? (
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                ) : (
                  <span className="inline-flex items-center gap-2 text-slate-500">
                    正在思考中
                    <span className="inline-flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
                    </span>
                  </span>
                )}
                {m.runId && m.generationStatus === 'failed' && <button className="mt-2 block text-xs text-primary-600" disabled={busy} onClick={() => void retryReply(m)}>重新生成此回复</button>}
                {m.offline && (
                  <span className="mt-2 inline-block rounded-full bg-warning-50 px-2 py-0.5 text-[11px] text-warning-600">
                    离线模式
                  </span>
                )}
                {m.replyMock && !m.offline && (
                  <span className="mt-2 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                    本机文案 · 未走大模型
                  </span>
                )}
                {((m.crisisHits?.length ?? 0) > 0 || (m.extract?.crisis_hits?.length ?? 0) > 0) && (
                  /* 安全提示放在抽取结果之前：它是这条消息里优先级最高的信息，
                     不该排在"已抽取 N 条"下面。后端在原文上直检得到（不经语义归一），
                     所以不会因为抽取器把"活着没意思"归成"无意义感"而漏掉。 */
                  <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                    <p className="text-xs font-medium text-red-700">
                      您刚才的话让我很在意，谢谢您愿意说出来
                    </p>
                    <p className="mt-1 text-xs leading-5 text-red-700/90 break-words">
                      如果此刻很难受，请立即联系您信任的人，或拨打全国心理援助热线
                      <span className="font-medium"> 12356</span>（24 小时）；学校心理咨询中心也可以随时去找。
                      您不需要一个人扛着。
                    </p>
                  </div>
                )}
                {m.extract && m.extract.triples.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-100 space-y-1">
                    <p className="text-xs font-medium text-slate-400">
                      已抽取 {m.extract.triples.length} 条并存入本机记录：
                    </p>
                    {m.extract.triples.slice(0, 4).map((t, i) => (
                      <p key={i} className="text-xs text-primary-600 font-mono">
                        ({t.relation}) {t.object}
                        {t.category ? ` · ${t.category}` : ''}
                      </p>
                    ))}
                    <p className="text-xs text-slate-400">
                      {m.extract.neo4j_connected
                        ? '已同时写入服务端知识图谱。'
                        : '服务端知识图谱未连接，本次只存在本机（刷新或重开浏览器仍在）。'}
                      {m.extract.mock ? ' 抽取走演示引擎（内置关键词），非大模型输出。' : ''}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* 今日关怀问询：作为对话流里的一条 assistant 卡片，不再用居中弹窗。
            三个动作与原来的弹窗一致：回复（原地进入回答态）/ 稍后回复 / 不想回复。 */}
        {flowCheckin && (
          <div className="flex justify-start">
            <div className="w-full max-w-[80%] rounded-2xl rounded-bl-sm border border-primary-100 bg-white px-4 py-3 text-sm leading-relaxed text-slate-700 shadow-sm">
              <p className="flex items-center gap-1.5 text-xs font-medium text-primary-600">
                <MessageCircleHeart className="h-3.5 w-3.5" /> 今日关怀问询
                <span className="font-normal text-slate-400">· {flowCheckin.item.checkin_date}</span>
              </p>
              <p className="mt-2 whitespace-pre-wrap break-words">{flowCheckin.message}</p>
              {flowCheckin.note && (
                <p className="mt-2 text-[11px] leading-5 text-slate-400">{flowCheckin.note}</p>
              )}
              {flowCheckin.err && (
                <p className="mt-1 text-[11px] leading-5 text-slate-400">
                  服务端问询暂时取不到（{flowCheckin.err}），已改用本机问询。
                </p>
              )}
              <p className="mt-3 text-xs text-slate-400">
                {flowCheckin.item.suggestions_source === 'ai' ? 'AI 推荐回复 · 选择符合您实际情况的一项' : '备用快捷回复（AI 推荐暂不可用）'}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(flowCheckin.item.suggested_replies ?? []).map((reply) => (
                  <button key={reply} disabled={busy} onClick={() => void send(reply, flowCheckin.item)}
                    className="cursor-pointer rounded-xl border border-primary-200 bg-primary-50 px-3 py-2 text-left text-sm text-primary-700 hover:bg-primary-100 disabled:opacity-50">
                    {reply}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={replyFlowCheckin}
                  className="cursor-pointer rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-600"
                >
                  自己写一句
                </button>
                <button
                  onClick={laterFlowCheckin}
                  className="cursor-pointer rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-50"
                >
                  稍后回复
                </button>
                <button
                  onClick={declineFlowCheckin}
                  className="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600"
                >
                  不想回复
                </button>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div ref={composerRef} className="mt-4 flex gap-2 shrink-0 pt-1">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="聊聊您的状态、兴趣或烦恼…（Enter 发送，Shift+Enter 换行）"
          rows={2}
          className="flex-1 resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-300"
        />
        <button
          onClick={() => void send()}
          disabled={busy}
          className="self-end inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 disabled:opacity-50 cursor-pointer"
        >
          {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          发送
        </button>
      </div>

      {/* 会走动的机器人：在整个页面内容区里游走，会从对话面板**下层**走过
          （图层压在面板之下，z-index:-1 —— 面板不透明的部分自然盖住它，
          气泡之间的透明空隙里能看到它在走）。用户一输入，它就走到输入框
          那一行的外侧探身往里看。
          这里没有"绕开面板"的逻辑：用户明确要求"直接在对话框下层走过即可"，
          所以它走的是直线，从背后穿过 —— 读起来是"从下面经过"，不是闪现。 */}
      {pageActive && <RoamingBot
        panelRef={panelRef}
        composerRef={composerRef}
        peeking={peeking}
        busy={busy}
      />}

      {/* 每日最多三轮提醒；卡片可见或正在手动回复时暂停领取下一轮。 */}
      <DailyCheckinDialog
        active={Boolean(flowCheckin) || Boolean(answering)}
        onEnsure={(item) => {
          if (item.status !== 'pending') return;
          setFlowCheckin({
            item,
            message: item.message,
            note: '每天最多提醒三次，回复后今天不再出现；仅在您允许时用于个人记忆',
          });
        }}
      />

      {/* 清空确认：心理对话属敏感内容，给用户自主删除入口，但删除前必须确认；
          并明确写出"只清对话、不动图谱"，避免用户以为图谱会一起消失 */}
      {confirmClear && (
        <div
          className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
          onClick={() => setConfirmClear(false)}
        >
          <div
            className="ui-card max-w-md w-full p-6 shadow-[0_24px_70px_-36px_rgba(16,24,40,0.45)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-danger-500" /> 清空聊天记录？
            </h3>
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">
              将删除服务端和本机保存的聊天记录，删除后无法恢复。临时对话只清除当前页面内容。
            </p>
            <p className="mt-2 text-xs text-slate-400 leading-relaxed">
              只清对话原文 —— 已抽取的知识图谱条目（本机已记录 {localCount} 条）与量表记录
              <span className="text-slate-500 font-medium">不受影响</span>。
              若要让管家忘记相关内容，请到「我的心理档案」中删除记忆或排除来源。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmClear(false)}
                className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-medium hover:bg-slate-200 cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={doClear}
                className="px-4 py-2 rounded-lg bg-danger-500 text-white text-sm font-medium hover:bg-danger-600 cursor-pointer"
              >
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DailyCheckinButton({
  userId,
  onMessage,
}: {
  userId: string;
  /** 把问询交给聊天页，渲染成对话流卡片（不再在按钮里弹窗） */
  onMessage: (payload: {
    item: DailyCheckinItem;
    message: string;
    note?: string;
    err?: string;
  }) => void;
}) {
  const [loading, setLoading] = useState(false);

  const fetchCheckin = async () => {
    setLoading(true);
    try {
      const r = await api.presentDailyCheckin(userId);
      if (!r.checkin) return;
      onMessage({
        item: r.checkin, message: r.checkin.message,
        note: '每天最多提醒三次，回复后今天不再出现',
      });
    } catch {
      // 无法核对服务端预算时不生成额外的本机问询。
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={fetchCheckin}
      disabled={loading}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-50 text-primary-600 text-sm font-medium hover:bg-primary-100 disabled:opacity-50 whitespace-nowrap cursor-pointer"
    >
      <MessageCircleHeart className={`w-4 h-4 shrink-0 ${loading ? 'animate-pulse' : ''}`} /> 今日问询
    </button>
  );
}

function RunInferenceButton({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<InferenceRunResult | null>(null);
  /** 报告来源：服务端（含演示 mock）/ 本机组装 */
  const [source, setSource] = useState<'server' | 'local'>('server');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const run = async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.runInference(userId);
      setResult(r);
      setSource('server');
    } catch (e) {
      /* 服务端推理拿不到就用地本机数据组装一份（结构相同），并在标题上标注来源 */
      setErr(briefErrorMessage(e, '未连接到服务端'));
      const signals = await collectLocalSignals(userId);
      setResult(buildLocalReport(userId, signals) as unknown as InferenceRunResult);
      setSource('local');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-50 text-primary-600 text-sm font-medium hover:bg-primary-100 whitespace-nowrap cursor-pointer"
      >
        <RefreshCw className="w-4 h-4 shrink-0" /> 生成心理状况报告
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
          <div
            className="ui-card max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6 shadow-[0_24px_70px_-36px_rgba(16,24,40,0.45)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-800">
                心理状况推理报告
                {result && (
                  <span className="ml-2 align-middle rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-normal text-slate-500">
                    {source === 'local'
                      ? '本机组装'
                      : result.report.mock
                        ? '演示模式 · 模板生成'
                        : '服务端推理'}
                  </span>
                )}
              </h3>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">✕</button>
            </div>

            {!result && !loading && (
              <div className="text-center py-8">
                <p className="text-sm text-slate-500 mb-4">
                  将基于个人知识图谱和领域知识图谱整理参考线索与建议；正式筛查结论以量表及后端评估为准。
                </p>
                {err && <p className="text-sm text-slate-500 mb-3">服务端推理不可用（{err}），会用本机记录组装一份报告。</p>}
                <button
                  onClick={run}
                  className="px-6 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 cursor-pointer"
                >
                  开始推理
                </button>
              </div>
            )}

            {loading && <p className="text-center text-sm text-slate-500 py-8">推理中，请稍候…</p>}

            {result && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <span
                    className={`px-3 py-1.5 rounded-lg text-sm font-bold ${
                      result.report.reference_only || result.report.risk_level === 'unknown' || source === 'local'
                        ? 'bg-slate-100 text-slate-700'
                        : result.report.risk_level === 'red'
                        ? 'bg-danger-50 text-danger-600'
                        : result.report.risk_level === 'orange'
                        ? 'bg-orange-50 text-orange-600'
                        : result.report.risk_level === 'yellow'
                        ? 'bg-warning-50 text-warning-600'
                        : 'bg-success-50 text-success-600'
                    }`}
                  >
                    {source === 'local' ? '本机记录参考，待标准筛查' : result.report.risk_level === 'unknown' || result.report.reference_only ? '图谱参考，待标准筛查' : result.report.risk_label}
                  </span>
                  <span className="text-sm text-slate-500">参考线索不直接决定本人风险</span>
                  {result.report.alert_created && (
                    <span className="text-xs text-orange-600 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> 已生成预警
                    </span>
                  )}
                  {source === 'local' && (
                    <span className="text-xs text-slate-500">数据来自本机记录，未经过服务端推理</span>
                  )}
                </div>

                {result.report.crisis && (
                  /* 安全提示置于报告最顶部：它是整份报告里最需要被立刻看到的信息。
                     两种情形措辞必须区分（后端 crisis_verified 给出）——
                     本人近期直接表达过 → 给即时求助指引；
                     仅图谱历史线索 → 提示待核实，不渲染成当前已确认危机。 */
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                    {result.report.crisis_verified ? (
                      <>
                        <p className="text-sm font-medium text-red-700 break-words">
                          检测到近期表达过的安全线索，请优先照顾自己
                        </p>
                        <p className="mt-1 text-xs leading-5 text-red-700/90 break-words">
                          建议立即联系信任的人、学校心理咨询中心，或拨打全国心理援助热线
                          <span className="font-medium"> 12356</span>（24 小时）。
                          本报告仅供参考，不替代专业评估。
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-red-700 break-words">
                          图谱中留有历史安全线索，需核实
                        </p>
                        <p className="mt-1 text-xs leading-5 text-red-700/90 break-words">
                          这是以往记录中的内容，不代表当前状态。如您近期确有类似感受，
                          请联系学校心理咨询中心或拨打 12356。
                        </p>
                      </>
                    )}
                  </div>
                )}

                {result.report.summary && (
                  <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
                    {result.report.summary}
                  </div>
                )}

                {result.report.factors.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-slate-700 mb-2">待核实的参考因素</p>
                    <ul className="space-y-1">
                      {result.report.factors.map((f, i) => (
                        <li key={i} className="text-sm text-slate-600 flex gap-2">
                          <span className="text-primary-500">•</span> {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.content_feed.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-slate-700 mb-2">为您推荐的缓解内容</p>
                    <div className="space-y-2">
                      {result.content_feed.map((f, i) => (
                        <div key={i} className="ui-card p-3">
                          <p className="text-sm font-medium text-slate-800">{f.name}</p>
                          {/* 与「个性化推送」同一份数据，同样可能带无空格的长搜索链接，
                              故一并加 break-words（详见 FeedPage 中的说明） */}
                          {f.suggestion && (
                            <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap break-words">{f.suggestion}</p>
                          )}
                          <p className="text-xs text-primary-600 mt-1 break-words">{f.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-xs text-slate-400 border-t border-slate-100 pt-3">{result.report.disclaimer}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
