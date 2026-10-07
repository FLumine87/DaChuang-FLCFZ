import { useRef, useState } from 'react';
import {
  Hash,
  Image as ImageIcon,
  Loader2,
  Mic,
  Search,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { fetchRetrievalMedia, search } from '@shared/services/mockApi';
import type { RetrievalIndexInfo, RetrievalResult } from '@shared/data/mockData';
import AlertBadge from '@shared/components/AlertBadge';
import { useAudioRecorder } from '@shared/hooks/useAudioRecorder';
import { toCorpusWavFile } from '@shared/utils/audioRecorder';
import { Banner, Card, Chip, EmptyState, PrimaryButton } from '../components/ui';
import { base64ToFile, fileToBase64, pickImage } from '../platform/native';
import { getMode } from '../platform/mode';

type Modality = 'text' | 'image' | 'audio';
type Scope = 'all' | 'text' | 'audio' | 'image';

interface RagReport {
  summary: string;
  sections?: { title: string; content: string }[];
  recommendations?: string[];
}

const MODALITY_LABEL: Record<string, string> = {
  text: '文本',
  audio: '语音',
  image: '图像',
  multimodal: '多模态',
};

const SOURCE_LABEL: Record<string, string> = {
  'corpus-real': '真实数据集',
  corpus: '合成语料',
  db: '业务库',
  seedfile: '种子库',
  demo: '演示数据',
};

export default function RetrievalPage() {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [modality, setModality] = useState<Modality>('text');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<RetrievalResult[] | null>(null);
  const [report, setReport] = useState<RagReport | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [indexInfo, setIndexInfo] = useState<RetrievalIndexInfo | null>(null);
  const [error, setError] = useState('');

  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [mediaLoading, setMediaLoading] = useState<Record<string, boolean>>({});
  const [zoom, setZoom] = useState<string | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const setMediaFileAndPreview = (file: File, kind: 'image' | 'audio') => {
    setMediaFile(file);
    setModality(kind);
    setScope(kind);
    if (kind === 'image') setMediaPreview(URL.createObjectURL(file));
    else setMediaPreview(null);
    setError('');
  };

  const recorder = useAudioRecorder((file) => setMediaFileAndPreview(file, 'audio'));

  const clearMedia = () => {
    setMediaFile(null);
    setMediaPreview(null);
    setModality('text');
    setScope('all');
  };

  const chooseImage = async () => {
    const native = await pickImage();
    if (native) {
      const ext = native.name.split('.').pop() || 'jpeg';
      setMediaFileAndPreview(
        base64ToFile(native.base64, native.name, `image/${ext === 'jpg' ? 'jpeg' : ext}`),
        'image',
      );
      setMediaPreview(native.dataUrl);
      return;
    }
    imageInputRef.current?.click();
  };

  const pickAudioFile = async (file: File) => {
    try {
      const wav = await toCorpusWavFile(file, `${file.name.replace(/\.[^.]+$/, '')}.wav`);
      setMediaFileAndPreview(wav, 'audio');
    } catch {
      setError('无法解析该音频，请换一种格式或改用「直接录音」');
    }
  };

  const canSearch = modality === 'text' ? !!query.trim() : !!mediaFile;

  const runSearch = async (scopeOverride?: Scope) => {
    if (!canSearch) return;
    const effScope = scopeOverride ?? scope;
    setLoading(true);
    setResults(null);
    setReport(null);
    setShowReport(false);
    setIndexInfo(null);
    setError('');
    try {
      let mediaBase64: string | null = null;
      if (modality !== 'text' && mediaFile) mediaBase64 = await fileToBase64(mediaFile);
      const res = await search(query, {
        modality,
        modalityFilter: effScope === 'all' ? undefined : effScope,
        mediaBase64,
        mediaName: mediaFile?.name,
      });
      setResults((res.results ?? []) as RetrievalResult[]);
      setReport((res.report ?? null) as RagReport | null);
      setIndexInfo((res.index ?? null) as RetrievalIndexInfo | null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '检索失败');
    } finally {
      setLoading(false);
    }
  };

  const loadMedia = async (unitId: string) => {
    if (mediaUrls[unitId]) return;
    setMediaLoading((s) => ({ ...s, [unitId]: true }));
    try {
      const payload = await fetchRetrievalMedia(unitId);
      setMediaUrls((s) => ({ ...s, [unitId]: payload.media }));
    } catch (e) {
      setError(e instanceof Error ? e.message : '媒体加载失败');
    } finally {
      setMediaLoading((s) => ({ ...s, [unitId]: false }));
    }
  };

  return (
    <div className="space-y-4">
      {/* 查询区 */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Hash className="w-4 h-4 text-emerald-600" />
          <p className="text-[14px] font-semibold text-slate-800">动态跨模态哈希检索</p>
        </div>
        <p className="text-[12px] text-slate-400 leading-5">
          输入症状描述，或上传一张面部图像 / 一段语音，系统检索相似历史模式并给出 RAG 风险解释。
        </p>

        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/bmp,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) setMediaFileAndPreview(f, 'image');
          }}
        />
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void pickAudioFile(f);
          }}
        />

        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={3}
          placeholder={
            modality === 'text'
              ? '例如：最近入睡困难、白天无力、对课程提不起兴趣……'
              : '可选：补充一句文字描述'
          }
          className="w-full px-3 py-3 rounded-xl border border-slate-200 text-[14px] leading-6 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />

        <div className="flex gap-2">
          <button
            onClick={() => void chooseImage()}
            className={`flex-1 min-h-[44px] rounded-xl border text-[13px] inline-flex items-center justify-center gap-1.5 ${
              modality === 'image'
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 text-slate-500'
            }`}
          >
            <ImageIcon className="w-4 h-4" />
            图像线索
          </button>
          <button
            onClick={() => (recorder.recording ? recorder.stop() : void recorder.start())}
            disabled={!recorder.supported && !recorder.recording}
            className={`flex-1 min-h-[44px] rounded-xl border text-[13px] inline-flex items-center justify-center gap-1.5 disabled:opacity-40 ${
              recorder.recording
                ? 'border-danger-300 bg-danger-50 text-danger-600'
                : modality === 'audio'
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 text-slate-500'
            }`}
          >
            {recorder.recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            {recorder.recording ? `停止 ${recorder.seconds}s` : '语音线索'}
          </button>
        </div>

        {!recorder.recording && (
          <button
            onClick={() => audioInputRef.current?.click()}
            className="w-full min-h-[38px] text-[12px] text-slate-400 active:opacity-60"
          >
            或从文件选择音频
          </button>
        )}

        {recorder.error && <Banner kind="error">{recorder.error}</Banner>}

        {mediaFile && !recorder.recording && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
            {modality === 'image' && mediaPreview ? (
              <img src={mediaPreview} alt="" className="w-11 h-11 rounded-lg object-cover" />
            ) : (
              <Mic className="w-5 h-5 text-emerald-600" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-emerald-800 truncate">
                {modality === 'image' ? '图像线索' : '语音线索'}：{mediaFile.name}
              </p>
              <p className="text-[11px] text-emerald-600">
                {(mediaFile.size / 1024).toFixed(0)} KB
              </p>
            </div>
            <button
              onClick={clearMedia}
              className="w-8 h-8 flex items-center justify-center rounded-lg active:bg-emerald-100"
            >
              <X className="w-4 h-4 text-emerald-600" />
            </button>
          </div>
        )}

        <div className="flex gap-2 overflow-x-auto hide-scrollbar">
          {(
            [
              ['all', '全部模态'],
              ['text', '仅文本'],
              ['audio', '仅语音'],
              ['image', '仅图像'],
            ] as [Scope, string][]
          ).map(([v, label]) => (
            <Chip
              key={v}
              active={scope === v}
              onClick={() => {
                setScope(v);
                if (canSearch) void runSearch(v);
              }}
            >
              {label}
            </Chip>
          ))}
        </div>

        <PrimaryButton onClick={() => void runSearch()} disabled={loading || !canSearch} className="!bg-emerald-600">
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              检索中…
            </span>
          ) : (
            <span className="inline-flex items-center gap-2">
              <Search className="w-4 h-4" />
              开始检索
            </span>
          )}
        </PrimaryButton>

        {getMode() === 'mock' && (
          <p className="text-[11px] text-slate-400 leading-5">
            当前为离线演示：检索结果为内置示例；真实语料与真实媒体需切到「连接实机」。
          </p>
        )}
      </Card>

      {error && <Banner kind="error">{error}</Banner>}

      {loading && (
        <Card className="p-8 text-center">
          <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mx-auto" />
          <p className="text-[13px] text-slate-500 mt-3">正在编码特征并计算哈希距离…</p>
        </Card>
      )}

      {!loading && results && (
        <>
          <div className="flex items-center justify-between px-1">
            <p className="text-[13px] text-slate-500">
              找到 <span className="font-semibold text-slate-700">{results.length}</span> 个相似模式
            </p>
            {report && (
              <button
                onClick={() => setShowReport((v) => !v)}
                className="text-[13px] text-emerald-600 font-medium px-2 py-1 inline-flex items-center gap-1"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {showReport ? '收起报告' : 'RAG 报告'}
              </button>
            )}
          </div>

          {indexInfo && (
            <Card className="p-3">
              <p className="text-[11px] text-slate-400 leading-5">
                查询模态 {MODALITY_LABEL[indexInfo.query_modality ?? 'text'] ?? '文本'}
                {indexInfo.query_code_hex ? ` · 查询码 ${indexInfo.query_code_hex.slice(0, 8)}…` : ''}
                {indexInfo.query_themes?.length ? ` · 命中主题 ${indexInfo.query_themes.join('、')}` : ''}
                {typeof indexInfo.candidates === 'number' ? ` · 候选 ${indexInfo.candidates}/${indexInfo.index_size}` : ''}
                {indexInfo.data_source ? ` · 来源 ${SOURCE_LABEL[indexInfo.data_source] ?? indexInfo.data_source}` : ''}
              </p>
            </Card>
          )}

          {showReport && report && (
            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                <p className="text-[14px] font-semibold text-slate-800">RAG 智能分析报告</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[13px] text-slate-700 leading-6">{report.summary}</p>
              </div>
              {(report.sections ?? []).map((s, i) => (
                <div key={i}>
                  <p className="text-[13px] font-medium text-slate-800 mb-1">{s.title}</p>
                  <p className="text-[13px] text-slate-600 leading-6">{s.content}</p>
                </div>
              ))}
              {(report.recommendations ?? []).length > 0 && (
                <div className="space-y-2 pt-1">
                  {(report.recommendations ?? []).map((r, i) => (
                    <div key={i} className="flex items-start gap-2.5 p-3 rounded-xl bg-warning-50">
                      <span className="w-5 h-5 rounded-full bg-warning-500 text-white text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span className="text-[13px] text-slate-700 leading-6">{r}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {results.length === 0 ? (
            <Card>
              <EmptyState title="没有命中相似模式" hint="换一种描述，或放宽检索范围试试" />
            </Card>
          ) : (
            <div className="space-y-2.5">
              {results.map((r) => (
                <Card key={r.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[14px] font-medium text-slate-800">
                          {r.recordId ?? r.id}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                          {r.modalityLabel ?? MODALITY_LABEL[r.modality] ?? r.modality}
                        </span>
                        {r.crossModal && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-50 text-primary-600">
                            跨模态
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">{r.date}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[17px] font-bold text-emerald-600">
                        {Math.round((r.similarity ?? 0) * 100)}%
                      </p>
                      <div className="mt-0.5">
                        <AlertBadge level={r.alertLevel} size="sm" />
                      </div>
                    </div>
                  </div>

                  <p className="text-[13px] text-slate-600 leading-6 mt-2">{r.summary}</p>

                  {(r.tags ?? []).length > 0 && (
                    <div className="flex gap-1.5 flex-wrap mt-2">
                      {r.tags.map((t) => (
                        <span
                          key={t}
                          className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 媒体：图像缩略 / 语音频谱 + 播放 */}
                  {r.media && (
                    <div className="flex items-start gap-3 mt-3">
                      {r.mediaKind === 'speech_pcm16' ? (
                        <img
                          src={r.media}
                          alt="语音梅尔频谱"
                          className="w-32 h-14 rounded-lg border border-slate-200 bg-slate-50 object-cover shrink-0"
                        />
                      ) : (
                        <button onClick={() => void loadMedia(r.id).then(() => setZoom(mediaUrls[r.id] ?? r.media ?? null))}>
                          <img
                            src={r.media}
                            alt="面部图像"
                            className="w-14 h-14 rounded-lg border border-slate-200 object-cover"
                            style={{ imageRendering: 'pixelated' }}
                          />
                        </button>
                      )}
                      <div className="min-w-0 flex-1 text-[11px] text-slate-400 space-y-1">
                        <p className="font-mono truncate">{r.mediaMeta?.file ?? '（媒体）'}</p>
                        {r.mediaKind === 'speech_pcm16' ? (
                          <>
                            <p className="truncate">
                              情绪 {r.mediaMeta?.emotion || '—'} · 说话人 {r.mediaMeta?.speaker || '—'}
                            </p>
                            {mediaUrls[r.id] ? (
                              <audio controls src={mediaUrls[r.id]} className="w-full h-8" />
                            ) : (
                              <button
                                onClick={() => void loadMedia(r.id)}
                                disabled={!!mediaLoading[r.id]}
                                className="text-emerald-600 font-medium disabled:opacity-50"
                              >
                                {mediaLoading[r.id] ? '加载中…' : '播放真实语音'}
                              </button>
                            )}
                          </>
                        ) : (
                          <p className="truncate">来源目录 {r.mediaMeta?.dir || '—'}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {(r.explain?.shared_themes?.length ?? 0) > 0 && (
                    <p className="text-[11px] text-slate-500 mt-2.5">
                      为什么相似：共同命中主题{' '}
                      <span className="text-emerald-600 font-medium">
                        {r.explain!.shared_themes!.join('、')}
                      </span>
                    </p>
                  )}

                  {r.explain && (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400 mt-1.5">
                      {typeof r.explain.hamming_distance === 'number' && (
                        <span>汉明距离 {r.explain.hamming_distance}/64</span>
                      )}
                      {typeof r.explain.asymmetric_score === 'number' && (
                        <span>非对称得分 {r.explain.asymmetric_score.toFixed(3)}</span>
                      )}
                      {typeof r.explain.window === 'number' && <span>时间窗 {r.explain.window}</span>}
                      {r.dataSource && <span>来源 {SOURCE_LABEL[r.dataSource] ?? r.dataSource}</span>}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {!loading && !results && !error && (
        <Card>
          <EmptyState
            icon={<Search className="w-10 h-10" />}
            title="输入状态描述，开始检索"
            hint="支持文本、语音、图像三种模态输入"
          />
        </Card>
      )}

      {zoom && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/80 flex items-center justify-center p-6"
          onClick={() => setZoom(null)}
        >
          <img
            src={zoom}
            alt="原图"
            className="max-w-full max-h-[70vh] rounded-xl bg-white"
            style={{ imageRendering: 'pixelated' }}
          />
        </div>
      )}
    </div>
  );
}
