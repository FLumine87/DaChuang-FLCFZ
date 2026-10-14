import { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  FileText, Mic, ImageIcon, Upload, ChevronRight, Sparkles,
  Square, Play, Pause, Trash2, CheckCircle2, AlertCircle, AlertTriangle, X,
} from 'lucide-react';
import {
  uploadFile,
  getScreeningRecords,
  saveScreeningSupplement,
  saveUserSupplement,
  getPersonalSupplements,
  type CollectionAnalysis,
} from '../services/mockApi';
import { questionnaireCatalog } from '../data/mockData';

interface PersistResult {
  ok: boolean;
  /** 后端同步跑哈希检索引擎生成的检索报告（分析失败为 null） */
  report: CollectionAnalysis | null;
}

/* 采集落库：上传完把这条记录挂到最近一次筛查上（后端接口
   POST /api/personal/screenings/{id}/supplement）。
   还没有任何筛查记录时**回退到用户名下**（POST /api/personal/supplements）——
   否则就是"只上传不挂靠"：内容传上去了，但首页「最近一次输入」与
   检索页「我的记录」都看不到它。两种挂靠的读取端已合并展示。
   保存时后端会同步跑一次哈希检索引擎：返回检索报告（等级/结论/命中），
   达到预警级别时预警已挂载到预警中心（响应里的 report.alertId）。 */
async function persistCollection(
  kind: 'text' | 'audio' | 'image',
  payload: { text?: string; filename?: string; url?: string; description?: string },
): Promise<PersistResult> {
  try {
    const records = await getScreeningRecords();
    const target = records.find((r) => r.status === 'completed') ?? records[0];
    const report = target
      ? await saveScreeningSupplement(target.id, { kind, ...payload })
      : await saveUserSupplement({ kind, ...payload });
    return { ok: true, report };
  } catch {
    /* 落库失败不阻塞用户 —— 文件已经传上去了，页面照常提示成功 */
    return { ok: false, report: null };
  }
}

type Tab = 'text' | 'audio' | 'image';
type RecordState = 'idle' | 'requesting' | 'recording' | 'stopped';

/* 报告与命中的等级外观：与全站 稳定/关注/警告/高危 同一套口径 */
const LEVEL_TONE: Record<string, { badge: string; dot: string; text: string }> = {
  green: { badge: 'border-success-500/30 bg-success-50 text-success-700', dot: 'bg-success-500', text: 'text-success-600' },
  yellow: { badge: 'border-warning-500/30 bg-warning-50 text-warning-700', dot: 'bg-warning-500', text: 'text-warning-600' },
  orange: { badge: 'border-orange-500/30 bg-orange-50 text-orange-700', dot: 'bg-orange-500', text: 'text-orange-600' },
  red: { badge: 'border-danger-500/30 bg-danger-50 text-danger-700', dot: 'bg-danger-500', text: 'text-danger-600' },
};
const LEVEL_NAME: Record<string, string> = { green: '稳定', yellow: '关注', orange: '警告', red: '高危' };
const MODALITY_NAME: Record<string, string> = { text: '文本', audio: '语音', image: '图像' };

/* 一次采集的哈希检索报告卡：等级 + 结论 + 命中记录 + 预警回执 */
function ReportCard({ report }: { report: CollectionAnalysis }) {
  const tone = LEVEL_TONE[report.level] ?? LEVEL_TONE.green;
  return (
    <div className="ui-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary-500" />
          <span className="font-semibold text-slate-800">检索报告</span>
          <span className="text-xs text-slate-400">
            {MODALITY_NAME[report.modality] ?? ''}线索{report.createdAt ? ` · ${report.createdAt}` : ''}
          </span>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${tone.badge}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
          {report.levelLabel}
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-700">{report.conclusion}</p>
      <p className="mt-1.5 text-xs text-slate-400">评估依据：{report.reason}</p>

      {report.hits.length > 0 && (
        <div className="mt-3 rounded-xl border border-slate-100 p-3">
          <p className="text-[12.5px] font-medium text-slate-500">
            最相似的语料记录（真实数据集 · 跨模态检索）
          </p>
          <ul className="mt-1.5 divide-y divide-slate-100">
            {report.hits.slice(0, 5).map((hit) => {
              const hTone = LEVEL_TONE[hit.alertLevel] ?? LEVEL_TONE.green;
              return (
                <li key={hit.id} className="flex items-center gap-3 py-2 text-[13px]">
                  <span className="w-9 shrink-0 text-xs text-slate-400">
                    {hit.modalityLabel ?? MODALITY_NAME[hit.modality ?? ''] ?? ''}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-slate-600">{hit.summary}</span>
                  <span className="shrink-0 tabular-nums text-slate-500">{hit.similarity.toFixed(3)}</span>
                  <span className={`shrink-0 text-[11.5px] font-medium ${hTone.text}`}>
                    {LEVEL_NAME[hit.alertLevel] ?? hit.alertLevel}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {report.alertId && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 px-3.5 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger-600" />
          <p className="text-[13px] leading-5 text-danger-700">
            本次分析达到预警级别，已生成预警（{report.alertId}）并同步到预警中心。
            <Link to="/personal/alerts" className="ml-1 font-medium underline underline-offset-2">
              去查看
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

interface AudioEntry {
  id: string;
  name: string;
  url: string;
  duration: number;
  source: 'recorded' | 'uploaded';
  file?: File;
}

interface ImageEntry {
  id: string;
  name: string;
  url: string;
  size: string;
  file?: File;
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

// ─── Audio Tab ────────────────────────────────────────────────────────────────
function AudioTab({ onReport }: { onReport: (r: CollectionAnalysis) => void }) {
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [audioList, setAudioList] = useState<AudioEntry[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startRecording = async () => {
    setError('');
    setRecordState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        const id = Date.now().toString();
        const recFile = new File([blob], `recording_${id}.webm`, { type: 'audio/webm' });
        setAudioList((prev) => [
          ...prev,
          {
            id,
            name: `录音_${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.webm`,
            url,
            duration: elapsed,
            source: 'recorded',
            file: recFile,
          },
        ]);
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start(200);
      recorderRef.current = recorder;
      setElapsed(0);
      setRecordState('recording');
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch {
      setError('无法获取麦克风权限，请在浏览器设置中允许麦克风访问。');
      setRecordState('idle');
    }
  };

  const stopRecording = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    recorderRef.current?.stop();
    setRecordState('stopped');
  };

  const handleUpload = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const url = URL.createObjectURL(file);
      setAudioList((prev) => [
        ...prev,
        { id: Date.now().toString() + Math.random(), name: file.name, url, duration: 0, source: 'uploaded', file },
      ]);
    });
  };

  const togglePlay = (entry: AudioEntry) => {
    if (playingId === entry.id) {
      audioRefs.current[entry.id]?.pause();
      setPlayingId(null);
    } else {
      if (playingId && audioRefs.current[playingId]) {
        audioRefs.current[playingId].pause();
      }
      if (!audioRefs.current[entry.id]) {
        const el = new Audio(entry.url);
        el.onended = () => setPlayingId(null);
        audioRefs.current[entry.id] = el;
      }
      audioRefs.current[entry.id].play();
      setPlayingId(entry.id);
    }
  };

  const removeAudio = (id: string) => {
    audioRefs.current[id]?.pause();
    delete audioRefs.current[id];
    if (playingId === id) setPlayingId(null);
    setAudioList((prev) => prev.filter((a) => a.id !== id));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Recorder */}
      <div className="ui-card p-5">
        <h3 className="font-semibold text-slate-800 mb-4">实时录音</h3>
        <div className="flex flex-col items-center py-6 gap-4">
          {/* Mic button */}
          <button
            onClick={recordState === 'recording' ? stopRecording : startRecording}
            disabled={recordState === 'requesting'}
            className={`w-24 h-24 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-lg
              ${recordState === 'recording'
                ? 'bg-danger-500 hover:bg-danger-600 animate-pulse'
                : recordState === 'requesting'
                  ? 'bg-slate-200 cursor-not-allowed'
                  : 'bg-primary-500 hover:bg-primary-600'
              }`}
          >
            {recordState === 'recording'
              ? <Square className="w-9 h-9 text-white" />
              : <Mic className="w-9 h-9 text-white" />
            }
          </button>

          {/* Status */}
          <div className="text-center">
            {recordState === 'idle' && <p className="text-sm text-slate-500">点击开始录音</p>}
            {recordState === 'requesting' && <p className="text-sm text-slate-400">正在请求麦克风权限...</p>}
            {recordState === 'recording' && (
              <div>
                <p className="text-2xl font-mono font-bold text-danger-500">{formatTime(elapsed)}</p>
                <p className="text-xs text-slate-400 mt-1">录音中，点击停止</p>
              </div>
            )}
            {recordState === 'stopped' && <p className="text-sm text-success-600">录音已保存，可在下方播放</p>}
          </div>

          {error && <p className="text-xs text-danger-600 text-center max-w-xs">{error}</p>}
          <p className="text-xs text-slate-400">建议录制 2-5 分钟语音，用于情感与韵律特征分析</p>
        </div>
      </div>

      {/* Upload & List */}
      <div className="ui-card p-5 flex flex-col gap-4">
        <h3 className="font-semibold text-slate-800">上传 / 已采集音频</h3>

        <div
          onClick={() => uploadRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleUpload(e.dataTransfer.files); }}
          className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center hover:border-primary-400 hover:bg-primary-50/30 transition-colors cursor-pointer"
        >
          <Upload className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-600">拖拽或点击上传音频文件</p>
          <p className="text-xs text-slate-400 mt-1">支持 MP3、WAV、M4A、WebM，最大 50MB</p>
        </div>
        <input
          ref={uploadRef}
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />

        {audioList.length > 0 ? (
          <div className="space-y-2 flex-1 overflow-y-auto max-h-64">
            {audioList.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                <button
                  onClick={() => togglePlay(entry)}
                  className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center shrink-0 hover:bg-primary-600 cursor-pointer"
                >
                  {playingId === entry.id
                    ? <Pause className="w-3.5 h-3.5 text-white" />
                    : <Play className="w-3.5 h-3.5 text-white" />
                  }
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 truncate">{entry.name}</p>
                  <p className="text-xs text-slate-400">
                    {entry.source === 'recorded' ? `录制 · ${formatTime(entry.duration)}` : '上传'}
                  </p>
                </div>
                <button onClick={() => removeAudio(entry.id)} className="text-slate-300 hover:text-danger-500 cursor-pointer">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400 text-center py-4">暂无音频，录制或上传后显示在这里</p>
        )}

        {audioList.length > 0 && !submitted && (
          <button
            onClick={async () => {
              setUploadError('');
              const failed: string[] = [];
              for (const entry of audioList) {
                if (!entry.file) continue;
                try {
                  const up = await uploadFile(entry.file);
                  const res = await persistCollection('audio', { filename: up.filename, url: up.url, description: up.analysis });
                  if (res.report) onReport(res.report);
                } catch (e) {
                  console.error('上传音频失败', e);
                  failed.push(entry.name);
                }
              }
              // 只有真正全部成功才报成功。之前无论成败都显示"哈希编码完成"，
              // 而后端 /api/upload 目前固定返回 503，属于误报。
              if (failed.length) {
                setUploadError(`${failed.length} 个文件未能上传：${failed.join('、')}`);
              } else {
                setSubmitted(true);
              }
            }}
            className="inline-flex items-center justify-center gap-2 py-2.5 bg-primary-500 text-white rounded-lg hover:bg-primary-600 text-sm font-medium transition-colors cursor-pointer"
          >
            <Sparkles className="w-4 h-4" /> 送入动态哈希引擎
          </button>
        )}
        {submitted && (
          <div className="flex items-center gap-2 py-2.5 px-4 bg-success-50 rounded-lg border border-success-500/30">
            <CheckCircle2 className="w-4 h-4 text-success-600" />
            <p className="text-sm text-success-700">已提交 {audioList.length} 条音频，哈希编码完成</p>
          </div>
        )}
        {uploadError && (
          <div className="flex items-start gap-2 py-2.5 px-4 bg-danger-50 rounded-lg border border-danger-500/30">
            <AlertCircle className="w-4 h-4 text-danger-600 mt-0.5 shrink-0" />
            <p className="text-sm text-danger-700">
              {uploadError}
              <span className="text-danger-600/80">
                （本部署的文件上传后端尚未启用，返回 503；数据未送入哈希引擎）
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Image Tab ────────────────────────────────────────────────────────────────
function ImageTab({ onReport }: { onReport: (r: CollectionAnalysis) => void }) {
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const url = URL.createObjectURL(file);
      setImages((prev) => [
        ...prev,
        { id: Date.now().toString() + Math.random(), name: file.name, url, size: formatBytes(file.size), file },
      ]);
    });
    setSubmitted(false);
  }, []);

  const remove = (id: string) => setImages((prev) => prev.filter((img) => img.id !== id));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Drop zone */}
      <div className="ui-card p-5">
        <h3 className="font-semibold text-slate-800 mb-2">绘画 / 图像上传</h3>
        <p className="text-sm text-slate-500 mb-4">
          可上传房树人绘画或情绪日记配图。图片仅用于辅助了解情绪表达，不能单独作为诊断依据。
        </p>
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
            ${dragging ? 'border-primary-500 bg-primary-50' : 'border-slate-200 hover:border-primary-400 hover:bg-primary-50/30'}`}
        >
          <ImageIcon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-600">拖拽图片到此处，或点击选择文件</p>
          <p className="text-xs text-slate-400 mt-1">支持 JPG、PNG、WEBP，最大 20MB</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
        <div className="mt-3 space-y-1 text-xs leading-5 text-slate-500">
          <p className="text-[12px]">房树人（HTP）：画一幅包含房子、树和人的图，拍照或扫描后上传；不需要画得好看。</p>
          <p>情绪日记配图：上传能表达当天心情的照片或画，例如风景或涂鸦。</p>
        </div>
      </div>

      {/* Preview */}
      <div className="ui-card p-5 flex flex-col gap-4">
        <h3 className="font-semibold text-slate-800">已上传图像（{images.length}）</h3>

        {images.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">上传后图像预览显示在这里</div>
        ) : (
          <div className="grid grid-cols-2 gap-3 overflow-y-auto max-h-72">
            {images.map((img) => (
              <div key={img.id} className="relative group rounded-lg overflow-hidden border border-slate-200">
                <img src={img.url} alt={img.name} className="w-full h-28 object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                  <button
                    onClick={() => remove(img.id)}
                    aria-label="移除这张图片"
                    className="bg-white rounded-md p-1 cursor-pointer"
                  >
                    <X className="w-4 h-4 text-danger-500" />
                  </button>
                </div>
                <p className="text-xs text-slate-500 truncate px-2 py-1 bg-white">{img.name}</p>
              </div>
            ))}
          </div>
        )}

        {images.length > 0 && !submitted && (
          <button
            onClick={async () => {
              setUploadError('');
              const failed: string[] = [];
              for (const img of images) {
                if (!img.file) continue;
                try {
                  const up = await uploadFile(img.file);
                  const res = await persistCollection('image', { filename: up.filename, url: up.url, description: up.analysis });
                  if (res.report) onReport(res.report);
                } catch (e) {
                  console.error('上传图像失败', e);
                  failed.push(img.name);
                }
              }
              // 同上：只有真正全部成功才报成功，避免"哈希编码完成"的误报
              if (failed.length) {
                setUploadError(`${failed.length} 张图像未能上传：${failed.join('、')}`);
              } else {
                setSubmitted(true);
              }
            }}
            className="inline-flex items-center justify-center gap-2 py-2.5 bg-primary-500 text-white rounded-lg hover:bg-primary-600 text-sm font-medium transition-colors cursor-pointer"
          >
            <Sparkles className="w-4 h-4" /> 送入动态哈希引擎
          </button>
        )}
        {submitted && (
          <div className="flex items-center gap-2 py-2.5 px-4 bg-success-50 rounded-lg border border-success-500/30">
            <CheckCircle2 className="w-4 h-4 text-success-600" />
            <p className="text-sm text-success-700">已提交 {images.length} 张图像，图像哈希编码完成</p>
          </div>
        )}
        {uploadError && (
          <div className="flex items-start gap-2 py-2.5 px-4 bg-danger-50 rounded-lg border border-danger-500/30">
            <AlertCircle className="w-4 h-4 text-danger-600 mt-0.5 shrink-0" />
            <p className="text-sm text-danger-700">
              {uploadError}
              <span className="text-danger-600/80">
                （本部署的文件上传后端尚未启用，返回 503；数据未送入哈希引擎）
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Text Tab ─────────────────────────────────────────────────────────────────
function TextTab({ onReport }: { onReport: (r: CollectionAnalysis) => void }) {
  const [freeText, setFreeText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  /* 保存日记：不经过文件上传，直接作为 text 类型的补充落库
     （有筛查记录挂记录、没有就挂用户名下，与语音/图片共用同一条读取链路：
     首页「最近一次输入」+ 检索页「我的记录」）。
     保存后后端同步跑哈希检索引擎，返回的检索报告交给页面底部展示。 */
  const submitDiary = async () => {
    const content = freeText.trim();
    if (!content) {
      setError('请先写下此刻的感受，再保存');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await persistCollection('text', { text: content });
      if (res.ok) {
        setSaved(true);
        if (res.report) onReport(res.report);
      } else {
        setError('保存失败，请检查网络后重试');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Questionnaire selector：点击直接跳转到筛查页并打开对应量表 */}
      <div className="ui-card p-5">
        <h3 className="font-semibold text-slate-800 mb-4">选择量表开始作答</h3>
        <div className="space-y-2">
          {questionnaireCatalog.map((q) => (
            <Link
              key={q.id}
              to={`/personal/screening?paper=${encodeURIComponent(q.id)}`}
              title={`去作答 ${q.name}`}
              className="w-full flex items-center justify-between p-3.5 rounded-lg border border-slate-200 hover:border-primary-400 hover:bg-primary-50 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-slate-100 text-slate-400">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-800">{q.name}</p>
                  <p className="text-xs text-slate-400">{q.questions} 题 · 约{q.minutes}分钟</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </Link>
          ))}
        </div>
      </div>

      {/* Free text */}
      <div className="ui-card p-5">
        <h3 className="font-semibold text-slate-800 mb-2">开放式情绪日记</h3>
        <p className="text-sm text-slate-400 mb-3">
          描述你近期的情绪状态、睡眠情况、人际关系和学习压力变化
        </p>
        <textarea
          aria-label="情绪日记内容"
          value={freeText}
          onChange={(e) => {
            setFreeText(e.target.value);
            setSaved(false);
            setError('');
          }}
          placeholder="今天感觉...最近睡眠...人际上..."
          className="w-full h-44 p-3 border border-slate-200 rounded-lg text-sm text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-slate-400">{freeText.length} 字</span>
          <div className="flex items-center gap-2">
            <button
              onClick={submitDiary}
              disabled={saving || !freeText.trim()}
              className="px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary-600 transition-colors cursor-pointer"
            >
              {saving ? '正在保存…' : '保存到我的档案'}
            </button>
          </div>
        </div>
        {saved && (
          <div className="mt-3 flex items-center gap-2 py-2.5 px-4 bg-success-50 rounded-lg border border-success-500/30">
            <CheckCircle2 className="w-4 h-4 text-success-600" />
            <p className="text-sm text-success-700">
              日记已保存，可在首页「最近一次输入」与「检索与分析」中查看
            </p>
          </div>
        )}
        {error && (
          <div className="mt-3 flex items-start gap-2 py-2.5 px-4 bg-danger-50 rounded-lg border border-danger-500/30">
            <AlertCircle className="w-4 h-4 text-danger-600 mt-0.5 shrink-0" />
            <p className="text-sm text-danger-700">{error}</p>
          </div>
        )}
        <p className="mt-3 text-xs leading-5 text-slate-500">
          日记会保存到你的档案，仅用于自我回顾与检索分析。
        </p>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function DataCollection() {
  const [activeTab, setActiveTab] = useState<Tab>('text');
  /* 检索报告（新提交的在前）。进入页面时先载入挂载历史里带分析的记录，
     本次会话新提交的实时插到最前 —— 刷新/换设备都还能看到结论。 */
  const [reports, setReports] = useState<CollectionAnalysis[]>([]);
  const pushReport = useCallback((report: CollectionAnalysis) => {
    setReports((prev) => [report, ...prev].slice(0, 5));
  }, []);
  useEffect(() => {
    let alive = true;
    getPersonalSupplements()
      .then((list) => {
        if (!alive) return;
        const history = list
          .filter((s) => s.analysis)
          .map((s) => s.analysis as CollectionAnalysis)
          .slice(0, 5);
        if (history.length) setReports((prev) => (prev.length ? prev : history));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const tabs: { id: Tab; label: string; icon: typeof FileText }[] = [
    { id: 'text', label: '文本采集', icon: FileText },
    { id: 'audio', label: '语音采集', icon: Mic },
    { id: 'image', label: '图像采集', icon: ImageIcon },
  ];

  return (
    <div className="space-y-6">
      <div className="ui-card p-5">
        <h3 className="text-base font-semibold text-slate-800">多模态采集工作台</h3>
        <p className="text-sm text-slate-500 mt-2 leading-6">
          你可以在这里提交文本日记、语音片段和图片。提交后会在页面下方给出
          <span className="font-medium text-slate-600">哈希检索引擎的检索报告</span>
          （相似语料记录、风险等级与结论）；达到预警级别时会同步挂载到预警中心。
        </p>
      </div>

      {/* Tabs */}
      {/* 分段控件用**控件圆角**（rounded-xl = 12px），不用卡片那套 24px。
         24px 圆角套在 44px 高的条上会变成药丸形，和里面的按钮叠在一起
         整块都像药丸；改用控件圆角之后是规规矩矩的长方形，与项目里
         .ui-button（--control-radius）一致。 */}
      {/* 右侧缩进一点：这条分段控件是 w-fit 的窄条，和上面整宽的卡片同为
          左对齐时会贴着同一个左边界，看着"杵在最左边"。缩进一档之后
          它读起来更像上面那张卡片的附属操作条，不再抢左边界。 */}
      <div className="ml-2 flex w-fit gap-1.5 rounded-lg border border-slate-200 bg-white p-1.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
                isActive ? 'bg-primary-500 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'text' && <TextTab onReport={pushReport} />}
      {activeTab === 'audio' && <AudioTab onReport={pushReport} />}
      {activeTab === 'image' && <ImageTab onReport={pushReport} />}

      {/* ============ 检索报告（本页底部）============
          提交后由后端哈希检索引擎同步分析；报告连同结论一起挂载在补充记录上，
          这里展示最新的几份（含进入页面前的历史结论）。 */}
      <div className="pt-2">
        <p className="ml-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-primary-500">
          检索报告
        </p>
        {reports.length > 0 ? (
          <div className="mt-3 space-y-4">
            {reports.map((report, idx) => (
              <ReportCard key={`${report.createdAt ?? ''}-${idx}`} report={report} />
            ))}
          </div>
        ) : (
          <div className="ui-card mt-3 p-5">
            <p className="text-sm text-slate-400">
              提交文本日记、语音或图像后，这里会显示哈希检索引擎的检索报告：
              相似语料记录、风险等级与处置建议。报告会随采集内容一起挂载到你的档案。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
