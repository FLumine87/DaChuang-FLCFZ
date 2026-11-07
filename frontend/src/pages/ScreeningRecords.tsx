import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  NotebookPen,
  AlertTriangle,
  Search,
  ChevronDown,
  FileText,
  Mic,
  ImageIcon,
  ArrowRight,
  StickyNote,
  Trash2,
} from 'lucide-react';
import {
  deletePersonalSupplement,
  getPersonalSupplements,
  saveSupplementNote,
  type PersonalSupplement,
  type CollectionAnalysis,
} from '../services/mockApi';

/*
 * 筛查记录
 * ========
 * 把提交过的每一条文字 / 语音 / 照片记录下来，连同系统当时的判断结论一起沉淀：
 * 写的是什么、判成了什么等级、比对出了哪些相似样本。
 *
 * 版式按"记录本"来排，而不是数据列表：
 *   · 左侧日期轨 + 时间线节点，一天一组，先看到"哪一天"
 *   · 正文用较大字号、保留换行（whitespace-pre-wrap）
 *   · 记录 ID、相似度这些技术信息降到最次要的位置
 *   · 便签是贴在边上的一张黄色小纸条
 *
 * 记录不在这里创建 —— 统一走「心理筛查分析」的文本/语音/图像采集，
 * 这样"在哪里记录"只有一个入口，避免两套写入路径产生不一致。
 *
 * 数据来自 GET /api/personal/supplements：每条记录落库时，后端会同步跑一次
 * 哈希检索引擎，把 analysis（等级 / 结论 / 命中）一起存下来。
 */

const LEVEL_TONE: Record<string, { pill: string; dot: string; text: string }> = {
  unknown: { pill: 'bg-slate-100 text-slate-500', dot: 'bg-slate-400', text: 'text-slate-500' },
  green: { pill: 'bg-success-50 text-success-700', dot: 'bg-success-500', text: 'text-success-600' },
  yellow: { pill: 'bg-warning-50 text-warning-700', dot: 'bg-warning-500', text: 'text-warning-600' },
  orange: { pill: 'bg-orange-50 text-orange-700', dot: 'bg-orange-500', text: 'text-orange-600' },
  red: { pill: 'bg-danger-50 text-danger-700', dot: 'bg-danger-500', text: 'text-danger-600' },
};
const LEVEL_NAME: Record<string, string> = {
  unknown: '未评估', green: '稳定', yellow: '关注', orange: '警告', red: '高危',
};
const MODALITY_NAME: Record<string, string> = { text: '文字', audio: '语音', image: '照片' };
const MODALITY_ICON = { text: FileText, audio: Mic, image: ImageIcon } as const;
type Filter = 'all' | 'text' | 'audio' | 'image';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 把 `YYYY-MM-DD HH:MM` 解析成 Date；解析失败返回 null */
function parseTime(raw?: string): Date | null {
  if (!raw) return null;
  const s = String(raw).replace('T', ' ').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  const d = new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0,
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 分组键：按自然日 */
function dayKey(raw?: string): string {
  const d = parseTime(raw);
  if (!d) return 'unknown';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 日期轨上显示：大号"日" + 小号"月份 · 周几" */
function dayParts(raw?: string): { day: string; meta: string } {
  const d = parseTime(raw);
  if (!d) return { day: '—', meta: '时间未知' };
  return {
    day: String(d.getDate()).padStart(2, '0'),
    meta: `${d.getMonth() + 1} 月 · ${WEEKDAYS[d.getDay()]}`,
  };
}

/** 条目上的时刻 */
function timeOf(raw?: string): string {
  const d = parseTime(raw);
  if (!d) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 完整时间（便签更新时间用） */
function fullTime(raw?: string): string {
  const d = parseTime(raw);
  if (!d) return '时间未知';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 正文：文字记录用原文；语音/照片给一句人话标题，文件名降到副行 */
function entryTitle(item: PersonalSupplement): string {
  if (item.kind === 'text') return item.text?.trim() || '（这一段没有留下文字）';
  return item.kind === 'audio' ? '录了一段语音' : '拍了一张照片';
}
function entrySub(item: PersonalSupplement): string {
  if (item.kind === 'text') return '';
  return item.filename || item.description || '';
}

function RecordEntry({
  item,
  open,
  onToggle,
  onChanged,
}: {
  item: PersonalSupplement;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const analysis: CollectionAnalysis | undefined = item.analysis;
  const level = analysis?.level ?? 'unknown';
  const tone = LEVEL_TONE[level] ?? LEVEL_TONE.unknown;
  const Icon = MODALITY_ICON[item.kind] ?? FileText;
  const hits = analysis?.hits ?? [];
  const hasDetail = !!analysis;
  const hasNote = !!(item.note && item.note.trim());

  /* 「用这条去检索」的目标地址：把这条记录的文字带过去（语音/照片取分析里的
     query 或说明），再加上记录 id —— 检索页会直接填好并打开对应结论，
     用户不用再手输一遍，也不会检索到别的内容。 */
  const searchQuery = (
    analysis?.query || item.text || item.description || item.filename || ''
  ).trim();
  const searchHref = `/personal/screening?tab=retrieval&assessmentSupplementId=${item.id}${
    searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ''
  }`;

  const [noteOpen, setNoteOpen] = useState(false);
  const [draft, setDraft] = useState(item.note ?? '');
  const [savingNote, setSavingNote] = useState(false);
  const [noteMsg, setNoteMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [delMsg, setDelMsg] = useState<string | null>(null);

  const openNoteEditor = () => {
    setDraft(item.note ?? '');
    setNoteMsg(null);
    setNoteOpen(true);
    setConfirmDel(false);
  };

  const doSaveNote = async () => {
    setSavingNote(true);
    setNoteMsg(null);
    try {
      await saveSupplementNote(item.id, draft.trim());
      setNoteOpen(false);
      onChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '保存便签失败';
      setNoteMsg({
        kind: 'err',
        text: msg.includes('不存在') ? '这条记录已经不存在了，列表已刷新' : msg,
      });
      onChanged();
    } finally {
      setSavingNote(false);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    setDelMsg(null);
    try {
      await deletePersonalSupplement(item.id);
      onChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '删除失败';
      setDelMsg(msg.includes('不存在') ? '这条记录已经不存在了，列表已刷新' : msg);
      onChanged();
    } finally {
      setDeleting(false);
      setConfirmDel(false);
    }
  };

  return (
    <li className="relative">
      {/* 时间线上的节点 */}
      <span
        className="absolute -left-[25px] top-4 h-2 w-2 rounded-full bg-primary-300 ring-4 ring-white"
        aria-hidden="true"
      />

      <article className="group rounded-2xl border border-slate-200 bg-white px-4 py-3.5 transition-colors hover:border-slate-300">
        {/* 顶行：时刻 + 模态 + 等级；右侧操作（悬停显形，保持正文干净） */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[12px] font-medium tabular-nums text-slate-400">
              {timeOf(item.createdAt)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
              <Icon className="h-3 w-3" />
              {MODALITY_NAME[item.kind] ?? item.kind}
            </span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone.pill}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
              {analysis?.levelLabel ?? LEVEL_NAME[level]}
            </span>
            {analysis?.alertId && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-danger-600">
                <AlertTriangle className="h-3 w-3" />
                已生成预警
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={openNoteEditor}
              title={hasNote ? '编辑便签' : '写一张便签'}
              aria-label={hasNote ? '编辑便签' : '写便签'}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] transition-colors ${
                hasNote
                  ? 'bg-warning-50 text-warning-700 hover:bg-warning-100'
                  : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
              }`}
            >
              <StickyNote className="h-3.5 w-3.5" />
              便签
            </button>
            <button
              type="button"
              onClick={() => { setConfirmDel(true); setNoteOpen(false); }}
              title="删除这条记录"
              aria-label="删除这条记录"
              className="rounded-md p-1 text-slate-300 transition-colors hover:bg-danger-50 hover:text-danger-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* 正文：这条记录的主体。保留换行，字号比列表大一号。 */}
        <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-7 text-slate-700">
          {entryTitle(item)}
        </p>
        {entrySub(item) && (
          <p className="mt-1 truncate font-mono text-[11.5px] text-slate-400">{entrySub(item)}</p>
        )}

        {analysis?.conclusion && (
          <p className="mt-1.5 text-[13px] leading-6 text-slate-500">{analysis.conclusion}</p>
        )}

        {/* 每条记录的操作行：拿这条去检索（常驻，是主操作）+ 展开系统依据 */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Link
            to={searchHref}
            title="带上这条记录的内容，去检索页重新比对并查看结论"
            className="inline-flex items-center gap-1 rounded-md border border-primary-200 bg-primary-50 px-2.5 py-1 text-[11.5px] font-medium text-primary-600 transition-colors hover:bg-primary-100"
          >
            <Search className="h-3 w-3" />
            用这条去检索
          </Link>

          {hasDetail && (
            <button
              type="button"
              onClick={onToggle}
              className="inline-flex items-center gap-1 text-[11.5px] text-slate-400 transition-colors hover:text-slate-600"
              aria-expanded={open}
            >
              <ChevronDown
                className={`h-3 w-3 transition-transform ${open ? 'rotate-0' : '-rotate-90'}`}
                aria-hidden="true"
              />
              {open ? '收起系统的判断依据' : '看看系统当时是怎么判断的'}
            </button>
          )}
        </div>

        {/* 便签：贴在正文下的一张黄色小纸条 */}
        {hasNote && !noteOpen && (
          <div className="mt-2.5 rounded-lg border border-warning-200 bg-warning-50/70 px-3 py-2">
            <div className="flex items-start gap-2">
              <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-600" />
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-slate-700">
                  {item.note}
                </p>
                {item.noteUpdatedAt && (
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    便签更新于 {fullTime(item.noteUpdatedAt)}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 便签编辑 */}
        {noteOpen && (
          <div className="mt-2.5 rounded-lg border border-primary-200 bg-primary-50/40 p-3">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="给这条记录补一句自己的话：当时发生了什么、后来怎么样了…"
              className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] leading-6 text-slate-700 outline-none focus:border-primary-400"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400">
                {draft.length}/2000 · 清空并保存 = 删掉便签
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setNoteOpen(false); setNoteMsg(null); }}
                  disabled={savingNote}
                  className="rounded-lg px-2.5 py-1 text-[12px] text-slate-500 hover:bg-white disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void doSaveNote()}
                  disabled={savingNote}
                  className="rounded-lg bg-primary-500 px-3 py-1 text-[12px] font-medium text-white hover:bg-primary-600 disabled:opacity-60"
                >
                  {savingNote ? '保存中…' : '保存便签'}
                </button>
              </div>
            </div>
            {noteMsg && (
              <p className={`mt-1.5 text-[11.5px] ${noteMsg.kind === 'ok' ? 'text-success-600' : 'text-danger-600'}`}>
                {noteMsg.text}
              </p>
            )}
          </div>
        )}

        {/* 删除确认 */}
        {confirmDel && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg bg-danger-50 px-3 py-2">
            <span className="text-[12px] font-medium text-danger-700">
              删除后这条记录与它的便签都会消失，确定？
            </span>
            <button
              type="button"
              onClick={() => void doDelete()}
              disabled={deleting}
              className="rounded bg-danger-600 px-2.5 py-1 text-[11.5px] font-medium text-white hover:bg-danger-700 disabled:opacity-60"
            >
              {deleting ? '删除中…' : '确定删除'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDel(false)}
              disabled={deleting}
              className="rounded px-2 py-1 text-[11.5px] text-slate-500 hover:bg-white disabled:opacity-50"
            >
              取消
            </button>
          </div>
        )}
        {delMsg && <p className="mt-1.5 text-[11.5px] text-danger-600">{delMsg}</p>}

        {/* 展开内容：系统当时看到了什么（开关在上面那一行操作区里） */}
        {hasDetail && open && (
          <div className="mt-2.5 space-y-2.5 border-t border-dashed border-slate-200 pt-2.5">
            {analysis?.reason && (
              <p className="text-[12px] leading-5 text-slate-400">依据：{analysis.reason}</p>
            )}

            {hits.length > 0 && (
              <div>
                <p className="text-[11.5px] font-medium text-slate-500">当时比对到的相似片段</p>
                <ul className="mt-1 space-y-1.5">
                  {hits.slice(0, 5).map((hit) => {
                    const hTone = LEVEL_TONE[hit.alertLevel] ?? LEVEL_TONE.unknown;
                    return (
                      <li key={hit.id} className="flex items-start gap-2 text-[12px] leading-5">
                        <span className="mt-0.5 w-8 shrink-0 text-[11px] text-slate-400">
                          {hit.modalityLabel ?? MODALITY_NAME[hit.modality ?? ''] ?? ''}
                        </span>
                        <span className="min-w-0 flex-1 text-slate-600">{hit.summary}</span>
                        <span className="shrink-0 tabular-nums text-[11px] text-slate-400">
                          {hit.similarity.toFixed(2)}
                        </span>
                        <span className={`shrink-0 text-[11px] ${hTone.text}`}>
                          {LEVEL_NAME[hit.alertLevel] ?? '未评估'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-3 pt-0.5">
              <Link
                to={searchHref}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-primary-600 hover:text-primary-700"
              >
                打开完整依据 <ArrowRight className="h-3 w-3" />
              </Link>
              {analysis?.alertId && (
                <Link
                  to="/personal/alerts"
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-danger-600 hover:text-danger-700"
                >
                  去预警中心 <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
          </div>
        )}
      </article>
    </li>
  );
}

export default function ScreeningRecords() {
  const [items, setItems] = useState<PersonalSupplement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [openIds, setOpenIds] = useState<Record<number, boolean>>({});

  const reload = useCallback(async () => {
    try {
      const list = await getPersonalSupplements();
      setItems(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取记录失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 先按模态筛，再按自然日分组（组内按时间倒序、组间也倒序） */
  const groups = useMemo(() => {
    const base = filter === 'all' ? items : items.filter((it) => it.kind === filter);
    const sorted = [...base].sort((a, b) =>
      String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
    const out: { key: string; items: PersonalSupplement[] }[] = [];
    for (const it of sorted) {
      const k = dayKey(it.createdAt);
      const last = out[out.length - 1];
      if (last && last.key === k) last.items.push(it);
      else out.push({ key: k, items: [it] });
    }
    return out;
  }, [items, filter]);

  const total = useMemo(
    () => (filter === 'all' ? items.length : items.filter((i) => i.kind === filter).length),
    [items, filter],
  );
  const notedCount = useMemo(() => items.filter((i) => i.note && i.note.trim()).length, [items]);

  const counts = useMemo(() => ({
    all: items.length,
    text: items.filter((i) => i.kind === 'text').length,
    audio: items.filter((i) => i.kind === 'audio').length,
    image: items.filter((i) => i.kind === 'image').length,
  }), [items]);

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div className="ui-card p-5">
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-800">
          <NotebookPen className="h-5 w-5 text-primary-600" />
          筛查记录
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          你提交过的文字、语音与照片，连同系统当时的判断结论，都按日子留在这里。
          每条后面还能补一张便签，记下后来想到的事。
        </p>
        {items.length > 0 && (
          <p className="mt-2 text-[12px] text-slate-400">
            共 {items.length} 条记录
            {notedCount > 0 && ` · 其中 ${notedCount} 条写了便签`}
          </p>
        )}
      </div>

      {/* 模态筛选 */}
      <div className="ml-2 flex w-fit max-w-full flex-wrap gap-1.5 rounded-lg border border-slate-200 bg-white p-1.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        {([
          ['all', '全部'],
          ['text', '文字'],
          ['audio', '语音'],
          ['image', '照片'],
        ] as const).map(([value, label]) => {
          const active = filter === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
                active ? 'bg-primary-500 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {label}
              <span className={`tabular-nums text-xs ${active ? 'text-white/80' : 'text-slate-400'}`}>
                {counts[value]}
              </span>
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="ui-card p-8 text-center text-sm text-slate-400">正在读取记录…</div>
      )}

      {!loading && error && (
        <div className="ui-card border-danger-200 bg-danger-50 p-5 text-sm text-danger-700">
          读取失败：{error}
        </div>
      )}

      {!loading && !error && total === 0 && (
        <div className="ui-card p-10 text-center">
          <p className="text-sm text-slate-500">这一页还是空白。</p>
          <p className="mt-1.5 text-xs text-slate-400">
            去「心理筛查分析」写下一段话，或用语音、照片记录一次，之后这里就会有内容。
          </p>
          <Link
            to="/personal/screening?tab=text"
            className="ui-button mt-4 inline-flex items-center gap-2"
          >
            <Search className="h-4 w-4" />
            去记录一次
          </Link>
        </div>
      )}

      {/* 时间线：按天分组 */}
      {!loading && !error && groups.length > 0 && (
        <div className="space-y-7">
          {groups.map((group) => {
            const parts = dayParts(group.items[0].createdAt);
            return (
              <section
                key={group.key}
                className="grid grid-cols-[44px_minmax(0,1fr)] gap-4 sm:grid-cols-[60px_minmax(0,1fr)] sm:gap-5"
              >
                {/* 日期轨 */}
                <div className="pt-3 text-right">
                  <p className="text-[24px] font-semibold leading-none tabular-nums text-slate-700">
                    {parts.day}
                  </p>
                  <p className="mt-1 text-[10.5px] leading-4 text-slate-400">{parts.meta}</p>
                </div>

                {/* 条目 */}
                <ul className="space-y-3 border-l border-slate-200 pl-5 sm:pl-6">
                  {group.items.map((item) => (
                    <RecordEntry
                      key={`${item.id}-${item.createdAt ?? ''}`}
                      item={item}
                      open={!!openIds[item.id]}
                      onToggle={() => setOpenIds((s) => ({ ...s, [item.id]: !s[item.id] }))}
                      onChanged={() => void reload()}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {/* 页脚引导 */}
      {!loading && !error && total > 0 && (
        <div className="ui-card flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-slate-500">
            想再比对一次相似样本？检索与记录都在同一页。
          </p>
          <Link
            to="/personal/screening?tab=retrieval"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
          >
            <Search className="h-4 w-4" />
            去「心理筛查分析 · 检索分析」
          </Link>
        </div>
      )}
    </div>
  );
}
