import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Sparkles, Loader2, Camera, ChevronDown, FolderOpen, Mic, Image as ImageIcon, X } from 'lucide-react';
import { adminSearch, fetchRetrievalMedia } from '../../services/mockApi';
import AdminAlertBadge from '../components/AdminAlertBadge';
import CameraCapture from '../../components/CameraCapture';
import ThemeHistogram from '../../components/ThemeHistogram';
import MultimodalFlowTabs from '../components/MultimodalFlowTabs';
import { useAudioRecorder } from '../../hooks/useAudioRecorder';
import { toCorpusWavFile } from '../../utils/audioRecorder';
import type { RetrievalResult } from '../data/adminMockData';
import { corpusRecords } from '../../data/corpusRecords';

const LEVEL_NAME: Record<string, string> = { green: '稳定', yellow: '关注', orange: '警告', red: '高危' };
const LEVEL_PILL: Record<string, string> = {
  green: 'bg-success-50 text-success-600', yellow: 'bg-warning-50 text-warning-600',
  orange: 'bg-orange-50 text-orange-600', red: 'bg-danger-50 text-danger-600',
};

interface RagReport {
  summary: string;
  sections?: { title: string; content: string }[];
}

export default function AdminRetrieval() {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');
  const [loading, setLoading] = useState(false);
  const [shown, setShown] = useState(20);
  const [results, setResults] = useState<RetrievalResult[] | null>(null);
  const [report, setReport] = useState<RagReport | null>(null);
  // 查询模态与媒体：后端支持文本 / 图像 / 语音三种查询，这里补齐入口
  const [modality, setModality] = useState<'text' | 'image' | 'audio'>('text');
  const [media, setMedia] = useState<{ name: string; base64: string } | null>(null);
  const [mediaError, setMediaError] = useState('');
  /** 现场拍照（摄像头）：拍完与文件选择走同一条 pickMedia 链路 */
  const [cameraOpen, setCameraOpen] = useState(false);
  /** 图像查询下拉：从文件选择 / 现场拍照 */
  const [imgMenuOpen, setImgMenuOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const busy = useRef(false);
  const mediaVersion = useRef(0);
  const recorder = useAudioRecorder((file) => { void pickMedia('audio', file); });

  /*
   * 结果条目里的「数据集样本媒体」加载状态（与个人端检索页同一套口径）。
   *
   * 后端在每条命中里只返回**缩略图**的 data URL（图像→48×48 灰度、语音→梅尔频谱），
   * 原始文件要另调 /api/retrieval/media/{unit_id} 才拿得到：
   *   · 语音 → 原始 wav，给 <audio> 播放
   *   · 图像 → 原图 jpg，给放大弹窗看
   * 这里按 unit_id 缓存，避免重复请求。
   */
  const [unitMediaUrls, setUnitMediaUrls] = useState<Record<string, string>>({});
  const [unitMediaLoading, setUnitMediaLoading] = useState<Record<string, boolean>>({});
  const [unitMediaError, setUnitMediaError] = useState<Record<string, string>>({});
  const [zoomUnit, setZoomUnit] = useState<{ id: string; url: string; file?: string } | null>(null);

  /** 取某条命中的原始媒体（语音可播放 / 图像可放大） */
  const loadUnitMedia = async (unitId: string): Promise<string | null> => {
    const cached = unitMediaUrls[unitId];
    if (cached) return cached;
    if (unitMediaLoading[unitId]) return null;
    setUnitMediaLoading((s) => ({ ...s, [unitId]: true }));
    try {
      const payload = await fetchRetrievalMedia(unitId);
      setUnitMediaUrls((s) => ({ ...s, [unitId]: payload.media }));
      return payload.media;
    } catch (e) {
      setUnitMediaError((s) => ({
        ...s,
        [unitId]: e instanceof Error ? e.message : '媒体加载失败',
      }));
      return null;
    } finally {
      setUnitMediaLoading((s) => ({ ...s, [unitId]: false }));
    }
  };

  /** 查看原图：优先取原始 jpg，取不到则退回后端给的缩略图 */
  const openUnitImage = async (result: RetrievalResult) => {
    const url = (await loadUnitMedia(result.id)) ?? result.media ?? null;
    if (!url) return;
    setZoomUnit({ id: result.id, url, file: result.mediaMeta?.file });
  };

  /** 选择图像 / 语音文件：读成 base64（去掉 dataURL 前缀）后随查询提交 */
  const pickMedia = async (kind: 'image' | 'audio', file: File | null) => {
    const version = ++mediaVersion.current;
    setMediaError('');
    if (!file) return;
    setMedia(null);
    setModality('text');
    if (file.size > 8 * 1024 * 1024 || !file.size) {
      setMediaError('请选择大小在 0～8MB 之间的文件');
      return;
    }
    setReading(true);
    try {
      let ready = file;
      if (kind === 'image') {
        if (!/\.(png|jpe?g|bmp|webp)$/i.test(file.name)) throw new Error('图像支持 PNG、JPG、BMP、WebP');
        const bitmap = await createImageBitmap(file);
        bitmap.close();
      } else {
        ready = await toCorpusWavFile(file, file.name.replace(/\.[^.]+$/, '') + '.wav');
      }
      if (ready.size > 8 * 1024 * 1024) throw new Error('转换后的音频超过 8MB，请选择较短片段');
      const raw = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('文件读取失败，请重试'));
        reader.readAsDataURL(ready);
      });
      if (version !== mediaVersion.current) return;
      setMedia({ name: ready.name, base64: raw.split('base64,')[1] });
      setModality(kind);
    } catch (error) {
      if (version === mediaVersion.current) setMediaError(error instanceof Error ? error.message : '媒体处理失败');
    } finally {
      if (version === mediaVersion.current) setReading(false);
    }
  };

  const handleSearch = async (override?: string) => {
    const q = (override ?? query).trim();
    if (busy.current || reading || recorder.recording || (!q && !media)) return;
    busy.current = true;
    setLoading(true);
    setSearchError('');
    setResults(null);
    setReport(null);
    try {
      const res = await adminSearch(q, {
        modality,
        mediaBase64: media?.base64,
        mediaName: media?.name,
      });
      setResults(res.results as RetrievalResult[]);
      setReport(res.report as RagReport);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : '检索失败，请重试');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  /* 从「多模态采集」详情带过来的 ?q= → 自动检索一次 */
  const autoQuery = searchParams.get('q') ?? '';
  const lastAutoQuery = useRef<string | null>(null);
  useEffect(() => {
    if (!autoQuery || lastAutoQuery.current === autoQuery) return;
    lastAutoQuery.current = autoQuery;
    setQuery(autoQuery);
    void handleSearch(autoQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoQuery]);

  return (
    <div className="space-y-6">
      <MultimodalFlowTabs active="search" />
      <div className="ui-card p-5">
        <h3 className="font-semibold text-slate-800 mb-3">跨模态哈希检索（管理端）</h3>
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-40 flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch(); }}
              placeholder="输入关键词或案例特征..."
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          {/* 图像 / 语音查询入口（后端本就支持两种模态，此前前端只给了文本） */}
          <input
            id="admin-media-image"
            type="file"
            accept=".png,.jpg,.jpeg,.bmp,.webp"
            className="hidden"
            onChange={(e) => { void pickMedia('image', e.target.files?.[0] ?? null); e.target.value = ''; }}
          />
          <input
            id="admin-media-audio"
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => { void pickMedia('audio', e.target.files?.[0] ?? null); e.target.value = ''; }}
          />
          {/* 图像查询：一个按钮 + 两个动作（从文件选择 / 现场拍照）。
              以前两个并列按钮的选中态都看 modality === 'image'，
              选完图后两个同时高亮，像是两套功能都开着；合并成一个带下拉的入口。 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setImgMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={imgMenuOpen}
              title="上传图像或现场拍照，作为图像查询线索"
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                modality === 'image'
                  ? 'border-primary-500 bg-primary-50 text-primary-600'
                  : 'border-slate-200 text-slate-600 hover:border-primary-300'
              }`}
            >
              <ImageIcon className="h-4 w-4" />
              图像查询
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${imgMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {imgMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setImgMenuOpen(false)} />
                <div
                  role="menu"
                  aria-label="图像查询方式"
                  className="absolute left-0 top-full z-20 mt-1 w-40 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setImgMenuOpen(false);
                      document.getElementById('admin-media-image')?.click();
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    从文件选择
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setImgMenuOpen(false);
                      setCameraOpen(true);
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    现场拍照
                  </button>
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => document.getElementById('admin-media-audio')?.click()}
            className={`cursor-pointer rounded-lg border px-3 py-2.5 text-sm transition-colors ${
              modality === 'audio'
                ? 'border-primary-500 bg-primary-50 text-primary-600'
                : 'border-slate-200 text-slate-600 hover:border-primary-300'
            }`}
          >
            语音查询
          </button>
          <button
            onClick={() => void handleSearch()}
            disabled={loading || reading || recorder.recording || (!query.trim() && !media)}
            className="px-6 py-2.5 bg-primary-500 text-white rounded-lg hover:bg-primary-600 text-sm font-medium transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? '检索中...' : '检索'}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          {recorder.recording ? <>
            <span role="status">正在录音 {recorder.seconds} 秒</span>
            <button type="button" onClick={recorder.stop} className="ui-button">停止并使用录音</button>
            <button type="button" onClick={recorder.cancel} className="ui-button">取消录音</button>
          </> : <button type="button" disabled={!recorder.supported || loading || reading} onClick={() => void recorder.start()} className="ui-button">录音查询</button>}
          {reading && <span role="status">正在读取并转换媒体…</span>}
          {recorder.error && <p role="alert" className="text-danger-600">{recorder.error}</p>}
          {searchError && <p role="alert" className="text-danger-600">检索失败：{searchError}，可以重新点击检索。</p>}
        </div>

        {(media || mediaError) && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            {media ? (
              <>
                <span className="rounded-full bg-primary-50 px-2.5 py-1 font-medium text-primary-600">
                  {modality === 'audio' ? '语音' : '图像'}查询：{media.name}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    mediaVersion.current += 1;
                    setReading(false);
                    setMedia(null);
                    setModality('text');
                  }}
                  className="cursor-pointer text-slate-500 hover:text-slate-700 hover:underline"
                >
                  清除，改回文本查询
                </button>
              </>
            ) : (
              <span className="text-danger-600">{mediaError}</span>
            )}
          </div>
        )}
      </div>

      {loading && (
        <div className="ui-card p-10 flex items-center justify-center gap-3 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
          <span className="text-sm">正在执行动态跨模态哈希检索...</span>
        </div>
      )}

      {!loading && results && (
        <>
          {/* 命中主题分布柱状图：一眼看出这批相似案例集中在哪些困扰主题上。
              数据来自检索结果的 tags 字段，不需要额外接口。 */}
          {results.length > 0 && (
            <ThemeHistogram hits={results} />
          )}

          <div className="ui-card divide-y divide-slate-100">
            {results.length === 0 && (
              <div className="px-5 py-12 text-center text-sm text-slate-400">
                没有找到相似案例。试试换一种描述，或把检索范围放宽到「全部模态」。
              </div>
            )}
            {results.map((result) => (
              <div key={result.id} className="p-5 hover:bg-slate-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{result.recordId ?? result.id}</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {result.date} · 相似度 {(result.similarity * 100).toFixed(0)}%
                      {result.modalityLabel && <> · {result.modalityLabel}</>}
                    </p>
                  </div>
                  <AdminAlertBadge level={result.alertLevel} size="sm" />
                </div>
                <p className="text-sm text-slate-600 mt-3">{result.summary}</p>

                {/* 数据集样本媒体：图像给缩略图+查看原图，语音给频谱缩略图+播放。
                    与个人端检索页同一套交互（后端 /api/retrieval/media/{unit_id}）。 */}
                {result.media && (
                  <div className="mt-3 flex items-start gap-3">
                    {result.mediaKind === 'speech_pcm16' ? (
                      <img
                        src={result.media}
                        alt="语音梅尔频谱"
                        className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 w-44 h-16 object-cover"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => void openUnitImage(result)}
                        title="点击查看原图"
                        className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden hover:border-primary-400 transition-colors"
                      >
                        <img
                          src={result.media}
                          alt="面部图像"
                          className="w-16 h-16 object-cover"
                          style={{ imageRendering: 'pixelated' }}
                        />
                      </button>
                    )}
                    <div className="min-w-0 text-xs space-y-1">
                      <p className="font-mono text-slate-600 break-all">
                        {result.mediaMeta?.file ?? '（媒体文件）'}
                      </p>
                      {result.mediaKind === 'speech_pcm16' ? (
                        <>
                          <p className="text-slate-400">
                            情绪 {result.mediaMeta?.emotion || '—'} · 说话人{' '}
                            {result.mediaMeta?.speaker || '—'}
                            {result.mediaMeta?.duration_sec
                              ? ` · ${result.mediaMeta.duration_sec}s`
                              : ''}
                          </p>
                          {unitMediaUrls[result.id] ? (
                            <audio
                              controls
                              autoPlay
                              src={unitMediaUrls[result.id]}
                              className="h-9 max-w-full"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => void loadUnitMedia(result.id)}
                              disabled={!!unitMediaLoading[result.id]}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-primary-200 bg-primary-50 text-primary-600 hover:bg-primary-100 disabled:opacity-60 transition-colors"
                            >
                              <Mic className="w-3.5 h-3.5" />
                              {unitMediaLoading[result.id] ? '加载中…' : '播放真实语音'}
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <p className="text-slate-400">
                            来源目录 {result.mediaMeta?.dir || '—'}
                          </p>
                          <button
                            type="button"
                            onClick={() => void openUnitImage(result)}
                            disabled={!!unitMediaLoading[result.id]}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-primary-200 bg-primary-50 text-primary-600 hover:bg-primary-100 disabled:opacity-60 transition-colors"
                          >
                            <ImageIcon className="w-3.5 h-3.5" />
                            {unitMediaLoading[result.id] ? '加载中…' : '查看原图'}
                          </button>
                        </>
                      )}
                      {unitMediaError[result.id] && (
                        <p className="text-danger-600">{unitMediaError[result.id]}</p>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs text-slate-400">哈希相似度:</span>
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-500 rounded-full"
                      style={{ width: `${result.similarity * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-primary-600">{(result.similarity * 100).toFixed(0)}%</span>
          </div>
        </div>
            ))}
          </div>

          {report && (
            <div className="ui-card p-5">
              <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary-600" />
                RAG 智能报告
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">{report.summary}</p>
              {report.sections?.map((section, i) => (
                <div key={i} className="mt-4">
                  <h4 className="text-sm font-medium text-slate-700 mb-1">{section.title}</h4>
                  <p className="text-sm text-slate-500 leading-relaxed">{section.content}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!loading && !results && (
        /* 空状态不再只有一张图标：把语料库的真实记录列出来，
           管理员可以直接点一条试检索 —— 和个人端检索页同一套做法。
           管理端看得更"横"：带主题标签与风险等级，便于按类别挑样本。 */
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-800">语料库记录</h2>
              <p className="mt-1 text-xs text-slate-500">
                共 {corpusRecords.length} 条真实语料，每条含文本 / 语音 / 图像三个单元。
                点一条把它填进检索框。
              </p>
            </div>
            <span className="text-xs tabular-nums text-slate-400">
              已显示 {Math.min(shown, corpusRecords.length)} / {corpusRecords.length}
            </span>
          </div>
          <ul className="mt-4 grid gap-2">
            {corpusRecords.slice(0, shown).map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setQuery(r.text)}
                  className="w-full rounded-lg border border-slate-100 p-3.5 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/40"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-xs">
                      <span className="font-medium tabular-nums text-slate-600">{r.id}</span>
                      <span className="tabular-nums text-slate-400">{r.date}</span>
                      {r.context && <span className="text-slate-400">· {r.context}</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="flex flex-wrap gap-1">
                        {r.themes.map((t) => (
                          <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                            {t}
                          </span>
                        ))}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_PILL[r.level]}`}>
                        {LEVEL_NAME[r.level]}
                      </span>
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-6 text-slate-600">{r.text}</p>
                </button>
              </li>
            ))}
          </ul>
          {shown < corpusRecords.length && (
            <button
              type="button"
              onClick={() => setShown((n) => n + 20)}
              className="ui-button mt-3 w-full"
            >
              显示更多（还有 {corpusRecords.length - shown} 条）
            </button>
          )}
        </div>
      )}

      {/* 现场拍照：拍完与"图像查询"走同一条 pickMedia 链路 */}
      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => pickMedia('image', file)}
      />

      {/* 原图放大：点缩略图或「查看原图」时打开，取的是数据集里的真实原图 */}
      {zoomUnit && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-6"
          onClick={() => setZoomUnit(null)}
        >
          <div
            className="bg-white rounded-xl p-4 w-full max-w-md shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">样本原图</p>
                <p className="mt-0.5 truncate font-mono text-xs text-slate-400">
                  {zoomUnit.file ?? zoomUnit.id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setZoomUnit(null)}
                className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                aria-label="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={zoomUnit.url}
              alt="样本原图"
              className="mt-3 w-full rounded-lg border border-slate-200 bg-slate-50"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
