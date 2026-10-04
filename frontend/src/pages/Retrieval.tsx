import { useRef, useState } from 'react';
import {
  Search,
  FileText,
  Mic,
  Image,
  Sparkles,
  ArrowRight,
  Hash,
  Loader2,
  X,
  FolderOpen,
  Square,
} from 'lucide-react';
import { search, fetchRetrievalMedia } from '../services/mockApi';
import { userProfile } from '../data/mockData';
import type { RetrievalResult, RetrievalIndexInfo } from '../data/mockData';
import AlertBadge from '../components/AlertBadge';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { toCorpusWavFile } from '../utils/audioRecorder';

const modalityIcons = {
  text: FileText,
  audio: Mic,
  image: Image,
  multimodal: Sparkles,
};

const modalityLabels = {
  text: '文本',
  audio: '语音',
  image: '图像',
  multimodal: '多模态',
};

/** 索引数据来源 -> 中文标注（真实数据集 / 合成语料 / 业务库 ...） */
const SOURCE_LABELS: Record<string, string> = {
  'corpus-real': '真实数据集',
  corpus: '合成语料',
  db: '业务库',
  seedfile: '种子库',
  demo: '演示数据',
};

type QueryModality = 'text' | 'image' | 'audio';

/** 读取本地文件为纯 base64（后端只接受不含 data URL 前缀的内容） */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || '');
      const comma = raw.indexOf(',');
      resolve(comma >= 0 ? raw.slice(comma + 1) : raw);
    };
    reader.onerror = () => reject(new Error('文件读取失败，请重试'));
    reader.readAsDataURL(file);
  });
}

interface RagReport {
  summary: string;
  riskLevel: string;
  sections: { title: string; content: string }[];
  recommendations: string[];
}

export default function Retrieval() {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'text' | 'audio' | 'image'>('all');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<RetrievalResult[] | null>(null);
  const [report, setReport] = useState<RagReport | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [indexInfo, setIndexInfo] = useState<RetrievalIndexInfo | null>(null);
  // 查询模态：文本直接检索；图像/语音需先选文件（本地预览，提交时转 base64）
  const [queryModality, setQueryModality] = useState<QueryModality>('text');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  // 真实媒体按需加载：unit_id -> 原始文件的 data URL（语音可播放 / 图像可放大）
  // 不随检索响应下发：语音平均 124KB，内联会让每次检索的响应体膨胀数百 KB
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [mediaLoading, setMediaLoading] = useState<Record<string, boolean>>({});
  const [mediaError, setMediaError] = useState<Record<string, string>>({});
  const [zoomImage, setZoomImage] = useState<{
    url: string;
    file?: string;
    dir?: string;
  } | null>(null);

  /** 取某单元的真实媒体文件；成功返回 data URL，失败返回 null 并记录错误 */
  const loadMedia = async (unitId: string): Promise<string | null> => {
    const cached = mediaUrls[unitId];
    if (cached) return cached;
    if (mediaLoading[unitId]) return null;
    setMediaLoading((s) => ({ ...s, [unitId]: true }));
    try {
      const payload = await fetchRetrievalMedia(unitId);
      setMediaUrls((s) => ({ ...s, [unitId]: payload.media }));
      return payload.media;
    } catch (e) {
      setMediaError((s) => ({
        ...s,
        [unitId]: e instanceof Error ? e.message : '媒体加载失败',
      }));
      return null;
    } finally {
      setMediaLoading((s) => ({ ...s, [unitId]: false }));
    }
  };

  const openOriginalImage = async (result: RetrievalResult) => {
    const url = (await loadMedia(result.id)) ?? result.media ?? null;
    if (!url) return;
    setZoomImage({ url, file: result.mediaMeta?.file, dir: result.mediaMeta?.dir });
  };

  const pickMedia = (modality: 'image' | 'audio', file?: File | null) => {
    if (!file) return;
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaFile(file);
    setMediaPreview(URL.createObjectURL(file));
    setQueryModality(modality);
    // 图像/语音查询默认做「同模态近邻」：这是"最相似"唯一有严格定义的场景
    // （同一模态的码空间可比）。想看跨模态结果可手动切回「全部模态」。
    setScope(modality);
    setError(null);
  };

  /** 音频查询统一转成 24414Hz 单声道 WAV。
   *  后端语音特征只解析 PCM WAV，且语料全部是该采样率；
   *  手机录音常见的 m4a/mp3 直接上传会解析失败，先转码再走同一条链路。 */
  const pickAudioFile = async (file: File) => {
    try {
      const wav = await toCorpusWavFile(file, `${file.name.replace(/\.[^.]+$/, '')}.wav`);
      pickMedia('audio', wav);
    } catch {
      setError('无法解析该音频文件，请换一种格式或改用「直接录音」');
    }
  };

  const clearMedia = () => {
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaFile(null);
    setMediaPreview(null);
    setQueryModality('text');
    setScope('all');
  };

  // 麦克风按钮的下拉菜单：从文件选 / 直接录音
  const [micMenuOpen, setMicMenuOpen] = useState(false);
  const recorder = useAudioRecorder((file) => {
    pickMedia('audio', file);
    setMicMenuOpen(false);
  });

  const canSearch = queryModality === 'text' ? !!query.trim() : !!mediaFile;

  /** 执行检索。scopeOverride 用于「点范围即检索」：setScope 是异步的，
   *  同一轮事件里读到的 scope 还是旧值，所以显式传入本次要用的范围。 */
  const handleSearch = async (scopeOverride?: typeof scope) => {
    if (!canSearch) return;
    const effScope = scopeOverride ?? scope;
    setLoading(true);
    setResults(null);
    setReport(null);
    setShowReport(false);
    setError(null);
    setIndexInfo(null);
    try {
      let mediaBase64: string | null = null;
      if (queryModality !== 'text' && mediaFile) {
        mediaBase64 = await fileToBase64(mediaFile);
      }
      const res = await search(query, {
        modality: queryModality,
        modalityFilter: effScope === 'all' ? undefined : effScope,
        mediaBase64,
        mediaName: mediaFile?.name,
      });
      setResults((res.results ?? []) as RetrievalResult[]);
      setReport((res.report ?? null) as RagReport | null);
      setIndexInfo((res.index ?? null) as RetrievalIndexInfo | null);
    } catch (err) {
      setError((err as Error).message || '检索失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <Hash className="w-5 h-5 text-primary-600" />
          动态跨模态哈希检索
        </h3>
        <p className="text-sm text-slate-400 mb-4">
          输入你的症状描述，或上传一段面部图像 / 语音片段，系统将检索与你当前状态相似的历史模式并触发 RAG 风险解释
        </p>
        {/* 隐藏的文件选择器：由下方麦克风 / 图像按钮触发 */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/bmp,image/webp"
          className="hidden"
          onChange={(e) => {
            pickMedia('image', e.target.files?.[0]);
            e.target.value = '';
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
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder={
                queryModality === 'text'
                  ? '例如：最近入睡困难、白天无力、对课程提不起兴趣...'
                  : '可选：补充一句文字描述，帮助解释检索理由'
              }
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <div className="relative">
            <button
              onClick={() => setMicMenuOpen((v) => !v)}
              disabled={recorder.recording}
              title="上传语音文件，或直接录音"
              className={`px-3 py-2.5 border rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed ${
                recorder.recording
                  ? 'border-danger-500 bg-danger-50 text-danger-600'
                  : queryModality === 'audio'
                    ? 'border-primary-300 bg-primary-50 text-primary-600'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {recorder.recording ? (
                <span className="block w-4 h-4 rounded-sm bg-danger-500 animate-pulse" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>
            {micMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMicMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
                  <button
                    onClick={() => {
                      setMicMenuOpen(false);
                      audioInputRef.current?.click();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    从文件选择
                  </button>
                  <button
                    onClick={() => recorder.start()}
                    disabled={!recorder.supported}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Mic className="w-3.5 h-3.5" />
                    直接录音
                  </button>
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => imageInputRef.current?.click()}
            title="上传一张面部图像作为查询线索"
            className={`px-3 py-2.5 border rounded-lg transition-colors cursor-pointer ${
              queryModality === 'image'
                ? 'border-primary-300 bg-primary-50 text-primary-600'
                : 'border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            <Image className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleSearch()}
            disabled={loading || !canSearch}
            className="px-6 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? '检索中...' : '开始检索'}
          </button>
        </div>

        {(recorder.recording || recorder.error) && (
          <div className="mt-3 space-y-2">
            {recorder.recording && (
              <div className="flex items-center gap-3 p-2.5 bg-danger-50 border border-danger-500 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-danger-500 animate-pulse shrink-0" />
                <span className="text-sm text-danger-600 font-medium shrink-0">
                  正在录音 {recorder.seconds}s
                </span>
                <span className="text-xs text-slate-500 flex-1">
                  最长 60 秒；录完点「停止并上传」，会自动转成 24414Hz 单声道 WAV
                </span>
                <button
                  onClick={recorder.stop}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-danger-600 text-white rounded-md text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer"
                >
                  <Square className="w-3 h-3" />
                  停止并上传
                </button>
                <button
                  onClick={recorder.cancel}
                  className="shrink-0 px-2.5 py-1.5 border border-slate-200 text-slate-500 rounded-md text-xs hover:bg-white transition-colors cursor-pointer"
                >
                  取消
                </button>
              </div>
            )}
            {recorder.error && <p className="text-xs text-danger-600">{recorder.error}</p>}
          </div>
        )}

        {mediaFile && (
          <div className="mt-3 flex items-center gap-3 p-2.5 bg-primary-50 border border-primary-100 rounded-lg">
            {queryModality === 'image' ? (
              <img src={mediaPreview ?? undefined} alt="查询图像" className="w-12 h-12 rounded object-cover border border-primary-200" />
            ) : (
              <div className="w-12 h-12 rounded bg-white border border-primary-200 flex items-center justify-center">
                <Mic className="w-5 h-5 text-primary-600" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-medium text-primary-700 truncate">
                {queryModality === 'image' ? '图像线索' : '语音线索'}：{mediaFile.name}
              </p>
              <p className="text-xs text-slate-400">
                {(mediaFile.size / 1024).toFixed(0)} KB · 提交后由后端抽取模态特征编码为哈希码
              </p>
            </div>
            <button
              onClick={clearMedia}
              title="移除媒体线索，改回文本检索"
              className="ml-auto p-1.5 rounded text-slate-400 hover:text-slate-600 hover:bg-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-slate-100">
          <span className="text-xs text-slate-400">检索范围</span>
          {([
            ['all', '全部模态'],
            ['text', '仅文本'],
            ['audio', '仅语音线索'],
            ['image', '仅图像线索'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => {
                setScope(value);
                // 点范围即检索：省掉"切范围 -> 再点开始检索"两步。
                // 没有可检索的输入（无文本且无媒体）时只切换范围，不报错。
                if (canSearch) handleSearch(value);
              }}
              className={`px-3 py-1 rounded-full text-xs border transition-colors cursor-pointer ${
                scope === value
                  ? 'bg-primary-50 border-primary-200 text-primary-600 font-medium'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
          <span className="text-xs text-slate-400 ml-auto">
            {queryModality !== 'text' && scope === queryModality
              ? '同模态近邻：返回与上传线索最相似的真实图像 / 语音（同模态码空间可直接比较）'
              : '检索范围决定命中单元的类型：选「全部模态」时，一段文字也能命中真实面部图像 / 语音单元（跨模态检索）'}
          </span>
        </div>
      </div>

      {loading && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 shadow-sm flex flex-col items-center gap-4 text-slate-400">
          <Loader2 className="w-10 h-10 animate-spin text-primary-500" />
          <div className="text-center">
            <p className="text-sm font-medium text-slate-600">动态跨模态哈希检索中</p>
            <p className="text-xs mt-1">正在编码特征向量并计算哈希距离...</p>
          </div>
        </div>
      )}

      {!loading && results && (
        <>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h3 className="font-semibold text-slate-800">
                  检索结果 <span className="text-sm font-normal text-slate-400">（找到 {results.length} 个高相似模式）</span>
                </h3>
                {indexInfo && (
                  <p className="text-xs text-slate-400 mt-1">
                    查询模态 {modalityLabels[(indexInfo.query_modality ?? 'text') as keyof typeof modalityLabels] ?? '文本'}
                    {indexInfo.query_media ? '（媒体文件）' : ''}
                    {' · '}查询码 <span className="font-mono">{indexInfo.query_code_hex?.slice(0, 8)}…</span>
                    {' · '}命中主题 {indexInfo.query_themes?.join('、') || '—'}
                    {' · '}候选 {indexInfo.candidates}/{indexInfo.index_size}
                    {' · '}探测桶 {indexInfo.keys_probed}
                    {' · '}{indexInfo.scoring === 'asymmetric' ? '非对称距离' : '汉明距离'}排序
                    {indexInfo.data_source && (
                      <>
                        {' · '}数据来源 {SOURCE_LABELS[indexInfo.data_source] ?? indexInfo.data_source}
                      </>
                    )}
                  </p>
                )}
                {indexInfo?.dataset && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    检索语料：{indexInfo.dataset}（真实数据，按风险类别配对三模态）
                  </p>
                )}
              </div>
              <button
                onClick={() => setShowReport((v) => !v)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium transition-colors cursor-pointer"
              >
                <Sparkles className="w-4 h-4" /> {showReport ? '收起报告' : 'RAG智能分析'}
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {results.map((result) => {
                const Icon = modalityIcons[result.modality] ?? FileText;
                const modalityLabel = modalityLabels[result.modality] ?? (result.modality || '文本');
                return (
                  <div key={result.id} className="p-5 hover:bg-slate-50 transition-colors">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center">
                          <Icon className="w-4 h-4 text-primary-600" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-800">{result.recordId ?? result.id}</span>
                            <span className="text-xs px-2 py-0.5 bg-slate-100 rounded text-slate-500">
                              {result.modalityLabel ?? modalityLabel}
                            </span>
                            {result.crossModal && (
                              <span className="text-xs px-2 py-0.5 bg-primary-50 text-primary-600 rounded">
                                跨模态命中
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">{result.date}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <AlertBadge level={result.alertLevel} size="sm" />
                        <div className="text-right">
                          <p className="text-lg font-bold text-primary-600">
                            {(result.similarity * 100).toFixed(0)}%
                          </p>
                          <p className="text-xs text-slate-400">相似度</p>
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-slate-600 mt-2">{result.summary}</p>
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
                            onClick={() => openOriginalImage(result)}
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
                                {result.mediaMeta?.speaker || '—'} · 发音{' '}
                                {result.mediaMeta?.word || '—'}
                                {result.mediaMeta?.duration_sec
                                  ? ` · ${result.mediaMeta.duration_sec}s`
                                  : ''}
                              </p>
                              {mediaUrls[result.id] ? (
                                <audio
                                  controls
                                  autoPlay
                                  src={mediaUrls[result.id]}
                                  className="h-9 max-w-full"
                                />
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => loadMedia(result.id)}
                                  disabled={!!mediaLoading[result.id]}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-primary-200 bg-primary-50 text-primary-600 hover:bg-primary-100 disabled:opacity-60 transition-colors"
                                >
                                  <Mic className="w-3.5 h-3.5" />
                                  {mediaLoading[result.id] ? '加载中…' : '播放真实语音'}
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
                                onClick={() => openOriginalImage(result)}
                                disabled={!!mediaLoading[result.id]}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-primary-200 bg-primary-50 text-primary-600 hover:bg-primary-100 disabled:opacity-60 transition-colors"
                              >
                                <Image className="w-3.5 h-3.5" />
                                {mediaLoading[result.id] ? '加载中…' : '查看原图'}
                              </button>
                            </>
                          )}
                          {mediaError[result.id] && (
                            <p className="text-danger-600">{mediaError[result.id]}</p>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2 mt-2">
                      {(result.tags ?? []).map((tag) => (
                        <span key={tag} className="text-xs px-2 py-0.5 bg-primary-50 text-primary-600 rounded-full">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="mt-3 space-y-2">
                      {(result.explain?.shared_themes?.length ?? 0) > 0 && (
                        <p className="text-xs text-slate-500">
                          为什么相似：共同命中主题{' '}
                          <span className="font-medium text-primary-600">
                            {result.explain!.shared_themes!.join('、')}
                          </span>
                        </p>
                      )}
                      {result.explain && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                          <span>
                            汉明距离{' '}
                            <span className="font-mono text-slate-500">
                              {result.explain.hamming_distance}/{64}
                            </span>
                          </span>
                          {typeof result.explain.asymmetric_score === 'number' && (
                            <span>
                              非对称得分{' '}
                              <span className="font-mono text-slate-500">
                                {result.explain.asymmetric_score.toFixed(3)}
                              </span>
                            </span>
                          )}
                          {result.explain.code_hex && (
                            <span>
                              哈希码{' '}
                              <span className="font-mono text-slate-500">
                                {result.explain.code_hex.slice(0, 8)}…
                              </span>
                            </span>
                          )}
                          {typeof result.explain.window === 'number' && (
                            <span>时间窗 {result.explain.window}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {showReport && report && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
              <div className="p-5 border-b border-slate-100 bg-gradient-to-r from-primary-50 to-white rounded-t-xl">
                <div className="flex items-center gap-3">
                  <Sparkles className="w-6 h-6 text-primary-600" />
                  <div>
                    <h3 className="font-semibold text-slate-800">RAG 智能分析报告</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      用户：{userProfile.name}，综合 {results.length} 个相似模式与知识库生成
                    </p>
                  </div>
                  <div className="ml-auto px-3 py-1 bg-danger-50 text-danger-600 rounded-full text-sm font-medium">
                    高风险
                  </div>
                </div>
              </div>

              <div className="p-5 space-y-5">
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="text-sm text-slate-700 leading-relaxed">{report.summary}</p>
                </div>

                {(report.sections ?? []).map((section, i) => (
                  <div key={i}>
                    <h4 className="font-medium text-slate-800 mb-2 flex items-center gap-2">
                      <ArrowRight className="w-4 h-4 text-primary-500" />
                      {section.title}
                    </h4>
                    <p className="text-sm text-slate-600 leading-relaxed pl-6">{section.content}</p>
                  </div>
                ))}

                <div className="mt-4">
                  <h4 className="font-medium text-slate-800 mb-3">个性化建议措施</h4>
                  <div className="space-y-2">
                    {(report.recommendations ?? []).map((rec, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-warning-50 rounded-lg">
                        <span className="w-5 h-5 rounded-full bg-warning-500 text-white text-xs flex items-center justify-center shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <span className="text-sm text-slate-700">{rec}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {!loading && error && (
        <div className="bg-danger-50 border border-danger-200 rounded-xl p-5 text-danger-700 text-sm">
          <p className="font-medium">检索失败</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      {!loading && !error && !results && (
        <div className="text-center py-20">
          <Search className="w-16 h-16 text-slate-200 mx-auto mb-4" />
          <p className="text-slate-400 text-sm">输入你的状态描述，开始动态跨模态哈希检索</p>
          <p className="text-slate-300 text-xs mt-1">支持文本、语音、图像多模态输入，输出 RAG 风险解释</p>
        </div>
      )}

      {zoomImage && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-6"
          onClick={() => setZoomImage(null)}
        >
          <div
            className="bg-white rounded-xl p-4 w-full max-w-md shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <p className="text-sm font-mono text-slate-700 break-all">
                  {zoomImage.file ?? '（图像文件）'}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  来源目录 {zoomImage.dir || '—'} · 48×48 灰度原图（放大显示，保留原始像素）
                </p>
              </div>
              <button
                type="button"
                onClick={() => setZoomImage(null)}
                className="shrink-0 p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={zoomImage.url}
              alt="面部图像原图"
              className="w-full rounded-lg border border-slate-200 bg-slate-50"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
