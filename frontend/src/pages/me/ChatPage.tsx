import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, RefreshCw, AlertTriangle, MessageCircleHeart } from 'lucide-react';
import { api, type ExtractResult, type InferenceRunResult, type CheckinMessage } from '../../services/api';
import { getCurrentSession } from '../../auth/session';

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  extract?: ExtractResult;
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

    try {
      const extract = await api.extract(userId, text);
      const fallback = FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, role: 'assistant', text: fallback, extract },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '抽取失败，请确认后端服务已启动');
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, role: 'assistant', text: '（服务连接异常，内容未入图谱）' },
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
          <p className="text-xs text-slate-500 mt-1">
            你的话语会被抽取成知识图谱三元组 · 当前用户 <span className="font-mono">{userId}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DailyCheckinButton userId={userId} />
          <RunInferenceButton userId={userId} />
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 text-sm text-danger-600 bg-danger-50 border border-danger-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
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
              <p>{m.text}</p>
              {m.extract && m.extract.triples.length > 0 && (
                <div className="mt-2 pt-2 border-t border-slate-100 space-y-1">
                  <p className="text-xs font-medium text-slate-400">已抽取 {m.extract.triples.length} 条入图谱：</p>
                  {m.extract.triples.slice(0, 4).map((t, i) => (
                    <p key={i} className="text-xs text-primary-600 font-mono">
                      ({t.relation}) {t.object}
                      {t.category ? ` · ${t.category}` : ''}
                    </p>
                  ))}
                  {!m.extract.neo4j_connected && (
                    <p className="text-xs text-warning-600">Neo4j 未连接，仅返回未写入</p>
                  )}
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
  const [err, setErr] = useState('');
  const [show, setShow] = useState(false);

  const fetchCheckin = async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.getDailyCheckin(userId);
      setMsg(r);
      setShow(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '获取问询失败');
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

      {show && msg && (
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
              {msg.message}
            </div>
            <p className="text-xs text-slate-400 mt-3">回复后内容会自动整理进你的个人图谱</p>
            {err && <p className="text-xs text-danger-600 mt-2">{err}</p>}
          </div>
        </div>
      )}
    </>
  );
}

function RunInferenceButton({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<InferenceRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const run = async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await api.runInference(userId);
      setResult(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '推理失败');
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
              <h3 className="text-lg font-semibold text-slate-800">心理状况推理报告</h3>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">✕</button>
            </div>

            {!result && !loading && (
              <div className="text-center py-8">
                <p className="text-sm text-slate-500 mb-4">
                  将基于你的个人知识图谱 + 领域知识图谱运行推理 Agent，评估当前心理状态并生成建议。
                </p>
                {err && <p className="text-sm text-danger-600 mb-3">{err}</p>}
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
