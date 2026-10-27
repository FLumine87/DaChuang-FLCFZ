import { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck, ShieldX, Clock, Database, RefreshCw, Loader2,
  AlertTriangle, CheckCircle2, Inbox, Zap, ChevronLeft, ChevronRight, Tag, X,
} from 'lucide-react';
import {
  getReviewStats, getPendingReviews, reviewBatch, triggerRetrain, getRetrainStatus,
  getLabelSpace, setRecordTags, suggestRecordTags,
  type PendingItem, type ReviewStats, type RetrainStatus,
} from '../../services/reviewApi';

const LEVEL_STYLE: Record<string, string> = {
  green: 'text-emerald-700 bg-emerald-50',
  yellow: 'text-amber-700 bg-amber-50',
  orange: 'text-orange-700 bg-orange-50',
  red: 'text-rose-700 bg-rose-50',
};

const LEVEL_LABEL: Record<string, string> = {
  green: '正常', yellow: '关注', orange: '预警', red: '高风险',
};

const MODALITY_LABEL: Record<string, string> = {
  text: '文本', image: '图像', audio: '语音',
};

function StatCard({ icon: Icon, label, value, hint, tone }: {
  icon: typeof Clock; label: string; value: number | string; hint?: string; tone: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-xl ${tone}`}>
          <Icon className="h-4 w-4" />
        </span>
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export default function AdminReview() {
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [items, setItems] = useState<PendingItem[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [offset, setOffset] = useState(0);
  const [retrain, setRetrain] = useState<RetrainStatus | null>(null);
  const [training, setTraining] = useState(false);
  const [labelSpace, setLabelSpace] = useState<string[]>([]);
  const [maxLabels, setMaxLabels] = useState(3);
  const [labeling, setLabeling] = useState<PendingItem | null>(null);
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [savingTags, setSavingTags] = useState(false);
  const PAGE = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, page, tr] = await Promise.all([
        getReviewStats(),
        getPendingReviews({ limit: PAGE, offset, keyword: keyword.trim() }),
        getRetrainStatus().catch(() => null),
      ]);
      if (tr) setRetrain(tr);
      setStats(s);
      setItems(page.items || []);
      setTotal(page.total || 0);
      setSelected((prev) => prev.filter((id) => (page.items || []).some((it) => it.record_id === id)));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [keyword, offset]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    getLabelSpace()
      .then((r) => { setLabelSpace(r.labels || []); setMaxLabels(r.max || 3); })
      .catch(() => setLabelSpace([]));
  }, []);

  const openLabel = (item: PendingItem) => {
    setLabeling(item);
    setDraftTags(item.tags || []);
  };

  const toggleTag = (tag: string) => {
    setDraftTags((prev) => {
      if (prev.includes(tag)) return prev.filter((t) => t !== tag);
      if (prev.length >= maxLabels) return prev;
      return [...prev, tag];
    });
  };

  const runSuggest = async () => {
    if (!labeling) return;
    setSuggesting(true);
    try {
      const r = await suggestRecordTags(labeling.record_id);
      if (r.labels?.length) setDraftTags(r.labels.slice(0, maxLabels));
      setMessage(r.source === 'llm' ? '已根据内容生成建议标签' : (r.reason || '已给出规则建议'));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'AI 建议失败');
    } finally {
      setSuggesting(false);
    }
  };

  const saveTags = async () => {
    if (!labeling) return;
    setSavingTags(true);
    try {
      const r = await setRecordTags(labeling.record_id, draftTags);
      if (!r.ok) {
        setMessage(r.reason || '保存失败');
      } else {
        setMessage(`${labeling.record_id} 标签已保存${draftTags.length ? `：${draftTags.join('、')}` : '（保持无标签）'}`);
        setLabeling(null);
        await load();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingTags(false);
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const allChecked = items.length > 0 && selected.length === items.length;

  const runRetrain = async () => {
    setTraining(true);
    setMessage('');
    try {
      const r = await triggerRetrain();
      setMessage(r.message || '已提交重训任务');
      setRetrain({ running: r.running, pending: r.pending, last_version: r.last_version, windows: r.windows });
      setTimeout(() => void load(), 1500);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '重训失败');
    } finally {
      setTraining(false);
    }
  };

  const submit = async (action: 'approve' | 'reject') => {
    if (!selected.length) {
      setMessage('先勾选要处理的记录');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const r = await reviewBatch(selected, action, note.trim());
      setMessage(
        `${action === 'approve' ? '已通过' : '已拒绝'} ${r.updated} 条` +
        (r.skipped.length ? `，跳过 ${r.skipped.length} 条（${r.skipped[0].reason}）` : '') +
        `，待审剩余 ${r.pending} 条` +
        (r.retrain_scheduled ? '，已自动触发重训' : ''),
      );
      setSelected([]);
      setNote('');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">数据审核</h1>
          <p className="mt-1 text-sm text-slate-500">
            新数据写入后本人即可检索，通过审核后才进入公共检索池与训练池。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void runRetrain()}
            disabled={training || !!retrain?.running}
            className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-700 hover:bg-sky-100 disabled:opacity-50"
            title={retrain ? `队列 ${retrain.pending} 条，最近版本 ${retrain.last_version || '无'}` : ''}
          >
            {training || retrain?.running
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Zap className="h-4 w-4" />}
            {retrain?.running ? '重训中' : '立即重训'}
          </button>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Clock} label="待审核" value={stats?.pending ?? '—'}
          hint="本人可见，他人不可见" tone="bg-amber-50 text-amber-600" />
        <StatCard icon={Database} label="公共池" value={stats?.public ?? '—'}
          hint="可被检索、可被训练" tone="bg-sky-50 text-sky-600" />
        <StatCard icon={ShieldX} label="已拒绝" value={stats?.rejected ?? '—'}
          hint="保留记录，仅供审计" tone="bg-rose-50 text-rose-600" />
        <StatCard icon={ShieldCheck} label="待训练" value={stats?.queue ?? '—'}
          hint={stats?.train_version ? `训练版本 ${stats.train_version}` : '尚无训练版本'}
          tone="bg-emerald-50 text-emerald-600" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
          <div className="text-sm text-slate-600">
            待审 {total} 条
            {selected.length > 0 && <span className="ml-2 text-sky-600">已选 {selected.length}</span>}
            {retrain && (
              <span className="ml-3 text-xs text-slate-400">
                队列 {retrain.pending} · 表 {retrain.windows} · 版本 {retrain.last_version || '未训练'}
              </span>
            )}
          </div>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="按摘要或记录号筛选"
            className="ml-auto w-56 rounded-xl border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-sky-400"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="审核意见（可选）"
            className="w-48 rounded-xl border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-sky-400"
          />
          <button
            onClick={() => void submit('approve')}
            disabled={busy || !selected.length}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            通过
          </button>
          <button
            onClick={() => void submit('reject')}
            disabled={busy || !selected.length}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-1.5 text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-40"
          >
            <ShieldX className="h-4 w-4" />
            拒绝
          </button>
        </div>

        {message && (
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm text-slate-600">
            {message}
          </div>
        )}

        {loading && !items.length ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在加载
          </div>
        ) : !items.length ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-slate-400">
            <Inbox className="h-8 w-8" />
            暂无待审数据
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="w-10 px-4 py-2">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={() => setSelected(allChecked ? [] : items.map((it) => it.record_id))}
                    />
                  </th>
                  <th className="px-3 py-2">记录</th>
                  <th className="px-3 py-2">用户</th>
                  <th className="px-3 py-2">日期</th>
                  <th className="px-3 py-2">时间窗</th>
                  <th className="px-3 py-2">模态</th>
                  <th className="px-3 py-2">风险</th>
                  <th className="px-3 py-2">摘要</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.record_id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        checked={selected.includes(it.record_id)}
                        onChange={() => toggle(it.record_id)}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{it.record_id}</td>
                    <td className="px-3 py-2 text-slate-600">{it.user_id ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{it.date || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{it.window ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {(it.modalities || []).map((m) => MODALITY_LABEL[m] || m).join(' / ')}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${LEVEL_STYLE[it.alert_level] || 'bg-slate-100 text-slate-600'}`}>
                        {it.alert_level === 'red' || it.alert_level === 'orange'
                          ? <AlertTriangle className="h-3 w-3" /> : null}
                        {LEVEL_LABEL[it.alert_level] || it.alert_level}
                      </span>
                    </td>
                    <td className="max-w-md px-3 py-2 text-slate-700">
                      <div className="truncate" title={it.summary}>{it.summary || '（无摘要）'}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {(it.tags || []).length > 0 ? (it.tags || []).map((t) => (
                          <span key={t} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{t}</span>
                        )) : <span className="text-xs text-slate-400">无标签</span>}
                        <button
                          onClick={() => openLabel(it)}
                          className="inline-flex items-center gap-0.5 text-xs text-sky-600 hover:underline"
                        >
                          <Tag className="h-3 w-3" />标注
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE && (
          <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
            <span>{offset + 1}-{Math.min(offset + PAGE, total)} / {total}</span>
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE))}
              disabled={offset === 0}
              className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setOffset(offset + PAGE)}
              disabled={offset + PAGE >= total}
              className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {labeling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-medium text-slate-900">标注主题</h3>
              <button onClick={() => setLabeling(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {labeling.record_id} · 最多选 {maxLabels} 个，留空表示保持无标签
            </p>
            <p className="mt-2 max-h-16 overflow-y-auto rounded-lg bg-slate-50 px-2 py-1.5 text-xs text-slate-500">
              {labeling.summary || '（无摘要）'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {labelSpace.map((tag) => {
                const active = draftTags.includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`rounded-full px-2.5 py-1 text-xs transition ${
                      active
                        ? 'bg-sky-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
              {!labelSpace.length && <span className="text-xs text-slate-400">标签空间未加载</span>}
            </div>
            <div className="mt-5 flex items-center justify-between">
              <button
                onClick={() => void runSuggest()}
                disabled={suggesting}
                className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm text-sky-700 hover:bg-sky-100 disabled:opacity-50"
              >
                {suggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                AI 建议
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLabeling(null)}
                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  onClick={() => void saveTags()}
                  disabled={savingTags}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {savingTags && <Loader2 className="h-4 w-4 animate-spin" />}
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
