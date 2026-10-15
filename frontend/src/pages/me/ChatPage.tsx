import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, RefreshCw, AlertTriangle, MessageCircleHeart, HardDrive } from 'lucide-react';
import { api, type ChatTurn, type ExtractResult, type InferenceRunResult, type CheckinMessage } from '../../services/api';
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

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  extract?: ExtractResult;
  /** 这条回应是本机规则给的（后端不可达），界面上标注「离线模式」 */
  offline?: boolean;
  /** 对话服务端处于演示模式（未配 LLM 或 Mock），回复来自本机文案 */
  replyMock?: boolean;
}

const WELCOME = '你好，我是你的 AI 心理陪伴助手。和我聊聊最近的状态、喜欢的事或烦恼吧——我会把关键信息整理进你的个人知识图谱，并在需要时为你生成状态报告。';

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

  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 1, role: 'assistant', text: WELCOME },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** 本机（localStorage）已记录的三元组条数：L1 方案下这是"越聊越有"的唯一凭据 */
  const [localCount, setLocalCount] = useState(() => readLocalKg(userId).triples.length);
  /** 服务端是否处于演示（mock）模式：右上角如实标注，不把演示抽取说成真实抽取 */
  const [mockServer, setMockServer] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]); // busy 也要滚：思考占位出现时把气泡滚进视口

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setError('');
    setBusy(true);

    const userMsg: ChatMessage = { id: Date.now(), role: 'user', text };
    /* 历史取"当前列表"的最近 6 轮（此时还没把本轮 user 消息放进去），
       供后端 LLM 保持上下文；离线兜底消息不进历史，避免污染语境。 */
    const history: ChatTurn[] = messages
      .filter((m) => !m.offline)
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text }));

    /* 先把 user 消息插进去，再插一条**空的** assistant 消息占位。
       大模型改成流式返回后，增量文本会逐段追加到这条占位上 —— 用户几秒内
       就能看到开头，不必干等整段生成完（2026-10-15）。 */
    const replyId = Date.now() + 1;
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: replyId, role: 'assistant', text: '' },
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
    /* 服务端**答上话了**、但处于演示/mock 模式（未配大模型 Key 或显式开启）。
       必须与"压根连不上"分开：两者都会走到下面的本地兜底，但原因完全不同 ——
       前者是配置问题，后者才是网络问题。原先一律报"未连接到服务端"，
       实测服务端 /api/v1/health 明明是 {"status":"ok"}，提示却指向网络，很误导。 */
    let serverAnsweredMock = false;
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

    /* 这里原来是 `if (streamBroken && ...)` —— 只有**抛异常**才算"断流"。
       但服务端处于 mock 模式时，流式接口返回的是 JSON 而不是 SSE：
       解析器不会报错，只是**一个 chunk 都产不出来**，于是 streamBroken 仍是 false，
       整个非流式回退被跳过，serverAnsweredMock 也就没机会置上 ——
       最后落到兜底分支时只能一律报"未连接到服务端"，把"服务端在演示模式"
       误报成"网络连不上"。
       判据改成"断流 **或** 流没产出任何文本"，回退才真的会执行。 */
    if ((streamBroken || !acc.trim()) && !offline) {
      /* 流式中断：自动改走非流式接口重新生成一份完整回复替换半截文本 */
      try {
        const full = await api.chatCompanion(userId, text, history);
        if (full.mock) serverAnsweredMock = true;
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
      /* 走到这里有两种完全不同的原因，提示必须分开 —— 见上面 serverAnsweredMock 的说明 */
      const fallback = FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];
      if (serverAnsweredMock) {
        acc = `${fallback}\n（服务端处于演示模式：本条由本机规则整理，未调用大模型）`;
        setError('服务端在演示模式，未生成回复');
      } else {
        acc = `${fallback}\n（离线模式：本条由本机规则整理，暂未连到服务端）`;
        setError(briefErrorMessage('未连接到服务端', '未连接到服务端'));
      }
      offline = true;
      replyMock = true;
      setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, text: acc } : m)));
    }

    setBusy(false);
  };

  return (
    /* chat-fullheight：配合 index.css 的 :has 规则把高度链打通到视口，
       消息少时输入框也贴在底部（主流对话软件的布局） */
    <div className="chat-fullheight flex flex-col flex-1 min-h-0 w-full max-w-3xl mx-auto">
      <div className="ui-card p-4 flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary-600" /> AI 心理陪伴对话
          </h2>
          <p className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>你的话语会被抽取成知识图谱三元组 · 当前用户 <span className="font-mono">{userId}</span></span>
            {/* L1：抽取结果存在本机，说清存在哪，避免被当成已写入图数据库 */}
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
        <div className="flex items-center gap-2">
          <DailyCheckinButton userId={userId} />
          <RunInferenceButton userId={userId} />
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-warning-500" />
          <span>
            {error === '服务端在演示模式，未生成回复'
              ? '服务端处于演示模式（未配置大模型 Key），回应由本机规则生成，抽取结果只存在本机。'
              : <>未连接到服务端（{error}），已切到离线模式：回应由本机规则生成，抽取结果只存在本机。</>}
          </span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto mt-4 space-y-4 pr-1 app-scrollbar">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-primary-500 text-white rounded-br-sm'
                  : 'ui-card text-slate-700 rounded-bl-sm'
              }`}
            >
              {/* 流式占位：回复气泡还没拿到第一个字时，就地显示思考动画；
                  有内容后同一气泡直接显示文本，不再有第二个"正在思考中" */}
              {m.text ? (
                <p className="whitespace-pre-wrap">{m.text}</p>
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
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="mt-4 flex gap-2 shrink-0 pt-1">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
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
      const r = await api.getDailyCheckin(userId);
      setMsg(r);
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
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-50 text-primary-600 text-sm font-medium hover:bg-primary-100 disabled:opacity-50 cursor-pointer"
      >
        <MessageCircleHeart className={`w-4 h-4 ${loading ? 'animate-pulse' : ''}`} /> 今日问询
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
            <div className="bg-primary-50 rounded-xl p-4 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
              {msg ? msg.message : local}
            </div>
            <p className="text-xs text-slate-400 mt-3">
              {msg ? '回复后内容会自动整理进你的个人图谱' : '本机问询（服务端未连接）：回复后内容会存进本机记录'}
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
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-50 text-primary-600 text-sm font-medium hover:bg-primary-100 cursor-pointer"
      >
        <RefreshCw className="w-4 h-4" /> 生成心理状况报告
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
                  将基于你的个人知识图谱 + 领域知识图谱运行推理 Agent，评估当前心理状态并生成建议。
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
                      result.report.risk_level === 'red'
                        ? 'bg-danger-50 text-danger-600'
                        : result.report.risk_level === 'orange'
                        ? 'bg-orange-50 text-orange-600'
                        : result.report.risk_level === 'yellow'
                        ? 'bg-warning-50 text-warning-600'
                        : 'bg-success-50 text-success-600'
                    }`}
                  >
                    {result.report.risk_label}
                  </span>
                  <span className="text-sm text-slate-500">综合分 {result.report.overall_score}</span>
                  {result.report.alert_created && (
                    <span className="text-xs text-orange-600 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> 已生成预警
                    </span>
                  )}
                  {source === 'local' && (
                    <span className="text-xs text-slate-500">数据来自本机记录，未经过服务端推理</span>
                  )}
                </div>

                {result.report.summary && (
                  <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                    {result.report.summary}
                  </div>
                )}

                {result.report.factors.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-slate-700 mb-2">风险因素</p>
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
                          {f.suggestion && (
                            <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{f.suggestion}</p>
                          )}
                          <p className="text-xs text-primary-600 mt-1">{f.reason}</p>
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
