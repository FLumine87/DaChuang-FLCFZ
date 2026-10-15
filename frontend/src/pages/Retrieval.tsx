import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  corpusRecords,
  MODALITY_META,
  type Modality,
} from '../data/corpusRecords';

/** 语料记录等级外观：与全站 稳定/关注/警告/高危 同一套口径 */
const LEVEL_NAME: Record<string, string> = {
  green: '稳定',
  yellow: '关注',
  orange: '警告',
  red: '高危',
};
const LEVEL_PILL: Record<string, string> = {
  green: 'bg-success-50 text-success-600',
  yellow: 'bg-warning-50 text-warning-600',
  orange: 'bg-orange-50 text-orange-600',
  red: 'bg-danger-50 text-danger-600',
};
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
  ArrowLeft,
  Camera,
} from 'lucide-react';
import { getScreeningRecords, getPersonalSupplements, search, fetchRetrievalMedia, fetchRagReport } from '../services/mockApi';
import { USE_MOCK } from '../services/http';
import { supplementModalityText } from '../services/localKg';
import { getCurrentSession } from '../auth/session';
import type { RetrievalResult, RetrievalIndexInfo } from '../data/mockData';
import AlertBadge from '../components/AlertBadge';
import CameraCapture from '../components/CameraCapture';
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
  /** true = 结论由规则模板 + 检索命中生成（不经过大模型） */
  mock?: boolean;
}

export default function Retrieval() {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'text' | 'audio' | 'image'>('all');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<RetrievalResult[] | null>(null);
  /* 语料库历史记录一次先列 20 条，避免 300 条一口气铺满页面 */
  const [shown, setShown] = useState(20);
  /* 语料库历史记录的模态分类：全部 / 文本 / 语音 / 图像 */
  const [histMode, setHistMode] = useState<'all' | Modality>('all');
  /* 自己的记录：两路合并后置顶显示——
     ① 挂在筛查记录上的补充（records 上的 supplement 字段）；
     ② 直接挂在用户名下的补充（新账号还没做过筛查时的采集，见
        backend save_personal_supplement）。不合并的话，新账号在采集页
        传的内容在这张列表里看不到（"只上传不挂靠"的另一面）。 */
  const [mine, setMine] = useState<typeof corpusRecords>([]);
  useEffect(() => {
    let alive = true;
    Promise.all([getScreeningRecords(), getPersonalSupplements()])
      .then(([rs, sups]) => {
        if (!alive) return;
        const fromRecords = rs
          .filter((r) => r.supplement)
          .map((r) => {
            const sup = r.supplement!;
            return {
              id: r.id,
              date: r.date,
              themes: r.moodTag ? [r.moodTag] : [],
              /* 有哈希检索分析的用分析等级，没有就回退记录自身的等级 */
              level: sup.analysis?.level ?? r.level,
              severity: 0,
              context: '我的记录',
              text: sup.kind === 'text' ? (sup.text ?? '') : '',
              /* 模态文本统一走 supplementModalityText（与首页「最近一次输入」同一处逻辑）：
                 有分析描述就显示「语音片段特征：…」/「记录到的非言语线索：…」，
                 没有就如实回退成文件名 */
              audio: sup.kind === 'audio' ? supplementModalityText(sup, 'audio') : '',
              image: sup.kind === 'image' ? supplementModalityText(sup, 'image') : '',
            };
          });
        const fromUser = sups
          .filter((s) => !s.screeningId)
          .map((s) => ({
            id: `SUP-${s.id}`,
            date: s.createdAt ?? '',
            themes: [] as string[],
            level: s.analysis?.level ?? 'green',
            severity: 0,
            context: '我的采集',
            text: s.kind === 'text' ? (s.text ?? '') : '',
            audio: s.kind === 'audio' ? supplementModalityText(s, 'audio') : '',
            image: s.kind === 'image' ? supplementModalityText(s, 'image') : '',
          }));
        setMine([...fromUser, ...fromRecords]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [report, setReport] = useState<RagReport | null>(null);
  /** 报告两阶段（2026-10-14 产品口径）：检索结果秒出（哈希检索的优势），
   *  报告区先显示"大模型思考中"，RAG 深度报告异步回来后替换展示。 */
  const [reportPhase, setReportPhase] = useState<'idle' | 'thinking' | 'done'>('idle');
  /** 规则报告兜底：大模型失败 / Mock / 超时的时候显示，并标注来源 */
  const fallbackReportRef = useRef<RagReport | null>(null);
  /** 当前报告请求的序号：思考期间再次检索时，旧请求回来直接丢弃 */
  const reportSeqRef = useRef(0);
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
  /** 图片线索的两个来源：从文件选择 / 现场拍照（摄像头） */
  const [imgMenuOpen, setImgMenuOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const recorder = useAudioRecorder((file) => {
    pickMedia('audio', file);
    setMicMenuOpen(false);
  });

  const canSearch = queryModality === 'text' ? !!query.trim() : !!mediaFile;

  /** 执行检索。scopeOverride 用于「点范围即检索」：setScope 是异步的，
   *  同一轮事件里读到的 scope 还是旧值，所以显式传入本次要用的范围。 */
  const handleSearch = async (scopeOverride?: typeof scope, queryOverride?: string) => {
    /* queryOverride 用于「带参进来自动检索」：setQuery 是异步的，同一轮事件里
       读到的 query 还是旧值，所以显式传入本次要用的查询词。 */
    const effQuery = queryOverride ?? query;
    const effCanSearch = queryModality === 'text' ? !!effQuery.trim() : !!mediaFile;
    if (!effCanSearch) return;
    const effScope = scopeOverride ?? scope;
    setLoading(true);
    setResults(null);
    setReport(null);
    setReportPhase('idle');
    setError(null);
    setIndexInfo(null);
    try {
      let mediaBase64: string | null = null;
      if (queryModality !== 'text' && mediaFile) {
        mediaBase64 = await fileToBase64(mediaFile);
      }
      const res = await search(effQuery, {
        modality: queryModality,
        modalityFilter: effScope === 'all' ? undefined : effScope,
        mediaBase64,
        mediaName: mediaFile?.name,
      });
      /* 检索结果秒出，立即渲染（哈希检索的优势）。报告分两步：
         ① 检索接口附带的规则结论先存为兜底（大模型不可用时展示）；
         ② 报告区进入"大模型思考中"，异步请求 RAG 深度报告，回来后替换。 */
      const hits = ((res.results ?? []) as RetrievalResult[]).slice(0, 10).map((r) => ({
        recordId: r.recordId,
        alertLevel: r.alertLevel,
        similarity: r.similarity,
        summary: r.summary,
      }));
      setResults((res.results ?? []) as RetrievalResult[]);
      setIndexInfo((res.index ?? null) as RetrievalIndexInfo | null);
      const ruleReport = (res.report ?? null) as RagReport | null;
      fallbackReportRef.current = ruleReport;
      if (!ruleReport) {
        setReportPhase('done');
        return;
      }
      setReportPhase('thinking');
      const seq = ++reportSeqRef.current; // 思考期间再次检索时，旧报告作废
      void (async () => {
        try {
          const rr = await fetchRagReport<RagReport>({ query: effQuery, hits });
          if (seq !== reportSeqRef.current) return;
          if (rr.mock || !rr.report) {
            setReport(ruleReport); // 引擎降级：如实显示规则报告
          } else {
            setReport(rr.report); // 大模型报告
          }
        } catch {
          if (seq !== reportSeqRef.current) return;
          setReport(ruleReport); // 超时 / 失败：兜底规则报告
        } finally {
          if (seq === reportSeqRef.current) setReportPhase('done');
        }
      })();
    } catch (err) {
      setError((err as Error).message || '检索失败，请稍后重试');
      setReportPhase('done');
    } finally {
      setLoading(false);
    }
  };

  /* 从首页「查看检索依据」跳进来时地址是 #/personal/retrieval?q=<那条输入>。
     本项目用 HashRouter，查询串在 hash 里 —— useSearchParams 读的正是 hash 里的
     location，而 window.location.search 在 hash 路由下永远是空的（别用它）。
     带 q 就自动填入搜索框并立即检索，用户不必再输一遍；没有 q 时保持空表单。
     autoRanRef 只防重复：同一条 q 只自动跑一次，重渲染不再发请求。 */
  /* 历史记录的模态过滤（2026-10-14 用户实测："四个按钮点了不起作用"——
     以前只切了展示的单元，列表与条数都没动）。口径：
       · 语料条目：按"该模态单元是否存在"过滤（每条的 文本/语音/图像 三个单元都在，
         所以条数不变，但每条展示的单元会跟着切）；
       · 自己采集的记录（mine）：只在该模态下出现（supplement 只能是文字/语音/图片之一），
         已经并入主列表并带「我的记录」标签 —— 不再另开「我的输入」分组（同一批数据
         显示两遍会让条数重复计入）。
     合并后才是这份列表真实的条数与顺序（自己的在前）。 */
  const hasUnit = (row: { text?: string; audio?: string; image?: string }, mode: Modality) =>
    (row[mode] ?? '').trim().length > 0;
  const corpusVisible = histMode === 'all' ? corpusRecords : corpusRecords.filter((r) => hasUnit(r, histMode));
  const mineVisible = histMode === 'all' ? mine : mine.filter((r) => hasUnit(r, histMode));
  const historyRows = [...mineVisible, ...corpusVisible];
  const historyTotal = historyRows.length;

  /* 每个模态下到底有多少条：直接印在按钮上 —— 语料每条都有三个单元，条数不变，
     光看列表看不出按钮有没有生效（2026-10-14 用户实测"点了没反应"），
     计数 + 行内单元正文 + 一句口径说明，三处一起把"确实切了"讲清楚。 */
  const modalityCount = (mode: 'all' | Modality) =>
    mode === 'all'
      ? corpusRecords.length + mine.length
      : corpusRecords.filter((r) => hasUnit(r, mode)).length +
        mine.filter((r) => hasUnit(r, mode)).length;

  /** 每个模态实际展示的是什么（说明文字必须与真实行为一致） */
  const HIST_MODE_DESC: Record<'all' | Modality, string> = {
    all: '全部模态：语料条目显示文本单元，自己的记录按实际采集到的模态显示',
    text: '当前显示每条记录的文本单元（自述原文）',
    audio: '当前显示每条记录的语音单元文本（语音特征描述）',
    image: '当前显示每条记录的图像单元描述（非言语线索）',
  };

  const [searchParams] = useSearchParams();
  const autoQuery = searchParams.get('q') ?? '';
  const autoRanRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoQuery.trim() || autoRanRef.current === autoQuery) return;
    autoRanRef.current = autoQuery;
    setQuery(autoQuery);
    void handleSearch(undefined, autoQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoQuery]);

  return (
    <div className="space-y-6">
      <div className="ui-card p-5">
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
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-40 flex-1">
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
          <div className="relative">
            <button
              onClick={() => setImgMenuOpen((v) => !v)}
              title="上传一张面部图像，或现场拍照作为查询线索"
              className={`px-3 py-2.5 border rounded-lg transition-colors cursor-pointer ${
                queryModality === 'image'
                  ? 'border-primary-300 bg-primary-50 text-primary-600'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              <Image className="w-4 h-4" />
            </button>
            {imgMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setImgMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
                  <button
                    onClick={() => {
                      setImgMenuOpen(false);
                      imageInputRef.current?.click();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    从文件选择
                  </button>
                  <button
                    onClick={() => {
                      setImgMenuOpen(false);
                      setCameraOpen(true);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    现场拍照
                  </button>
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => handleSearch()}
            disabled={loading || !canSearch}
            className="px-6 py-2.5 bg-primary-500 text-white rounded-lg hover:bg-primary-600 text-sm font-medium transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
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
        <div className="ui-card p-12 flex flex-col items-center gap-4 text-slate-400">
          <Loader2 className="w-10 h-10 animate-spin text-primary-500" />
          <div className="text-center">
            <p className="text-sm font-medium text-slate-600">动态跨模态哈希检索中</p>
            <p className="text-xs mt-1">正在编码特征向量并计算哈希距离...</p>
          </div>
        </div>
      )}

      {!loading && results && (
        <>
          <div className="ui-card ">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                {/* 检索后语料库历史列表会被结果区顶掉，这里留一个明确入口回去，
                    否则用户搜完就找不到那份列表了 */}
                <h3 className="font-semibold text-slate-800">
                  检索结果{' '}
                  <span className="text-sm font-normal text-slate-400">
                    {results.length === 0
                      ? '（没有找到相似模式：试试换一种描述，或把检索范围改成「全部模态」）'
                      : `（找到 ${results.length} 个高相似模式）`}
                  </span>
                  {/* 演示模式（VITE_USE_MOCK=true）下命中的是仓库自带的示例语料，
                      不是按本次查询从真实索引里算出来的 —— 如实标注，别让人当真结果 */}
                  {USE_MOCK && (
                    <span className="ml-2 align-middle rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-500">
                      演示数据
                    </span>
                  )}
                </h3>
                {indexInfo && (
                  <>
                    {/* 主层：只留人能直接读懂的信息 */}
                    <p className="text-xs text-slate-400 mt-1">
                      查询模态 {modalityLabels[(indexInfo.query_modality ?? 'text') as keyof typeof modalityLabels] ?? '文本'}
                      {indexInfo.query_media ? '（媒体文件）' : ''}
                      {' · '}命中主题 {indexInfo.query_themes?.join('、') || '—'}
                      {indexInfo.data_source && (
                        <>
                          {' · '}数据来源 {SOURCE_LABELS[indexInfo.data_source] ?? indexInfo.data_source}
                        </>
                      )}
                    </p>
                    {/* 技术细节默认折叠：原先这些字段与主层挤在同一行，
                        等于把"跨模态哈希"这个核心卖点当成调试信息展示 */}
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
                        技术详情（哈希编码与索引过程）
                      </summary>
                      <p className="text-xs text-slate-400 mt-1">
                        查询码 <span className="font-mono">{indexInfo.query_code_hex?.slice(0, 8)}…</span>
                        {' · '}候选 <span className="tabular-nums">{indexInfo.candidates}/{indexInfo.index_size}</span>
                        {' · '}探测桶 <span className="tabular-nums">{indexInfo.keys_probed}</span>
                        {' · '}{indexInfo.scoring === 'asymmetric' ? '非对称距离' : '汉明距离'}排序
                      </p>
                    </details>
                  </>
                )}
                {indexInfo?.dataset && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    检索语料：{indexInfo.dataset}（真实数据，按风险类别配对三模态）
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2.5">
                {/* 「RAG智能分析」按钮已按用户要求去掉：报告随检索结果自动生成、就地展示，
                    用户不需要点开也不需要关闭（见下方 RAG 区块）。这里只留返回入口。 */}
                <button
                  type="button"
                  onClick={() => {
                    setResults(null);
                    setReport(null);
                    setError(null);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 text-sm font-medium transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" /> 返回历史记录
                </button>
              </div>
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
                          <p className="text-lg font-bold text-primary-600 tabular-nums">
                            {(result.similarity * 100).toFixed(0)}%
                          </p>
                          {/* 把裸数字换成「人能读的档位 + 分数条」：
                              >80% 高度相似 / >60% 较相似 / 其余关联较弱 */}
                          <p className="text-xs text-slate-500">
                            {result.similarity >= 0.8 ? '高度相似' : result.similarity >= 0.6 ? '较相似' : '关联较弱'}
                          </p>
                          <div className="mt-1 ml-auto h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={`h-full rounded-full ${result.similarity >= 0.6 ? 'bg-primary-500' : 'bg-slate-300'}`}
                              style={{ width: `${Math.round(result.similarity * 100)}%` }}
                              aria-hidden="true"
                            />
                          </div>
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
                        <details className="text-xs text-slate-400">
                          <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
                            技术细节（汉明距离 / 哈希码 / 时间窗）
                          </summary>
                          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
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
                        </details>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* RAG 智能分析：随检索结果**自动生成、就地展示**（用户 2026-10-14 要求去掉
              "点一下才看报告"的按钮，也不再需要关闭）。拿不到报告时只在这里就地说明，
              上面的检索命中不受影响。 */}
          <div className="ui-card">
              <div className="p-5 border-b border-slate-100 bg-gradient-to-r from-primary-50 to-white rounded-t-xl">
                <div className="flex flex-wrap items-center gap-3">
                  <Sparkles className="w-6 h-6 text-primary-600" />
                  <div>
                    <h3 className="font-semibold text-slate-800">RAG 智能分析报告</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      用户：{getCurrentSession()?.username || '用户'}，综合 {results.length} 个相似模式与知识库生成
                    </p>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {/* 演示模式下命中的是仓库自带的示例语料与示例报告：如实标注来源 */}
                    {USE_MOCK && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-500">
                        演示数据
                      </span>
                    )}
                    {report?.riskLevel && <div className="px-3 py-1 bg-slate-100 text-slate-700 rounded-md text-sm font-medium">
                      风险提示：{report.riskLevel}
                    </div>}
                    {/* 结论来源如实标注：mock=规则兜底（大模型不可用），否则为大模型生成 */}
                    {reportPhase === 'done' && report?.mock && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-500">
                        规则分析 · 依据检索命中
                      </span>
                    )}
                    {reportPhase === 'done' && report && !report.mock && (
                      <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-normal text-primary-600">
                        大模型分析
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {reportPhase === 'thinking' && (
                <div className="p-5 flex items-center gap-3 text-sm text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin text-primary-500 shrink-0" />
                  <span>
                    大模型思考中：正在结合知识库与本次 {results.length} 条检索命中生成深度分析报告，
                    通常需要 30 ~ 60 秒，期间可以先查看上面的检索结果。
                  </span>
                </div>
              )}

              {reportPhase === 'done' && !report && (
                <p className="p-5 text-sm leading-6 text-slate-500">
                  本次没有返回分析结论（上面的检索命中不受影响）。可以稍后重试，或换一种描述再检索一次。
                </p>
              )}

              {report && (
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
              )}
          </div>
        </>
      )}

      {!loading && error && (
        <div className="bg-danger-50 border border-danger-200 rounded-xl p-5 text-danger-700 text-sm">
          <p className="font-medium">检索失败</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      {!loading && !error && !results && (
        /* 还没检索时不再放一张空状态图：把语料库里真实存在的历史记录列出来，
           点一条就把它的文字填进检索框 —— 既是"历史记录"，也是现成的检索样例。 */
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-800">
                历史记录
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                共 {historyTotal} 条（含你自己采集的 {mineVisible.length} 条）。
                {HIST_MODE_DESC[histMode]}
                ；点一条直接用它的文本检索。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(['all', 'text', 'audio', 'image'] as const).map((m) => {
                  const active = histMode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => { setHistMode(m); setShown(20); }}
                      className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                        active
                          ? 'border-primary-300 bg-primary-50 font-medium text-primary-600'
                          : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {m === 'all' ? '全部模态' : MODALITY_META[m].label}
                      <span className={`ml-1 tabular-nums ${active ? '' : 'text-slate-400'}`}>
                        {modalityCount(m)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <span className="text-xs tabular-nums text-slate-400">
              已显示 {Math.min(shown, historyRows.length)} / {historyRows.length}
            </span>
          </div>

          <ul className="mt-4 grid gap-3">
            {historyRows.slice(0, shown).map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setQuery(r.text)}
                  className="w-full rounded-xl border border-slate-100 p-4 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/40"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="text-xs font-medium tabular-nums text-slate-600">
                        {r.id}
                      </span>
                      <span className="text-xs tabular-nums text-slate-400">{r.date}</span>
                      {r.context && (
                        <span className="text-xs text-slate-400">· {r.context}</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">
                        {histMode === 'all'
                          ? [r.text && '文本', r.audio && '语音', r.image && '图像']
                              .filter(Boolean)
                              .join(' · ')
                          : `${MODALITY_META[histMode].label}单元`}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_PILL[r.level]}`}
                      >
                        {LEVEL_NAME[r.level]}
                      </span>
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {histMode === 'all'
                      ? /* 全部模态：语料条目看文本单元；自己的记录只有采集到的那一个模态，
                           按"文本→语音→图像"取第一个有内容的（否则自己的图片记录会是空白行） */
                        r.text || r.audio || r.image
                      : histMode === 'text'
                        ? r.text
                        : histMode === 'audio'
                          ? r.audio
                          : r.image}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {r.themes.map((t) => (
                      <span
                        key={t}
                        className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {/* 该模态下一条都没有时给一句说明，不留空白（例如还没有任何图像采集） */}
          {historyRows.length === 0 && (
            <p className="mt-4 rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
              当前筛选下还没有记录。切回「全部模态」，或先去「多模态采集」补一条这个模态的记录。
            </p>
          )}

          {shown < historyRows.length && (
            <button
              type="button"
              onClick={() => setShown((n) => n + 20)}
              className="ui-button mt-4 w-full"
            >
              显示更多（还有 {historyRows.length - shown} 条）
            </button>
          )}
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

      {/* 现场拍照：拍完与"从文件选择"走同一条 pickMedia → base64 → 检索链路 */}
      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => pickMedia('image', file)}
      />
    </div>
  );
}
