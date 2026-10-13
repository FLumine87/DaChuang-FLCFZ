import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, RefreshCw, AlertTriangle, MessageCircleHeart, HardDrive } from 'lucide-react';
import { api, type ExtractResult, type InferenceRunResult, type CheckinMessage } from '../../services/api';
import { getCurrentSession } from '../../auth/session';
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
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setError('');
    setBusy(true);

    const userMsg: ChatMessage = { id: Date.now(), role: 'user', text };
    setMessages((prev) => [...prev, userMsg]);

    const reply = FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];
    try {
      const extract = await api.extract(userId, text);
      if (extract.triples?.length) {
        setLocalCount(appendLocalTriples(userId, extract.triples).triples.length);
      }
      setMockServer(Boolean(extract.mock));
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, role: 'assistant', text: reply, extract },
      ]);
    } catch (e) {
      /* 后端不可达也要能聊：用本机关键词规则整理这条消息，回应照给，并标注离线。
         抽取到的三元组同样写进 localStorage（图谱页会把它画出来）。 */
      const triples = triplesFromText(text);
      if (triples.length) setLocalCount(appendLocalTriples(userId, triples).triples.length);
      setError(e instanceof Error ? e.message : '未连接到服务端');
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: 'assistant',
          text: `${reply}\n（离线模式：本条由本机规则整理，暂未连到服务端）`,
          offline: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto">
      <div className="ui-card p-4 flex items-center justify-between">
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
          <span>未连接到服务端（{error}），已切到离线模式：回应由本机规则生成，抽取结果只存在本机。</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto mt-4 space-y-4 pr-1">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-primary-500 text-white rounded-br-sm'
                  : 'ui-card text-slate-700 rounded-bl-sm'
              }`}
            >
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.offline && (
                <span className="mt-2 inline-block rounded-full bg-warning-50 px-2 py-0.5 text-[11px] text-warning-600">
                  离线模式
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

      <div className="mt-4 flex gap-2">
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
      setErr(e instanceof Error ? e.message : '获取问询失败');
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
      setErr(e instanceof Error ? e.message : '推理失败');
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
