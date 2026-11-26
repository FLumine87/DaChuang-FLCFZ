import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
  ClipboardList,
  X,
} from 'lucide-react';
import {
  deletePersonalSupplement,
  getPersonalScreeningHistory,
  saveSupplementNote,
  type PersonalSupplement,
  type CollectionAnalysis,
  type DashboardInput,
} from '../services/mockApi';
import type { PersonalScreeningRecord } from '../data/mockData';
import { QUESTIONNAIRE_VERSION, questionnaires } from '../data/questionnaireData';
import { dashboardInputTime } from '../services/dashboardInput';
import { usePageActive } from '../services/pageActivity';
import ScreeningDetail from './ScreeningDetail';

/*
 * 筛查记录
 * ========
 * 统一回看每一次量表、文字、语音与图像筛查，保留各自原始结果。
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
 * 数据来自 GET /api/personal/records；多模态记录保留原有便签和删除操作。
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
type Filter = 'all' | 'scale' | 'text' | 'audio' | 'image';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/* 媒体地址：后端返回的是 /uploads/... 相对路径，跨域部署时补上 API 前缀 */
const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) || '').replace(/\/$/, '');
function assetUrl(url?: string): string {
  if (!url) return '';
  if (/^(https?:|blob:|data:)/.test(url)) return url;
  return `${API_BASE}${url}`;
}

/** 把 `YYYY-MM-DD HH:MM` 解析成 Date；解析失败返回 null */
function parseTime(raw?: string): Date | null {
  if (!raw) return null;
  // Group explicit offsets and legacy local timestamps into the same Shanghai day.
  const chinaTime = new Date(dashboardInputTime(raw));
  if (Number.isNaN(chinaTime.getTime())) return null;
  const d = new Date(chinaTime.toLocaleString('sv-SE', {timeZone:'Asia/Shanghai'}).replace(' ', 'T'));
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
    meta: `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 · ${WEEKDAYS[d.getDay()]}`,
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

  /* 「用这条去检索」的目标地址：只把用户自己写的文字带过去，再加上记录 id ——
     检索页会直接填好并打开对应结论，用户不用再手输一遍。
     语音/照片的 description 是后端生成的特征提取说明（如「已完成 192 维…」），
     不是可检索的文字，不能当 q 带过去，否则会在检索页输入框里多出一段说明，
     还会把这次跳转变成一次文本检索。这类条目只带 id，由检索页按图/按语音
     直接打开已保存的结论。 */
  const searchQuery = (item.kind === 'text' ? item.text ?? '' : '').trim();
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
  const [previewOpen, setPreviewOpen] = useState(false);

  /* 照片预览：Esc 或点背景关闭，避免打开后没有退出口 */
  useEffect(() => {
    if (!previewOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [previewOpen]);

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

      <article className="group flex min-h-[176px] flex-col rounded-2xl border border-slate-200 bg-white px-4 py-3.5 transition-colors hover:border-slate-300">
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

        {/* 删除确认：紧贴时间/删除图标下方，正文之前 */}
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

        {/* 正文与媒体左右并排：媒体只占右侧，不撑高记录卡片 */}
        <div className="mt-2 flex flex-wrap items-start gap-3">
          <div className="min-w-[200px] flex-1">
            <p className="whitespace-pre-wrap break-words text-[15px] leading-7 text-slate-700">
              {entryTitle(item)}
            </p>
            {entrySub(item) && (
              <p className="mt-1 truncate font-mono text-[11.5px] text-slate-400">{entrySub(item)}</p>
            )}
            {analysis?.conclusion && (
              <p className="mt-1.5 text-[13px] leading-6 text-slate-500">{analysis.conclusion}</p>
            )}
          </div>
          {item.kind === 'image' && item.url && (
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              title="查看照片"
              aria-label="查看这张照片"
              className="block h-20 w-28 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-slate-200 transition-colors hover:border-primary-300"
            >
              <img
                src={assetUrl(item.url)}
                alt={item.filename || '这条记录的照片'}
                className="h-full w-full object-cover"
              />
            </button>
          )}
          {item.kind === 'audio' && item.url && (
            <audio
              controls
              preload="metadata"
              src={assetUrl(item.url)}
              className="w-56 shrink-0 self-center"
            >
              当前浏览器不支持音频播放。
            </audio>
          )}
        </div>

        {/* 照片预览：浮层内查看，点背景、关闭按钮或 Esc 都能退出 */}
        {previewOpen && item.url && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
            role="dialog"
            aria-modal="true"
            aria-label="查看照片"
            onClick={() => setPreviewOpen(false)}
          >
            <button
              type="button"
              onClick={() => setPreviewOpen(false)}
              aria-label="关闭预览"
              className="absolute right-5 top-5 cursor-pointer rounded-full bg-white/90 p-2 text-slate-600 shadow hover:bg-white"
            >
              <X className="h-5 w-5" />
            </button>
            <img
              src={assetUrl(item.url)}
              alt={item.filename || '这条记录的照片'}
              onClick={(event) => event.stopPropagation()}
              className="max-h-[70vh] max-w-[min(90vw,720px)] rounded-xl bg-white object-contain shadow-2xl"
            />
          </div>
        )}

        {/* 每条记录的操作行：拿这条去检索（常驻，是主操作）+ 展开系统依据 */}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-2.5">
          <Link
            to={searchHref}
            /* 把这条记录本身随路由带过去：检索页据此挂载文字 / 语音 / 图片，
               不依赖列表缓存与 URL 上的文字，避免挂到别的记录上。 */
            state={{ supplement: item }}
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

function ScaleRecordEntry({item,at,href}:{item:PersonalScreeningRecord;at:string;href:string}) {
  const definition = questionnaires.find(q=>q.id===item.questionnaire || q.name===item.questionnaire);
  const legacyPss = definition?.id==='PSS-10' && item.questionnaireVersion!==QUESTIONNAIRE_VERSION;
  const explanation = legacyPss ? '历史量表版本待核对，保留原始总分。' : definition?.scoring(item.score).label;
  return <li className="relative">
    <span className="absolute -left-[25px] top-4 h-2 w-2 rounded-full bg-primary-300 ring-4 ring-white" aria-hidden="true" />
    <article className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-slate-400">
        <time>{timeOf(at)}</time>
        <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-primary-600"><ClipboardList className="h-3 w-3" />量表</span>
        <span>已完成 · 当次量表结果</span>
      </div>
      <h4 className="mt-2 text-[15px] font-medium leading-7 text-slate-700">{definition?.name ?? item.questionnaire}</h4>
      <p className="mt-1 text-sm text-slate-600"><strong className="text-xl tabular-nums text-slate-800">{item.score}</strong> / {item.maxScore} 分{explanation && ` · ${explanation}`}</p>
      {item.retrieval?.summary && <p className="mt-2 line-clamp-2 text-[13px] leading-6 text-slate-500">{item.retrieval.summary}</p>}
      <Link to={href} className="mt-3 inline-flex items-center gap-1 rounded-md border border-primary-200 bg-primary-50 px-2.5 py-1 text-[11.5px] font-medium text-primary-600 hover:bg-primary-100">
        查看量表详情与原始作答 <ArrowRight className="h-3 w-3" />
      </Link>
    </article>
  </li>;
}

export default function ScreeningRecords() {
  const pageActive = usePageActive();
  const [params,setParams] = useSearchParams();
  const selectedId = params.get('record');
  const requestedFilter = params.get('type');
  const filter:Filter = ['scale','text','audio','image'].includes(requestedFilter || '') ? requestedFilter as Filter : 'all';
  const [items, setItems] = useState<DashboardInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const loadSequence = useRef(0);

  const reload = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const list = await getPersonalScreeningHistory();
      if (sequence !== loadSequence.current) return;
      setItems(list);
      setError(null);
    } catch (e) {
      if(sequence===loadSequence.current)setError(e instanceof Error ? e.message : '读取记录失败');
    } finally {
      if(sequence===loadSequence.current)setLoading(false);
    }
  }, []);
  const cancelLoad = useCallback(()=>{loadSequence.current++;},[]);

  useEffect(() => {
    if(pageActive)void reload();
    return cancelLoad;
  }, [reload,pageActive,cancelLoad]);

  /** 先按模态筛，再按自然日分组（组内按时间倒序、组间也倒序） */
  const groups = useMemo(() => {
    const base = filter === 'all' ? items : items.filter((it) => it.kind === filter);
    const sorted = [...base].sort((a, b) =>
      (parseTime(b.at)?.getTime() ?? 0) - (parseTime(a.at)?.getTime() ?? 0));
    const out: { key: string; items: DashboardInput[] }[] = [];
    for (const it of sorted) {
      const k = dayKey(it.at);
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
  const notedCount = useMemo(() => items.filter((i) => i.supplement?.note?.trim()).length, [items]);

  const counts = useMemo(() => ({
    all: items.length,
    scale: items.filter(i=>i.kind==='scale').length,
    text: items.filter((i) => i.kind === 'text').length,
    audio: items.filter((i) => i.kind === 'audio').length,
    image: items.filter((i) => i.kind === 'image').length,
  }), [items]);

  const selected = selectedId ? items.find(i=>i.kind==='scale' && i.scale?.id===selectedId)?.scale : null;
  const clearSelection = () => setParams(prev=>{const next=new URLSearchParams(prev);next.delete('record');return next;});
  if(selected)return <ScreeningDetail record={selected} onBack={clearSelection} />;
  if(selectedId)return <div className="ui-card p-6"><p className="text-sm text-slate-500">{loading ? '正在读取筛查记录…' : error || '未找到这条量表筛查记录。'}</p><button className="ui-button mt-3" onClick={clearSelection}>返回筛查记录</button></div>;

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div className="ui-card p-5">
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-800">
          <NotebookPen className="h-5 w-5 text-primary-600" />
          筛查记录
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          量表、文字、语音与图像筛查统一按时间保存在这里，可筛选类型、查看当次结果与原始记录。
          多模态记录还可以补充便签，记下后来想到的事。
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
          ['scale', '量表'],
          ['text', '文字'],
          ['audio', '语音'],
          ['image', '照片'],
        ] as const).map(([value, label]) => {
          const active = filter === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setParams(prev=>{const next=new URLSearchParams(prev);if(value==='all')next.delete('type');else next.set('type',value);return next;})}
              aria-pressed={active}
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
          <button onClick={()=>void reload()} className="ml-3 underline">重试</button>
        </div>
      )}

      {!loading && !error && total === 0 && (
        <div className="ui-card p-10 text-center">
          <p className="text-sm text-slate-500">这一页还是空白。</p>
          <p className="mt-1.5 text-xs text-slate-400">
            完成一次量表，或提交文字、语音、图像筛查后，就能在这里统一回看。
          </p>
          <Link
            to={`/personal/screening?tab=${filter==='scale'?'scale':'text'}`}
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
            const parts = dayParts(group.items[0].at);
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
                  {group.items.map((item) => item.kind==='scale' && item.scale ? (
                    <ScaleRecordEntry key={item.id} item={item.scale} at={item.at} href={`/personal/records?${new URLSearchParams({...Object.fromEntries(params),record:item.scale.id})}`} />
                  ) : item.supplement ? (
                    <RecordEntry
                      key={item.id}
                      item={item.supplement}
                      open={!!openIds[item.id]}
                      onToggle={() => setOpenIds((s) => ({ ...s, [item.id]: !s[item.id] }))}
                      onChanged={() => void reload()}
                    />
                  ) : null)}
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
