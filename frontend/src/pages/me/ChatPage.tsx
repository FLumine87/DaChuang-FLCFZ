import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Send, Sparkles, RefreshCw, AlertTriangle, MessageCircleHeart, HardDrive, BellRing, Trash2 } from 'lucide-react';
import { api, type ChatTurn, type InferenceRunResult, type CheckinMessage, type DailyCheckinItem } from '../../services/api';
import { getCurrentSession } from '../../auth/session';
import { briefErrorMessage } from '../../services/http';
import {
  appendLocalTriples,
  buildLocalCheckin,
  buildLocalReport,
  collectLocalSignals,
  readLocalKg,
  triplesFromText,
} from '../../services/localKg';
import {
  clearChatHistory,
  readChatHistory,
  saveChatHistory,
  type StoredChatMessage,
} from '../../services/chatHistory';
import { withTimeDividers } from '../../services/chatTime';
import DailyCheckinDialog from '../../components/DailyCheckinDialog';
import RoamingBot from '../../components/RoamingBot';

/** 消息结构与本机存储层一致（StoredChatMessage），避免两边各定义一份走样 */
type ChatMessage = StoredChatMessage;

const WELCOME = '你好，我是你的 AI 心理陪伴助手。和我聊聊最近的状态、喜欢的事或烦恼吧——我会把关键信息整理进你的个人知识图谱，并在需要时为你生成状态报告。';

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
  '谢谢你愿意分享这些。我在认真听，也想多了解一点——能具体说说这件事带给你的感受吗？',
  '我能感受到这句话背后的分量。这样的时刻确实不容易，你已经在尽力面对了。',
  '收到。我把你提到的内容记下来了。如果愿意，可以再多聊一点，比如它对你的睡眠或心情有什么影响？',
  '我在。你说的这些对我很重要，我会一直在这里陪着你梳理。',
];

export default function ChatPage() {
  const session = getCurrentSession();
  const userId = session?.username ?? 'demo_user';
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
  /** 清空确认弹窗 */
  const [confirmClear, setConfirmClear] = useState(false);
  /** 是否还有历史可清（只有欢迎语时不必给清空入口） */
  const canClear = messages.some((m) => m.role === 'user');
  /** 本机（localStorage）已记录的三元组条数：L1 方案下这是"越聊越有"的唯一凭据 */
  const [localCount, setLocalCount] = useState(() => readLocalKg(userId).triples.length);
  /** 服务端是否处于演示（mock）模式：右上角如实标注，不把演示抽取说成真实抽取 */
  const [mockServer, setMockServer] = useState<boolean | null>(null);
  /** 登录触发落库的「待回复」每日问询：此前只写日志，用户端拿不到，这里是闭环入口 */
  const [pending, setPending] = useState<DailyCheckinItem[]>([]);
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
    saveChatHistory(userId, messages);
  }, [userId, messages]);

  /** 正在回复的每日问询：用户点"回复"或从弹窗跳来后置位，下一条发出的消息即作为它的答复 */
  const [answering, setAnswering] = useState<DailyCheckinItem | null>(null);

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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]); // busy 也要滚：思考占位出现时把气泡滚进视口

  /* 拉取待回复的问询：进对话页时由 DailyCheckinDialog 触发 ensure 落库，
     这里取出来提示用户（弹窗关了以后仍能在页内横幅看到）。
     失败不影响正常聊天（问询是可选增强），静默跳过即可。 */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await api.getPendingCheckins(userId);
        if (!alive) return;
        const skipId = incomingRef.current?.id;
        setPending(r.pending.filter((p) => p.id !== skipId));
      } catch {
        /* 忽略：问询拉取失败不阻断对话 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  /** 开始回复某条每日问询：把它作为助手消息补进对话，并标记为当前待答复对象 */
  const startAnswer = (item: DailyCheckinItem) => {
    setPending((prev) => prev.filter((p) => p.id !== item.id));
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

  /** 取消回复：恢复成待回复状态，避免误点后卡在"正在回复" */
  const cancelAnswer = () => {
    if (answering) setPending((prev) => [answering, ...prev]);
    setAnswering(null);
  };

  /**
   * 「不想回复」某条问询（页内横幅用）：乐观地把横幅撤掉，再让服务端置 declined。
   * 失败不重挂横幅 —— 用户的意图已经表达清楚，不该因为网络问题再追着问一次。
   */
  const declineCheckin = (item: DailyCheckinItem) => {
    setPending((prev) => prev.filter((p) => p.id !== item.id));
    void api.declineCheckin(item.id, userId).catch(() => {
      /* 静默：拒绝是"减负"操作，失败不打扰用户 */
    });
  };

  /**
   * 清空本机聊天记录：删掉 `psych_chat:v1:<user>` 这个键，消息回到初始欢迎语。
   *
   * 边界说明（弹窗里也照实写）：只清**对话原文**，不动知识图谱三元组
   * （psych_kg:v1:*）与量表记录 —— 图谱是你长期积累的画像，不该因为
   * "清个聊天框"就一起没了。要清图谱请到「我的知识图谱」页。
   */
  const doClear = () => {
    clearChatHistory(userId);
    setConfirmClear(false);
    setError('');
    setMessages([welcomeMessage()]);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setError('');
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
    if (answering) {
      const target = answering;
      setAnswering(null);
      void api.replyCheckin(target.id, userId, text).catch(() => {
        /* 状态标记失败不阻断对话：内容仍会走 /kg/extract 进图谱 */
      });
    }

    /* 先把 user 消息插进去，再插一条**空的** assistant 消息占位。
       大模型改成流式返回后，增量文本会逐段追加到这条占位上 —— 用户几秒内
       就能看到开头，不必干等整段生成完（2026-10-15）。 */
    const replyId = Date.now() + 1;
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: replyId, role: 'assistant', text: '', at },
    ]);

    /* 抽取独立跑，不参与回复的等待：三元组进图谱属于后台增强，
       不该让用户为此多等一轮大模型的时间。 */
    void (async () => {
      try {
        const data = await api.extract(userId, text);
        if (data.triples?.length) {
          setLocalCount(appendLocalTriples(userId, data.triples).triples.length);
        }
        setMockServer(Boolean(data.mock));
        // 抽取结果补到这条回复上（界面显示"已抽取 N 条..."），
        // 因为抽取是后台跑的，到达时间通常晚于回复文本
        setMessages((prev) =>
          prev.map((m) => (m.id === replyId ? { ...m, extract: data } : m)),
        );
      } catch {
        const triples = triplesFromText(text);
        if (triples.length) setLocalCount(appendLocalTriples(userId, triples).triples.length);
      }
    })();

    let acc = '';
    let offline = false;
    let replyMock = true;
    let streamBroken = false;
    try {
      for await (const chunk of api.streamChatCompanion(userId, text, history)) {
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

    if (streamBroken && !offline) {
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

    setBusy(false);
  };

  return (
    /* chat-fullheight：配合 index.css 的 :has 规则把高度链打通到视口，
       消息少时输入框也贴在底部（主流对话软件的布局） */
    <div ref={panelRef} className="chat-fullheight relative flex flex-col flex-1 min-h-0 w-full max-w-3xl mx-auto">
      {/* 头部：不再放静态小头像 —— 机器人已经"活"在页面里走动（见文件末尾的
          RoamingBot），页头再钉一个不动的头像是同一形象出现两次，反而乱。 */}
      <div className="ui-card p-4 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary-600 shrink-0" /> AI 心理陪伴对话
            </h2>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              说出来，我陪你一起理一理 —— 它会在页面里陪着你走动
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canClear && (
              <button
                onClick={() => setConfirmClear(true)}
                title="清空本机聊天记录"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-medium hover:bg-slate-200 whitespace-nowrap cursor-pointer"
              >
                <Trash2 className="w-4 h-4 shrink-0" /> 清空记录
              </button>
            )}
            <DailyCheckinButton userId={userId} />
            <RunInferenceButton userId={userId} />
          </div>
        </div>

        {/* 状态徽标行：说明数据存在哪，避免被当成已写入图数据库 */}
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-500">
          <span>你的话语会被抽取成知识图谱三元组 · 当前用户 <span className="font-mono">{userId}</span></span>
          {/* 聊天原文同样只存本机：说清它不会跑到服务端，也不跨设备 */}
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
            <HardDrive className="w-3 h-3" /> 聊天记录存本机
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
          <span>未连接到服务端（{error}），已切到离线模式：回应由本机规则生成，抽取结果只存在本机。</span>
        </div>
      )}

      {/* 待回复问询：进对话页时由弹窗触发生成；弹窗关了以后仍能在这里看到并回复 */}
      {pending.length > 0 && (
        <div className="mt-3 rounded-xl border border-primary-100 bg-primary-50/60 px-4 py-3 space-y-2">
          <p className="text-xs font-medium text-primary-700 flex items-center gap-1.5">
            <BellRing className="w-3.5 h-3.5" /> 有 {pending.length} 条来自助手的关怀问询待回复
          </p>
          {pending.map((item) => (
            <div key={item.id} className="flex items-start gap-3 bg-white rounded-lg px-3 py-2">
              <p className="flex-1 text-sm text-slate-700 leading-relaxed">{item.message}</p>
              <div className="flex shrink-0 items-center gap-1.5 self-center">
                <button
                  onClick={() => startAnswer(item)}
                  className="px-3 py-1.5 rounded-lg bg-primary-500 text-white text-xs font-medium hover:bg-primary-600 cursor-pointer"
                >
                  回复
                </button>
                <button
                  onClick={() => declineCheckin(item)}
                  className="px-2.5 py-1.5 rounded-lg text-slate-400 text-xs hover:bg-slate-50 hover:text-slate-600 cursor-pointer"
                >
                  不想回复
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {answering && (
        <div className="mt-3 flex items-center gap-2 text-sm text-primary-700 bg-primary-50 border border-primary-100 rounded-lg px-3 py-2">
          <BellRing className="w-4 h-4 shrink-0" />
          <span className="flex-1">正在回复这条问询（{answering.checkin_date}）：发送的消息会作为答复并整理进你的图谱。</span>
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
                {m.extract?.crisis_hits && m.extract.crisis_hits.length > 0 && (
                  /* 安全提示放在抽取结果之前：它是这条消息里优先级最高的信息，
                     不该排在"已抽取 N 条"下面。后端在原文上直检得到（不经语义归一），
                     所以不会因为抽取器把"活着没意思"归成"无意义感"而漏掉。 */
                  <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                    <p className="text-xs font-medium text-red-700">
                      你刚才的话让我很在意，谢谢你愿意说出来
                    </p>
                    <p className="mt-1 text-xs leading-5 text-red-700/90 break-words">
                      如果此刻很难受，请立即联系你信任的人，或拨打全国心理援助热线
                      <span className="font-medium"> 12356</span>（24 小时）；学校心理咨询中心也可以随时去找。
                      你不需要一个人扛着。
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
          placeholder="聊聊你的状态、兴趣或烦恼…（Enter 发送，Shift+Enter 换行）"
          rows={2}
          className="flex-1 resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-300"
        />
        <button
          onClick={send}
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
      <RoamingBot
        panelRef={panelRef}
        composerRef={composerRef}
        peeking={peeking}
        busy={busy}
      />

      {/* 今日问询：进入本页当天首次自动弹出（不需要用户先点「回复」）。
          三个选项：回复 / 稍后回复 / 不想回复。点「回复」原地进入回答态。
          onEnsure 把生成的这条同步进页内横幅：用户点「稍后回复」关掉弹窗后，
          横幅里还留着它，随时可以回来回复。 */}
      <DailyCheckinDialog
        onReply={startAnswer}
        onEnsure={(item) => {
          if (item.status !== 'pending') return;
          setPending((prev) => (prev.some((p) => p.id === item.id) ? prev : [item, ...prev]));
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
              <Trash2 className="w-4 h-4 text-danger-500" /> 清空本机聊天记录？
            </h3>
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">
              将删除本机保存的这段对话记录，删除后无法恢复，页面只保留开头的欢迎语。
            </p>
            <p className="mt-2 text-xs text-slate-400 leading-relaxed">
              只清对话原文 —— 已抽取的知识图谱条目（本机已记录 {localCount} 条）与量表记录
              <span className="text-slate-500 font-medium">不受影响</span>。
              若也要清空图谱，请到「我的知识图谱」页操作。
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

function DailyCheckinButton({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<CheckinMessage | null>(null);
  /** 本地兜底问询（服务端拿不到时）：文案取自后端同一套问询模板，见 localKg.buildLocalCheckin */
  const [local, setLocal] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [show, setShow] = useState(false);

  const fetchCheckin = async () => {
    setLoading(true);
    setErr('');
    setLocal(null);
    try {
      /* 走 ensure（幂等）而不是 getDailyCheckin（每次重新生成）：
         拿到的就是「今天那一条」，与登录触发的弹窗是同一份内容。
         这样点按钮不会跑出第二条问询，也不会多消耗一次大模型调用。 */
      const r = await api.ensureDailyCheckin(userId);
      if (r.checkin) {
        setMsg({ user_id: userId, message: r.checkin.message, neo4j_connected: r.neo4j_connected });
      } else {
        setMsg({ user_id: userId, message: r.message, neo4j_connected: r.neo4j_connected });
      }
      setShow(true);
    } catch (e) {
      /* 服务端拿不到也照样给一句：用本机已有数据（兴趣/记录）挑一条问询，并注明来源 */
      setErr(briefErrorMessage(e, '未连接到服务端'));
      setMsg(null);
      const signals = await collectLocalSignals(userId);
      setLocal(buildLocalCheckin(signals));
      setShow(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={fetchCheckin}
        disabled={loading}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-50 text-primary-600 text-sm font-medium hover:bg-primary-100 disabled:opacity-50 whitespace-nowrap cursor-pointer"
      >
        <MessageCircleHeart className={`w-4 h-4 shrink-0 ${loading ? 'animate-pulse' : ''}`} /> 今日问询
      </button>

      {show && (msg || local) && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setShow(false)}>
          <div
            className="ui-card max-w-md w-full p-6 shadow-[0_24px_70px_-36px_rgba(16,24,40,0.45)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <MessageCircleHeart className="w-4 h-4 text-primary-600" /> 今日关怀问询
              </h3>
              <button onClick={() => setShow(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">✕</button>
            </div>
            <div className="bg-primary-50 rounded-xl p-4 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
              {msg ? msg.message : local}
            </div>
            <p className="text-xs text-slate-400 mt-3">
              {msg ? '每天只问一次；回复后内容会自动整理进你的个人图谱' : '本机问询（服务端未连接）：回复后内容会存进本机记录'}
            </p>
            {msg && !msg.neo4j_connected && (
              <p className="text-xs text-slate-400 mt-1">服务端知识图谱未连接：本次抽取结果会存在本机。</p>
            )}
            {err && <p className="text-xs text-slate-400 mt-2">服务端问询暂时取不到（{err}），已改用本机问询。</p>}
          </div>
        </div>
      )}
    </>
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
                          这是以往记录中的内容，不代表当前状态。如你近期确有类似感受，
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
                    <p className="text-sm font-semibold text-slate-700 mb-2">为你推荐的缓解内容</p>
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
