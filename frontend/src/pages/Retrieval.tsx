import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  corpusRecords,
  MODALITY_META,
  type Modality,
} from '../data/corpusRecords';

/** 语料记录等级外观：与全站 稳定/关注/警告/高危 同一套口径 */
const LEVEL_NAME: Record<string, string> = {
  unknown: '未评估',
  green: '稳定',
  yellow: '关注',
  orange: '警告',
  red: '高危',
};
const LEVEL_PILL: Record<string, string> = {
  unknown: 'bg-slate-100 text-slate-500',
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
  Hash,
  Loader2,
  X,
  FolderOpen,
  Square,
  ArrowLeft,
  Camera,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import {
  getPersonalSupplements,
  search,
  fetchRetrievalMedia,
  fetchRagReport,
  uploadFile,
  saveUserSupplement,
} from '../services/mockApi';
import { USE_MOCK } from '../services/http';
import { supplementModalityText } from '../services/localKg';
import type { RetrievalResult, RetrievalIndexInfo } from '../data/mockData';
import CameraCapture from '../components/CameraCapture';
import ThemeHistogram from '../components/ThemeHistogram';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { toCorpusWavFile } from '../utils/audioRecorder';
import { assessRetrieval, type RetrievalAnalysisReport as RagReport, type RetrievalAssessment } from '../services/screeningAssessment';
import RetrievalAssessmentCard from '../components/RetrievalAssessmentCard';
import type { CollectionAnalysis } from '../services/mockApi';

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

export default function Retrieval() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'text' | 'audio' | 'image'>('all');
  /* 返回条数：滑条控制 1~20 条（后端另有 1~50 的兜底夹取）。
     默认 10 —— 少于 3 条页面就没有"查看其余"这一步，多于 20 条一屏读不完。 */
  const [topK, setTopK] = useState(10);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<RetrievalResult[] | null>(null);
  /* 语料库历史记录一次先列 20 条，避免 300 条一口气铺满页面 */
  const [shown, setShown] = useState(20);
  const [showAllResults, setShowAllResults] = useState(false);
  /* 语料库历史记录的模态分类：全部 / 文本 / 语音 / 图像 */
  const [histMode, setHistMode] = useState<'all' | Modality>('all');
  /* 自己的记录：两路合并后置顶显示——
     ① 挂在筛查记录上的补充（records 上的 supplement 字段）；
     ② 直接挂在用户名下的补充（新账号还没做过筛查时的采集，见
        backend save_personal_supplement）。不合并的话，新账号在采集页
        传的内容在这张列表里看不到（"只上传不挂靠"的另一面）。 */
  const [mine, setMine] = useState<typeof corpusRecords>([]);
  const savedReportsRef = useRef<Map<number, CollectionAnalysis>>(new Map());
  useEffect(() => {
    let alive = true;
    getPersonalSupplements().then((sups) => {
      if (!alive) return;
      sups.forEach((item) => { if (item.analysis) savedReportsRef.current.set(item.id, item.analysis); });
      setMine(sups.map((item) => ({ id: `SUP-${item.id}`, date: item.createdAt ?? '', themes: [],
        level: item.analysis?.level ?? 'unknown', severity: 0, context: '我的检索记录', supplementId: item.id,
        text: item.kind === 'text' ? item.text ?? '' : '',
        audio: item.kind === 'audio' ? supplementModalityText(item, 'audio') : '',
        image: item.kind === 'image' ? supplementModalityText(item, 'image') : '',
      })));
    }).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [report, setReport] = useState<RagReport | null>(null);
  const [includeOriginalInput, setIncludeOriginalInput] = useState(() => localStorage.getItem('psych_retrieval_include_original') !== 'false');
  const includeOriginalInputRef = useRef(includeOriginalInput);
  /** 结论先展示，RAG 分析异步补充到同一张结论卡中。 */
  const [reportPhase, setReportPhase] = useState<'idle' | 'thinking' | 'done'>('idle');
  /** 当前报告请求的序号：思考期间再次检索时，旧请求回来直接丢弃 */
  const reportSeqRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [indexInfo, setIndexInfo] = useState<RetrievalIndexInfo | null>(null);
  const [assessment, setAssessment] = useState<RetrievalAssessment | null>(null);
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const retrievalTokenRef = useRef<string | undefined>(undefined);
  const assessmentQueryRef = useRef('');
  const assessmentInputRef = useRef<{ query: string; modality: QueryModality; file: File | null }>({ query: '', modality: 'text', file: null });
  const savedContextRef = useRef<{ id: number; query: string } | null>(null);
  const searchSeqRef = useRef(0);
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
    // 上传后保持「全部模态」默认：先给用户完整的跨模态结果，
    // 想只看同模态近邻再手动切。之前自动切到对应模态，用户反馈不需要。
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

  /* ── 送入检索数据 ─────────────────────────────────────────────────────────
     默认开启：检索页的每一次查询，都和「心理筛查」页的采集一样算一条数据记录，
     存下来之后首页「最近一次输入」、我的档案和管理端都能看到。
     有些查询只是想看一眼、不想留痕，可以在这里取消。 */
  const [saveToSystem, setSaveToSystem] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  /** 同一次输入点「检索范围」会反复触发检索（点范围即检索），但入库只该有一次：
   *  按 模态 + 内容 + 文件 做指纹，存过就跳过；改字或换文件才算新的一条。 */
  const persistedKeysRef = useRef<Map<string, CollectionAnalysis | null>>(new Map());

  /** 把一次检索作为一条采集记录送入系统。
   *
   *  走的是「心理筛查」页采集落库的同一套接口：有已完成的筛查记录就挂在那条下，
   *  一条都没有就挂到用户名下（首页同样读得到）。后端保存时会再跑一次哈希分析、
   *  把内容写进待审核索引，所以首页「最近一次输入」、检索页「我的记录」、
   *  管理端的数据审核与案例都能看到这条。
   *
   *  失败只报"没送进去"，不影响已经拿到的检索结果。 */
  const pushToSystem = async (input: {
    query: string;
    modality: QueryModality;
    file: File | null;
    sequence: number;
  }) => {
    const text = input.query.trim();
    if (input.modality === 'text' && !text) return;
    if (input.modality !== 'text' && !input.file) return;

    const key = `user|${input.modality}|${text}|${input.file ? `${input.file.name}:${input.file.size}:${input.file.lastModified}` : ''}`;
    if (persistedKeysRef.current.has(key)) return persistedKeysRef.current.get(key);

    setSaveState('saving');
    setSaveMessage('正在送入系统…');
    try {
      /* 图像/语音要先落盘换成 url：后端按 uploads 路径再抽一次模态特征，
         只给 base64 进不了索引，管理端也就看不到这条。 */
      let payload: {
        kind: 'text' | 'audio' | 'image';
        text?: string;
        filename?: string;
        url?: string;
        description?: string;
      };
      if (input.modality === 'text') {
        payload = { kind: 'text', text };
      } else {
        const up = await uploadFile(input.file!);
        payload = {
          kind: input.modality,
          filename: up.filename,
          url: up.url,
          description: up.analysis,
        };
      }

      const report = await saveUserSupplement({ ...payload, retrievalToken: retrievalTokenRef.current });

      persistedKeysRef.current.set(key, report);
      if (input.sequence !== searchSeqRef.current) return report;
      setSaveState('saved');
      setSaveMessage('已作为一条记录存入系统，检索初筛依据已保存到你的档案');
      return report;
    } catch (e) {
      if (input.sequence !== searchSeqRef.current) return null;
      /* 图像/语音要先把文件传上去才能入库。本部署的文件上传后端未启用（固定 503），
         这种情况直接说清楚"只做了检索、没入库"，别把 axios 的英文错误抛给用户。 */
      const raw = e instanceof Error ? e.message : '';
      setSaveState('error');
      setSaveMessage(
        /503/.test(raw)
          ? '未能送入系统：文件上传服务未启用（503），本条只做了检索、没有入库'
          : raw
            ? `未能送入系统：${raw}（检索结果不受影响）`
            : '未能送入系统，检索结果不受影响',
      );
      return null;
    }
  };

  const updateReport = (text: string, currentResults: RetrievalResult[], current: RetrievalAssessment) => {
    const includeOriginal = includeOriginalInputRef.current;
    const modality = current.queryModality ?? assessmentInputRef.current.modality;
    const fallback: RagReport = {
      summary: current.conclusion, riskLevel: current.levelLabel,
      sections: [{ title: '参考依据', content: current.evidence.filter((item) => item.id !== 'coverage').slice(0, 3).map((item) => `${item.label}：${item.value}`).join('；').slice(0, 180) }],
      recommendations: [], mock: true,
      generationMessage: '大模型本次未生成有效报告，以下仅保留检索筛查结果，心理建议尚未生成。请重新生成报告。',
      originalInput: { enabled: includeOriginal, used: false, modality,
        notice: !includeOriginal ? '已关闭原始输入分析，仅依据检索筛查结果生成。'
          : modality !== 'text' ? '当前大模型不直接解读原始图片或语音，本次媒体线索依据检索结果分析。'
          : '本次未使用原始文字生成大模型分析，保留检索证据结论。' },
    };
    setReport(fallback);
    if (USE_MOCK) { setReportPhase('done'); return; }
    setReportPhase('thinking');
    const sequence = ++reportSeqRef.current;
    void fetchRagReport<RagReport>({
      query: includeOriginal ? text : '', analysisMode: 'retrieval', includeOriginalInput: includeOriginal,
      retrievalToken: current.retrievalToken, supplementId: current.supplementId,
      hits: currentResults.slice(0, 10).map((r) => ({ recordId: r.recordId, alertLevel: r.alertLevel, similarity: r.similarity, summary: r.summary })),
    }).then((response) => {
      if (sequence === reportSeqRef.current) setReport(response.report ? {
        ...response.report, mock: response.mock || response.report.mock,
        generationMessage: response.report.generationMessage || (response.mock ? fallback.generationMessage : undefined),
      } : fallback);
    }).catch(() => {
      if (sequence === reportSeqRef.current) setReport(fallback);
    }).finally(() => {
      if (sequence === reportSeqRef.current) setReportPhase('done');
    });
  };

  const changeOriginalInput = (enabled: boolean) => {
    setIncludeOriginalInput(enabled);
    includeOriginalInputRef.current = enabled;
    localStorage.setItem('psych_retrieval_include_original', String(enabled));
    // Regenerate only the report; search results and saved records stay the same.
    ++reportSeqRef.current;
    if (assessment && results) updateReport(assessmentQueryRef.current, results, assessment);
  };

  const refreshAssessment = async () => {
    const sequence = searchSeqRef.current;
    setAssessmentLoading(true); setAssessmentError(null);
    ++reportSeqRef.current;
    setReport(null); setReportPhase('idle');
    try {
      const updated = await assessRetrieval({
        query: assessmentQueryRef.current, modality: assessmentInputRef.current.modality,
        supplementId: assessment?.supplementId,
        retrievalToken: retrievalTokenRef.current,
      });
      if (sequence !== searchSeqRef.current) return;
      setAssessment(updated);
      updateReport(assessmentQueryRef.current, results ?? [], updated);
    } catch (e) {
      if (sequence === searchSeqRef.current) setAssessmentError(e instanceof Error ? e.message : '评估更新失败，请重试');
    } finally {
      if (sequence === searchSeqRef.current) setAssessmentLoading(false);
    }
  };

  const openSavedAssessment = async (row: (typeof corpusRecords)[number]) => {
    if (!row.supplementId) { setQuery(row.text); return; }
    const sequence = ++searchSeqRef.current;
    ++reportSeqRef.current;
    const saved = savedReportsRef.current.get(row.supplementId);
    const previousHits: RetrievalResult[] = (saved?.hits ?? []).map((hit) => ({
      id: hit.id, similarity: hit.similarity, modality: ['text', 'audio', 'image'].includes(hit.modality ?? '') ? hit.modality as 'text' | 'audio' | 'image' : 'text',
      summary: hit.summary || '', tags: hit.tags ?? [], date: hit.date || '',
      alertLevel: ['green', 'yellow', 'orange', 'red'].includes(hit.alertLevel) ? hit.alertLevel as 'green' | 'yellow' | 'orange' | 'red' : 'unknown',
    }));
    setQuery(row.text); setResults(previousHits); setReport(null); setReportPhase('idle'); setAssessment(null);
    setAssessmentLoading(true); setAssessmentError(null); setError(null);
    assessmentQueryRef.current = row.text;
    savedContextRef.current = { id: row.supplementId, query: row.text };
    assessmentInputRef.current = { query: row.text, modality: row.text ? 'text' : row.audio ? 'audio' : 'image', file: null };
    try {
      const current = await assessRetrieval({ query: row.text, supplementId: row.supplementId });
      if (sequence !== searchSeqRef.current) return;
      setAssessment(current);
      retrievalTokenRef.current = current.retrievalToken;
      updateReport(row.text, previousHits, current);
    } catch (e) {
      if (sequence === searchSeqRef.current) setAssessmentError(e instanceof Error ? e.message : '历史评估读取失败');
    } finally { if (sequence === searchSeqRef.current) setAssessmentLoading(false); }
  };

  const saveAssessmentInput = async () => {
    const sequence = searchSeqRef.current;
    setAssessmentLoading(true); setAssessmentError(null);
    try {
      const saved = await pushToSystem({ ...assessmentInputRef.current, sequence });
      if (sequence !== searchSeqRef.current) return;
      const supplementId = saved?.supplementId ?? saved?.assessment?.supplementId;
      if (!supplementId) throw new Error('本次输入尚未完成保存与评估，请检查保存提示后重试。');
      const current = await assessRetrieval({ query: assessmentQueryRef.current, supplementId, retrievalToken: retrievalTokenRef.current });
      if (sequence !== searchSeqRef.current) return;
      setAssessment(current);
      savedContextRef.current = { id: supplementId, query: assessmentQueryRef.current };
      setSaveToSystem(true);
      updateReport(assessmentQueryRef.current, results ?? [], current);
    } catch (e) {
      if (sequence === searchSeqRef.current) setAssessmentError(e instanceof Error ? e.message : '保存本次输入失败');
    } finally { if (sequence === searchSeqRef.current) setAssessmentLoading(false); }
  };

  /** 执行检索。scopeOverride 用于「点范围即检索」：setScope 是异步的，
   *  同一轮事件里读到的 scope 还是旧值，所以显式传入本次要用的范围。
   *  persistOverride 只在"带参自动检索"时显式传 false —— 那种情况下内容
   *  本来就是首页已有的记录，再存一遍就是重复。 */
  const handleSearch = async (
    scopeOverride?: typeof scope,
    queryOverride?: string,
    persistOverride?: boolean,
    topKOverride?: number,
  ) => {
    /* queryOverride 用于「带参进来自动检索」：setQuery 是异步的，同一轮事件里
       读到的 query 还是旧值，所以显式传入本次要用的查询词。
       topKOverride 同理用于滑条：setTopK 也是异步的。 */
    const effQuery = queryOverride ?? query;
    const effCanSearch = queryModality === 'text' ? !!effQuery.trim() : !!mediaFile;
    if (!effCanSearch) return;
    const effScope = scopeOverride ?? scope;
    const effTopK = topKOverride ?? topK;
    const sequence = ++searchSeqRef.current;
    ++reportSeqRef.current;
    const returnSupplementId = queryModality === 'text'
      ? (savedContextRef.current?.query === effQuery ? savedContextRef.current.id : effQuery === searchParams.get('q') ? searchParams.get('assessmentSupplementId') : null)
      : null;
    assessmentQueryRef.current = effQuery;
    assessmentInputRef.current = { query: effQuery, modality: queryModality, file: mediaFile };
    setLoading(true);
    setResults(null);
    setShowAllResults(false);
    setReport(null);
    setReportPhase('idle');
    setError(null);
    setIndexInfo(null);
    setAssessment(null);
    setAssessmentError(null);
    setAssessmentLoading(true);
    setSaveState('idle');
    setSaveMessage('');
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
        topK: effTopK,
      });
      /* 检索结果秒出，立即渲染（哈希检索的优势）。报告分两步：
         ① 检索接口附带的规则结论先存为兜底（大模型不可用时展示）；
         ② 同一结论卡显示"大模型思考中"，异步补充 RAG 分析说明与建议。 */
      if (sequence !== searchSeqRef.current) return;
      setResults((res.results ?? []) as RetrievalResult[]);
      setIndexInfo((res.index ?? null) as RetrievalIndexInfo | null);
      retrievalTokenRef.current = res.assessment?.retrievalToken;
      if (res.assessment) { setAssessment(res.assessment); setAssessmentLoading(false); }
      setLoading(false);
      /* 送入系统放在结果渲染之后：即使这一步失败，也不影响这一屏的检索结果。 */
      try {
        const saved = !returnSupplementId && (persistOverride ?? saveToSystem)
          ? await pushToSystem({ query: effQuery, modality: queryModality, file: mediaFile, sequence })
          : null;
        if (sequence !== searchSeqRef.current) return;
        const current = await assessRetrieval({
          query: effQuery, modality: queryModality, retrievalToken: retrievalTokenRef.current,
          supplementId: returnSupplementId ? Number(returnSupplementId) : saved?.supplementId ?? saved?.assessment?.supplementId,
        });
        if (sequence !== searchSeqRef.current) return;
        setAssessment(current);
        if (current.supplementId && queryModality === 'text') savedContextRef.current = { id: current.supplementId, query: effQuery };
        retrievalTokenRef.current = current.retrievalToken;
        if (searchParams.get('assessmentSupplementId')) {
          const next = new URLSearchParams(searchParams);
          next.delete('assessmentSupplementId'); next.delete('screeningId'); next.delete('q');
          setSearchParams(next, { replace: true });
        }
        updateReport(effQuery, res.results ?? [], current);
      } catch (reason) {
        if (sequence === searchSeqRef.current) {
          setAssessmentError(reason instanceof Error ? reason.message : '筛查评估未完成，请重试');
          setReportPhase('done');
        }
      }
    } catch (err) {
      if (sequence === searchSeqRef.current) {
        setError((err as Error).message || '检索失败，请稍后重试');
        setReportPhase('done');
      }
    } finally {
      if (sequence === searchSeqRef.current) { setLoading(false); setAssessmentLoading(false); }
    }
  };

  /* 从首页「查看检索依据」跳进来时地址是
     #/personal/screening?tab=retrieval&q=<那条输入>（本组件已并入「心理筛查」页）。
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

  const autoQuery = searchParams.get('q') ?? '';
  const autoContext = `${autoQuery}|${searchParams.get('assessmentSupplementId') || ''}|${searchParams.get('screeningId') || ''}`;
  const autoRanRef = useRef<string | null>(null);
  useEffect(() => {
    const savedId = Number(searchParams.get('assessmentSupplementId'));
    if ((!autoQuery.trim() && !savedId) || autoRanRef.current === autoContext) return;
    autoRanRef.current = autoContext;
    if (!autoQuery.trim() && Number.isInteger(savedId) && savedId > 0) {
      void openSavedAssessment({ id: `SUP-${savedId}`, date: '', themes: [], level: 'unknown', severity: 0,
        context: '我的记录', text: '', audio: '', image: '', supplementId: savedId,
        screeningId: searchParams.get('screeningId') || undefined });
      return;
    }
    setQuery(autoQuery);
    void handleSearch(undefined, autoQuery, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoContext]);

  return (
    <div className="space-y-6">
      <div className="ui-card p-5">
        <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <Hash className="w-5 h-5 text-primary-600" />
          动态跨模态哈希检索
        </h3>
        <p className="text-sm text-slate-400 mb-4">
          输入文字或上传图像、语音，系统将汇总本次跨模态检索结果，直接给出情绪与心理相关线索的初筛结论。
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

        {/* 返回条数滑条：拖到几条就返回几条（1~20）。
            拖动时如果已经有结果，直接按新条数重跑一次，不用再点「开始检索」。 */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-3">
          <label htmlFor="topk-range" className="text-xs text-slate-400">
            返回条数
          </label>
          <input
            id="topk-range"
            type="range"
            min={1}
            max={20}
            step={1}
            value={topK}
            aria-label="返回条数"
            onChange={async (e) => {
              const v = Number(e.target.value);
              setTopK(v);
              if (!results || !canSearch) return;
              await handleSearch(undefined, undefined, undefined, v);
              // 滑条明确要求 N 条，就别再折叠成 3 条，否则看着像没生效
              setShowAllResults(true);
            }}
            className="h-1.5 w-40 cursor-pointer accent-primary-500"
          />
          <span className="inline-flex min-w-[3.2rem] items-center justify-center rounded-md bg-primary-50 px-2 py-0.5 text-xs font-medium tabular-nums text-primary-600">
            {topK} 条
          </span>
          <span className="text-xs text-slate-400">
            1–20 条，默认 10；拖动即按新条数重新检索
          </span>
        </div>


        <div className="mt-3 border-t border-slate-100 pt-3">
          <label className="inline-flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" aria-label="结合本次原始输入分析" checked={includeOriginalInput} onChange={(event) => changeOriginalInput(event.target.checked)} className="h-4 w-4 cursor-pointer" />
            <span className="text-sm font-medium text-slate-700">结合本次原始输入分析</span>
          </label>
          <p className="mt-1 pl-6 text-xs leading-5 text-slate-400">默认开启，报告结合原始文字与检索筛查结果；关闭后只依据检索结果。当前大模型不直接解读原始图片或语音。调整后会自动重新生成报告。</p>
        </div>

        {/* 送入检索数据：默认勾上。检索和采集一样会留下一条记录，
            用户不想留痕时可以取消；取消后检索照常，只是不写库。 */}
        <label className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-slate-100 pt-3 cursor-pointer">
          <input
            type="checkbox"
            aria-label="送入检索数据"
            checked={saveToSystem}
            onChange={(e) => setSaveToSystem(e.target.checked)}
            className="h-4 w-4 cursor-pointer"
          />
          <span className="text-sm font-medium text-slate-700">送入检索数据</span>
          <span className="text-xs leading-5 text-slate-400">
            默认开启。本次检索会作为一条记录存入系统，首页「最近一次输入」、我的档案与管理端都能看到；不想留痕就取消勾选。
          </span>
        </label>
        {saveState !== 'idle' && (
          <p
            className={`mt-1.5 flex items-start gap-1.5 pl-6 text-xs ${
              saveState === 'error'
                ? 'text-danger-600'
                : saveState === 'saved'
                  ? 'text-success-600'
                  : 'text-slate-400'
            }`}
          >
            {saveState === 'saving' && <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />}
            {saveState === 'saved' && <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            {saveState === 'error' && <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            {saveMessage}
          </p>
        )}
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
          <RetrievalAssessmentCard
            key={assessment?.supplementId ?? assessmentQueryRef.current}
            assessment={assessment} loading={assessmentLoading} error={assessmentError}
            report={report} reportPhase={reportPhase}
            onSave={() => void saveAssessmentInput()}
            onRefresh={() => void refreshAssessment()}
            onRetryReport={() => { if (assessment) updateReport(assessmentQueryRef.current, results, assessment); }}
          />
          <div className="ui-card ">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                {/* 检索后语料库历史列表会被结果区顶掉，这里留一个明确入口回去，
                    否则用户搜完就找不到那份列表了 */}
                <h3 className="font-semibold text-slate-800">
                  检索参考{' '}
                  <span className="text-sm font-normal text-slate-400">
                    {results.length === 0
                      ? assessment?.references.length ? '（已保存参考的采用依据见上方判断过程）' : '（暂无可展示参考，仍可补充本人情况）'
                      : `（找到 ${results.length} 条候选参考）`}
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
                    检索语料：{indexInfo.dataset}。跨数据集配对素材仅作参考，不视为本人的多模态证据。
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2.5">
                {/* 分析已自动并入上方结论卡，这里保留返回入口。 */}
                <button
                  type="button"
                  onClick={() => {
                    setResults(null);
                    setReport(null);
                    setError(null);
                    setAssessment(null);
                    ++searchSeqRef.current;
                    ++reportSeqRef.current;
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 text-sm font-medium transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" /> 返回历史记录
                </button>
              </div>
            </div>
            {/* 命中主题分布柱状图：让使用者一眼看出"这批相似参考集中在哪些困扰主题上"，
                而不是逐条去读。数据直接来自检索结果的 tags 字段（不需要额外接口）。
                放在结果列表之上作为可视化摘要。 */}
            <div className="px-5 pt-5">
              <ThemeHistogram hits={results} />
            </div>
            <div className="divide-y divide-slate-100">
              {(showAllResults ? results : results.slice(0, 3)).map((result) => {
                const Icon = modalityIcons[result.modality] ?? FileText;
                const modalityLabel = modalityLabels[result.modality] ?? (result.modality || '文本');
                const reference = assessment?.references.find((item) => item.id === result.id);
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
                        <span className="max-w-40 text-right text-xs text-slate-500">
                          {result.labelDescription || (result.screeningLabel === 'positive' ? '样本标签：SDS筛查阳性' : result.screeningLabel === 'negative' ? '样本标签：SDS筛查阴性' : result.alertLevel === 'unknown' ? '仅情绪标签 · 未作心理筛查' : `参考样本标签：${LEVEL_NAME[result.alertLevel] ?? '未评估'}`)}
                        </span>
                        <div className="text-right">
                          <p className="text-lg font-bold text-primary-600 tabular-nums">
                            {(result.similarity * 100).toFixed(0)}%
                          </p>
                          {/* 把裸数字换成「人能读的档位 + 分数条」：
                              >80% 高度相似 / >60% 较相似 / 其余关联较弱 */}
                          <p className="text-xs text-slate-500">
                            {result.similarity >= 0.8 ? '检索相关性较高' : result.similarity >= 0.6 ? '检索相关性' : '关联较弱'}
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
                    <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-5">
                      <p className="font-medium text-slate-700">本次用途：{reference?.usage === 'screening' ? '用于形成上方初筛结论' : reference?.usage === 'followup' ? '用于选择补充问题' : reference?.usage === 'explanation' ? '用于解释参考' : '候选参考，未用于风险定级'}</p>
                      {reference && <p className="mt-1 text-slate-500">{reference.reason}{reference.questionIds.length ? ` · 关联问题 ${reference.questionIds.join('、')}` : ''}</p>}
                      {!reference && <p className="mt-1 text-slate-500">相似度表示检索相关性，不是本人患病概率。</p>}
                    </div>
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
            {results.length > 3 && <div className="border-t border-slate-100 p-4 text-center"><button type="button" onClick={() => setShowAllResults(!showAllResults)} className="text-sm text-primary-600">{showAllResults ? '收起更多参考' : `查看其余 ${results.length - 3} 条参考`}</button></div>}
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
                  onClick={() => void openSavedAssessment(r)}
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
              当前筛选下还没有记录。切回「全部模态」，或先去「心理筛查」补一条这个模态的记录。
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
