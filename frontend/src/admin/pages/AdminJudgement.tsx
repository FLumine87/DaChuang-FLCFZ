/* 智能研判台（管理端 · 智能分析分组）
 *
 * 以「案」为中心，不是以功能为中心：管理员想的是"张同学怎么办"，
 * 不是"我要打开图谱页"。所以左边是待处置队列，右边是同一个案子的
 * 四个阶段：结论 → 依据 → 处置 → 时间线。
 *
 * 这是**一期**，刻意不依赖 Neo4j：
 *   · 相似案例——走 POST /api/personal/search，真哈希检索（已验证跨模态命中）
 *   · 群体共现——本地语料统计（corpusRecords 的 themes），真数据、零依赖
 *   · 推荐方案——取该次检索返回的 report.recommendations
 *  二期再补：个人关系图谱、跨案例共现网络（那两块要 Neo4j）。
 *
 * 管理端的三条硬规矩，在界面里都落到了实处：
 *   1. 结论先行——最上面一句可执行的话，证据折叠在下面
 *  2. 每个 AI 产出可追溯——相似案例点得开、看得到相似度和模态
 *   3. 人工在环——AI 只出建议，「推送」必须管理员点确认；每步进时间线
 */
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Sparkles, Send, FileCheck2, ChevronRight, Loader2,
} from 'lucide-react';
import AlertBadge from '../../components/AlertBadge';
/* /api/admin/alerts 返回 { items, total, page, pageSize } 信封，不是裸数组。
   以前用 mockApi.getAdminAlerts() 拿到的是整个对象，下面 list.filter() 抛异常，
   又被 .catch(() => {}) 吃掉 —— 于是队列永远显示"0 条 / 暂无需处置预警"，
   即使库里真有待处置预警。静默失败比白屏更难发现，这里必须走分页接口。 */
import { listAdminAlerts } from '../../services/adminApi';
import { search } from '../../services/mockApi';
import type { AlertRecord } from '../data/adminMockData';
import { corpusRecords, MODALITY_META, type Modality } from '../../data/corpusRecords';
import type { RetrievalResult } from '../../data/mockData';

const LEVEL_NAME: Record<string, string> = {
  green: '稳定', yellow: '关注', orange: '警告', red: '高危',
};

interface TimelineEntry {
  at: string;
  text: string;
  actor: string;
}

/** 群体共现：本地语料里各主题出现的次数（真数据，不依赖后端） */
function themePrevalence(limit = 5) {
  const counter = new Map<string, number>();
  corpusRecords.forEach((r) => {
    r.themes.forEach((t) => counter.set(t, (counter.get(t) ?? 0) + 1));
  });
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([theme, count]) => ({ theme, count, ratio: count / corpusRecords.length }));
}

export default function AdminJudgement() {
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /* 研判结果 */
  const [evidence, setEvidence] = useState<RetrievalResult[] | null>(null);
  const [advice, setAdvice] = useState<string[]>([]);
  const [probing, setProbing] = useState(false);
  const [question, setQuestion] = useState('');

  /* 留痕：所有处置动作进时间线，不写回后端（一期），但结构按可落库设计 */
  const [timeline, setTimeline] = useState<Record<string, TimelineEntry[]>>({});

  const prevalence = useMemo(() => themePrevalence(), []);

  useEffect(() => {
    let alive = true;
    listAdminAlerts({})
      .then((page) => {
        if (!alive) return;
        const list = page.items;
        const queue = list.filter((a) => a.status === 'pending' || a.status === 'processing');
        setAlerts(queue);
        setActiveId((queue[0] ?? list[0])?.id ?? null);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const active = alerts.find((a) => a.id === activeId) ?? null;

  /* 选中案子后自动跑一次检索：拿相似案例 + 推荐方案 */
  useEffect(() => {
    if (!active) return;
    const q = [active.trigger, active.description].filter(Boolean).join('。');
    if (!q.trim()) return;
    let alive = true;
    setProbing(true);
    setEvidence(null);
    setAdvice([]);
    search(q)
      .then((res) => {
        if (!alive) return;
        setEvidence(res.results?.slice(0, 3) ?? []);
        setAdvice((res.report?.recommendations ?? []).slice(0, 3));
      })
      .catch(() => { if (alive) setEvidence([]); })
      .finally(() => { if (alive) setProbing(false); });
    return () => { alive = false; };
  }, [active]);

  const push = (text: string) => {
    if (!active) return;
    const at = new Date().toLocaleString('zh-CN', { hour12: false }).slice(5, 16);
    setTimeline((t) => ({
      ...t,
      [active.id]: [...(t[active.id] ?? []), { at, text, actor: '当前管理员' }],
    }));
  };

  const ask = async () => {
    const q = question.trim();
    if (!q) return;
    setQuestion('');
    push(`向系统追问：「${q}」`);
    setProbing(true);
    try {
      const res = await search(q);
      setEvidence(res.results?.slice(0, 3) ?? []);
      setAdvice((res.report?.recommendations ?? []).slice(0, 3));
    } catch {
      /* 追问失败保留上一次证据 */
    } finally {
      setProbing(false);
    }
  };

  if (loading) {
    return <div className="ui-card p-6 text-sm text-slate-500">正在载入待处置队列…</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:items-start">
      {/* ───────── 左：待处置队列 ───────── */}
      {/* min-w-0 + overflow-hidden：内容再长也锁在卡片内，徽章不会被挤出卡片边缘 */}
      <aside className="ui-card min-w-0 overflow-hidden p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-slate-800">待处置队列</h2>
          <span className="text-xs tabular-nums text-slate-400">{alerts.length} 条</span>
        </div>
        <ul className="mt-3 flex flex-col gap-1.5">
          {alerts.map((a) => {
            const on = a.id === activeId;
            return (
              <li key={a.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => setActiveId(a.id)}
                  className={`w-full min-w-0 overflow-hidden rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    on
                      ? 'border-primary-300 bg-primary-50/60'
                      : 'border-transparent hover:bg-slate-50'
                  }`}
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-slate-800">{a.name}</span>
                    <AlertBadge level={a.level} size="sm" />
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">{a.trigger}</p>
                  <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                    {a.createdAt} · {a.status === 'pending' ? '新触发' : '跟踪中'}
                  </p>
                </button>
              </li>
            );
          })}
          {!alerts.length && (
            <li className="py-6 text-center text-xs text-slate-400">暂无待处置预警。</li>
          )}
        </ul>
      </aside>

      {/* ───────── 右：同一个案子的四个阶段 ───────── */}
      {!active ? (
        <div className="ui-card p-6 text-sm text-slate-500">左侧选一条预警开始研判。</div>
      ) : (
        <div className="grid min-w-0 gap-4">
          {/* ① 结论先行 */}
          <section className="ui-card min-w-0 overflow-hidden p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-slate-400">当前研判对象</p>
                <h1 className="mt-1 flex min-w-0 items-center gap-2.5 text-xl font-semibold text-slate-900">
                  {active.name}
                  <AlertBadge level={active.level} size="sm" />
                </h1>
                <p className="mt-1.5 break-words text-sm text-slate-600">{active.trigger}</p>
              </div>
              <span className="shrink-0 rounded-lg bg-slate-50 px-3 py-2 text-right">
                <span className="block text-[11px] text-slate-400">建议动作</span>
                <span className="text-sm font-medium text-slate-800">
                  {active.level === 'red'
                    ? '48 小时内面谈'
                    : active.level === 'orange'
                      ? '本周内联系'
                      : '保持跟踪'}
                </span>
              </span>
            </div>
            <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-600">
              {active.description}
            </p>
          </section>

          {/* ② 依据：可追溯 */}
          <section className="ui-card min-w-0 overflow-hidden p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <FileCheck2 className="h-4 w-4 text-primary-500" />
              研判依据
              {probing && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
            </h2>

            <p className="mt-3 text-xs text-slate-400">相似历史案例（跨模态哈希检索，点得开看原文）</p>
            <ul className="mt-2 flex flex-col gap-2">
              {(evidence ?? []).map((r) => {
                const meta = MODALITY_META[(r.modality === 'multimodal' ? 'text' : r.modality) as Modality];
                const lvl = (r as unknown as { alert_level?: string; alertLevel?: string });
                const lv = lvl.alertLevel ?? lvl.alert_level ?? 'green';
                return (
                  <li key={r.id} className="min-w-0 rounded-lg border border-slate-100 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-xs">
                        <span className="font-medium tabular-nums text-slate-700">{r.id}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">
                          {meta?.label ?? '文本'}
                        </span>
                        <span className="tabular-nums text-slate-400">{r.date}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${lv === 'red' ? 'text-danger-600' : lv === 'orange' ? 'text-orange-600' : 'text-warning-600'}`}>
                          {LEVEL_NAME[lv] ?? '—'}
                        </span>
                        <span className="text-sm font-semibold tabular-nums text-slate-900">
                          {Math.round(r.similarity * 100)}%
                        </span>
                      </span>
                    </div>
                    <p className="mt-1.5 text-[13px] leading-6 text-slate-600">{r.summary}</p>
                  </li>
                );
              })}
              {evidence && !evidence.length && (
                <li className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
                  没检索到相似案例（检查后端是否在跑，或换一条描述）
                </li>
              )}
            </ul>

            <p className="mt-4 text-xs text-slate-400">群体共现（本地语料 {corpusRecords.length} 条的主题分布）</p>
            <div className="mt-2 grid gap-1.5">
              {prevalence.map((p) => (
                <div key={p.theme} className="grid grid-cols-[76px_minmax(0,1fr)_64px] items-center gap-3">
                  <span className="text-xs text-slate-500">{p.theme}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full bg-primary-400" style={{ width: `${p.ratio * 100}%` }} />
                  </span>
                  <span className="text-right text-xs tabular-nums text-slate-500">
                    {p.count} 例 · {Math.round(p.ratio * 100)}%
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && ask()}
                placeholder="追问，比如：这个学生上次干预后为什么没缓解？"
                className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary-300"
              />
              <button type="button" onClick={ask} className="ui-button shrink-0">
                提问
              </button>
            </div>
          </section>

          {/* ③ 处置：人工在环 */}
          <section className="ui-card min-w-0 overflow-hidden p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Sparkles className="h-4 w-4 text-primary-500" />
              处置方案
            </h2>
            <ul className="mt-3 grid gap-1.5">
              {(advice.length ? advice : ['等待研判结果…']).map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm leading-6 text-slate-600">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                  {a}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => push(`审核并推送干预方案（${advice.length || 0} 条）`)}
                className="ui-button ui-button-primary"
              >
                <Send className="h-4 w-4" />
                审核并推送
              </button>
              <button type="button" onClick={() => push('仅记录研判结论，不推送')} className="ui-button">
                仅记录不推送
              </button>
              <button type="button" onClick={() => push('标记为需上级复核')} className="ui-button">
                <AlertTriangle className="h-4 w-4" />
                需上级复核
              </button>
            </div>
            <p className="mt-2.5 text-[11.5px] text-slate-400">
              AI 只出建议，推送必须由管理员确认 —— 高危学生不自动推送。
            </p>
          </section>

          {/* ④ 时间线：留痕 */}
          <section className="ui-card min-w-0 overflow-hidden p-5">
            <h2 className="text-sm font-semibold text-slate-800">处置时间线</h2>
            <ul className="mt-3 grid gap-2">
              {(timeline[active.id] ?? []).map((t, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-slate-600">
                  <span className="shrink-0 tabular-nums text-xs text-slate-400">{t.at}</span>
                  <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" />
                  <span className="min-w-0 flex-1">{t.text}</span>
                  <span className="shrink-0 text-xs text-slate-400">{t.actor}</span>
                </li>
              ))}
              {!(timeline[active.id] ?? []).length && (
                <li className="text-xs text-slate-400">
                  还没有处置动作。上面的每个按钮都会在这里留一条记录。
                </li>
              )}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
