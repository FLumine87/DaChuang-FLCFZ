import { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  FileText, Mic, ImageIcon, Upload, Sparkles, Camera,
  Square, Play, Pause, Trash2, CheckCircle2, AlertCircle, X,
  ClipboardList, Search, ArrowRight,
} from 'lucide-react';
import {
  uploadFile,
  saveUserSupplement,
  type CollectionAnalysis,
} from '../services/mockApi';
import ScreeningWorkspace from './ScreeningWorkspace';
import Retrieval from './Retrieval';
import { RetainedView } from '../components/RetainedWorkspace';
import { usePageActive } from '../services/pageActivity';

interface PersistResult {
  ok: boolean;
  /** 后端同步跑哈希检索引擎生成的检索报告（分析失败为 null） */
  report: CollectionAnalysis | null;
}

/* 采集按用户独立保存，使用同次多模态检索生成筛查快照，不绑定量表。 */
async function persistCollection(
  kind: 'text' | 'audio' | 'image',
  payload: { text?: string; filename?: string; url?: string; description?: string },
): Promise<PersistResult> {
  try {
    const report = await saveUserSupplement({ kind, ...payload, analysisMode: 'retrieval' });
    return { ok: true, report };
  } catch {
    /* 落库失败不阻塞用户 —— 文件已经传上去了，页面照常提示成功 */
    return { ok: false, report: null };
  }
}

/* 「心理筛查」一页四件事：
   text / audio / image / scale 是**采集**（把近况记下来），
   retrieval 是**检索**（拿这些记录去比对相似样本、看分析结论）。
   合并成一页后，采集完顺手就能检索，不用在两个菜单之间来回跳。 */
type Tab = 'text' | 'audio' | 'image' | 'scale' | 'retrieval';
type RecordState = 'idle' | 'requesting' | 'recording' | 'stopped';

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

interface CollectionInputProps {
  onReport: (report: CollectionAnalysis) => void;
  onInputChange: () => void;
}

function useCollectionRevision(onInputChange: () => void) {
  const revision = useRef(0);
  useEffect(() => () => { revision.current++; }, []);
  const invalidate = useCallback(() => {
    revision.current++;
    onInputChange();
  }, [onInputChange]);
  return { revision, invalidate };
}

// ─── Audio Tab ────────────────────────────────────────────────────────────────
function AudioTab({ onReport, onInputChange }: CollectionInputProps) {
  const pageActive = usePageActive();
  const activeRef = useRef(pageActive);
  useEffect(() => { activeRef.current = pageActive; }, [pageActive]);
  const { revision, invalidate } = useCollectionRevision(onInputChange);
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
    if (pageActive) return;
    if (timerRef.current) clearInterval(timerRef.current);
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
      setRecordState('stopped');
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    Object.values(audioRefs.current).forEach((audio) => audio.pause());
    setPlayingId(null);
  }, [pageActive]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startRecording = async () => {
    invalidate();
    setSubmitted(false);
    setError('');
    setRecordState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!activeRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        setRecordState('idle');
        return;
      }
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
    if (!files?.length) return;
    invalidate();
    setSubmitted(false);
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
    invalidate();
    setSubmitted(false);
    audioRefs.current[id]?.pause();
    delete audioRefs.current[id];
    if (playingId === id) setPlayingId(null);
    setAudioList((prev) => prev.filter((a) => a.id !== id));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-[360px]">
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
              const sequence = revision.current;
              setUploadError('');
              const failed: string[] = [];
              for (const entry of audioList) {
                if (!entry.file) continue;
                try {
                  const up = await uploadFile(entry.file);
                  if (sequence !== revision.current) return;
                  const res = await persistCollection('audio', { filename: up.filename, url: up.url, description: up.analysis });
                  if (sequence !== revision.current) return;
                  if (!res.ok) throw new Error('本次采集保存失败，请重试');
                  if (res.report) onReport(res.report);
                } catch (e) {
                  console.error('上传音频失败', e);
                  failed.push(entry.name);
                }
              }
              // 只有真正全部成功才报成功。之前无论成败都显示"哈希编码完成"，
              // 而后端 /api/upload 目前固定返回 503，属于误报。
              if (sequence !== revision.current) return;
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
function ImageTab({ onReport, onInputChange }: CollectionInputProps) {
  const { revision, invalidate } = useCollectionRevision(onInputChange);
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [submittedCount, setSubmittedCount] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const addFiles = useCallback((files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (!list.length) return;
    invalidate();
    setSubmitted(false);
    setImages((prev) => [
      ...prev,
      ...list.map((file) => ({
        id: Date.now().toString() + Math.random(),
        name: file.name,
        url: URL.createObjectURL(file),
        size: formatBytes(file.size),
        file,
      })),
    ]);
  }, [invalidate]);

  useEffect(() => {
    if (!cameraOpen) return;
    let cancelled = false;
    setCameraError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('当前浏览器不支持直接拍照，请改用选择文件。');
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      // 桌面端没有后置摄像头时，回退到任意可用摄像头。
      .catch(() => navigator.mediaDevices.getUserMedia({ video: true, audio: false }))
      .then((stream) => {
        if (cancelled || !videoRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        void videoRef.current.play();
      })
      .catch(() => {
        if (!cancelled) setCameraError('无法访问摄像头（授权被拒绝或没有可用设备），可改用选择文件。');
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [cameraOpen]);

  useEffect(() => {
    if (!cameraOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCameraOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [cameraOpen]);

  const capturePhoto = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setCameraError('摄像头尚未就绪，请稍候再试。');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) {
      setCameraError('拍照失败，请重试。');
      return;
    }
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const name = `photo-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-`
      + `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.jpg`;
    addFiles([new File([blob], name, { type: 'image/jpeg' })]);
    setCameraOpen(false);
  };

  const remove = (id: string) => {
    invalidate();
    setSubmitted(false);
    setImages((prev) => prev.filter((img) => img.id !== id));
  };

  return (
    <>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-[360px]">
      {/* Drop zone */}
      <div className="ui-card p-5">
        <h3 className="font-semibold text-slate-800 mb-2">绘画 / 图像上传</h3>
        <p className="text-sm text-slate-500 mb-4">
          可上传情绪记录配图。图片仅用于辅助了解情绪表达，不能单独作为诊断依据。
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 px-4 py-8 text-center transition-colors hover:border-primary-400 hover:bg-primary-50/30 cursor-pointer"
          >
            <Camera className="w-8 h-8 text-slate-400" />
            <p className="text-sm font-medium text-slate-700">拍照</p>
            <p className="text-xs leading-5 text-slate-400">调用摄像头拍摄</p>
          </button>
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
            className={`flex h-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center cursor-pointer transition-colors
              ${dragging ? 'border-primary-500 bg-primary-50' : 'border-slate-200 hover:border-primary-400 hover:bg-primary-50/30'}`}
          >
            <Upload className="w-8 h-8 text-slate-400" />
            <p className="text-sm font-medium text-slate-700">选择文件</p>
            <p className="text-xs leading-5 text-slate-400">拖拽或点击，支持 JPG、PNG、WEBP，最大 20MB</p>
          </div>
        </div>
        <div className="mt-3 space-y-1 text-xs leading-5 text-slate-500">
          <p>情绪记录配图：上传能表达当天心情的照片或画。</p>
        </div>
      </div>

      {/* Preview：送入哈希引擎后清空列表，只保留提交结果 */}
      <div className="ui-card p-5 flex flex-col gap-4">
        {submitted ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <CheckCircle2 className="w-8 h-8 text-success-600" />
            <p className="text-sm text-success-700">已提交 {submittedCount} 张图像，图像哈希编码完成</p>
            <p className="text-xs text-slate-400">如需继续提交，重新拍照或选择文件即可。</p>
          </div>
        ) : (
          <>
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

            {images.length > 0 && (
              <button
                onClick={async () => {
                  const sequence = revision.current;
                  setUploadError('');
                  const failed: string[] = [];
                  for (const img of images) {
                    if (!img.file) continue;
                    try {
                      const up = await uploadFile(img.file);
                      if (sequence !== revision.current) return;
                      const res = await persistCollection('image', { filename: up.filename, url: up.url, description: up.analysis });
                      if (sequence !== revision.current) return;
                      if (!res.ok) throw new Error('本次采集保存失败，请重试');
                      if (res.report) onReport(res.report);
                    } catch (e) {
                      console.error('上传图像失败', e);
                      failed.push(img.name);
                    }
                  }
                  // 同上：只有真正全部成功才报成功，避免"哈希编码完成"的误报
                  if (sequence !== revision.current) return;
                  if (failed.length) {
                    setUploadError(`${failed.length} 张图像未能上传：${failed.join('、')}`);
                  } else {
                    setSubmittedCount(images.length);
                    setImages([]);
                    setSubmitted(true);
                  }
                }}
                className="inline-flex items-center justify-center gap-2 py-2.5 bg-primary-500 text-white rounded-lg hover:bg-primary-600 text-sm font-medium transition-colors cursor-pointer"
              >
                <Sparkles className="w-4 h-4" /> 送入动态哈希引擎
              </button>
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
          </>
        )}
      </div>
    </div>

    {cameraOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        role="dialog"
        aria-modal="true"
        aria-label="拍照采集"
      >
        <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">拍照</h3>
            <button
              type="button"
              onClick={() => setCameraOpen(false)}
              aria-label="关闭拍照"
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
            <video ref={videoRef} playsInline muted className="h-full w-full object-contain" />
            {cameraError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-4 text-center text-sm leading-6 text-white">
                {cameraError}
              </div>
            )}
          </div>
          <div className="mt-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setCameraOpen(false)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void capturePhoto()}
              disabled={Boolean(cameraError)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-40 transition-colors cursor-pointer"
            >
              <Camera className="h-4 w-4" /> 拍摄
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// ─── Text Tab ─────────────────────────────────────────────────────────────────
function TextTab({ onReport, onInputChange }: CollectionInputProps) {
  const { revision, invalidate } = useCollectionRevision(onInputChange);
  const [freeText, setFreeText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  /* 保存成功后拿到的补充记录 id：跳转检索页时带上它，可以直接打开这条记录
     已经算好的结论，而不是让用户再去手动搜一遍。 */
  const [savedSupplementId, setSavedSupplementId] = useState<number | null>(null);

  /* 保存这段文字：不经过文件上传，直接作为 text 类型的补充落库
     （有筛查记录挂记录、没有就挂用户名下，与语音/图片共用同一条读取链路：
     首页「最近一次输入」+ 筛查记录）。
     保存后后端同步跑哈希检索引擎，返回的检索报告交给页面底部展示。 */
  const submitDiary = async () => {
    const content = freeText.trim();
    if (!content) {
      setError('请先写下此刻的感受，再保存');
      return;
    }
    const sequence = revision.current;
    onInputChange();
    setSaving(true);
    setError('');
    try {
      const res = await persistCollection('text', { text: content });
      if (sequence !== revision.current) return;
      if (res.ok) {
        setSaved(true);
        setSavedSupplementId(res.report?.supplementId ?? null);
        if (res.report) onReport(res.report);
      } else {
        setError('保存失败，请检查网络后重试');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    /* 纯文本采集：量表入口已经独立成「量表填写」标签页，这里只留文字记录本身 */
    <div className="ui-card p-5 min-h-[360px] flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-800">文本采集</h3>
          <p className="mt-1 text-sm text-slate-500">
            描述您近期的情绪状态、睡眠情况、人际关系和学习压力变化。
          </p>
        </div>
        <span className="text-xs text-slate-400">{freeText.length} 字</span>
      </div>
      <textarea
        aria-label="文本采集内容"
        value={freeText}
        onChange={(e) => {
          invalidate();
          setSavedSupplementId(null);
          setFreeText(e.target.value);
          setSaved(false);
          setError('');
        }}
        placeholder="今天感觉……最近睡眠……人际上……"
        className="mt-4 w-full flex-1 min-h-32 p-3 border border-slate-200 rounded-lg text-sm text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
      />
      <div className="flex flex-wrap items-center justify-between gap-3 mt-auto pt-3">
        <p className="text-xs leading-5 text-slate-500">
          这段文字会保存到您的档案，仅用于自我回顾与检索分析。
        </p>
        <button
          onClick={submitDiary}
          disabled={saving || !freeText.trim()}
          className="px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary-600 transition-colors cursor-pointer"
        >
          {saving ? '正在保存…' : '保存到我的档案'}
        </button>
      </div>
      {saved && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-success-500/30 bg-success-50 py-2.5 px-4">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success-600" />
          <p className="min-w-0 flex-1 text-sm leading-6 text-success-700">
            记录已保存到您的档案，可在「筛查记录」里回看。
          </p>
          {/* 直接把这次写的内容带进检索页并自动分析 —— 用户不用再手动搜一遍。
              带上 supplementId 还能直接打开这条记录已算好的结论。 */}
          <Link
            to={`/personal/screening?tab=retrieval&q=${encodeURIComponent(freeText.trim())}${
              savedSupplementId ? `&assessmentSupplementId=${savedSupplementId}` : ''
            }`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-success-600 px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-success-700"
          >
            用这段文字做检索分析
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
      {error && (
        <div className="mt-3 flex items-start gap-2 py-2.5 px-4 bg-danger-50 rounded-lg border border-danger-500/30">
          <AlertCircle className="w-4 h-4 text-danger-600 mt-0.5 shrink-0" />
          <p className="text-sm text-danger-700">{error}</p>
        </div>
      )}
    </div>
  );
}

// 当前表单会话随工作页保留，修改输入时才清理旧结果。
function CollectionSession({ kind }: { kind: 'text' | 'audio' | 'image' }) {
  const [report, setReport] = useState<CollectionAnalysis | null>(null);
  const clearReport = useCallback(() => setReport(null), []);
  const receiveReport = useCallback((value: CollectionAnalysis) => {
    if (value.modality === kind) setReport(value);
  }, [kind]);
  const Input = kind === 'text' ? TextTab : kind === 'audio' ? AudioTab : ImageTab;
  return <div className="space-y-6">
    <Input onReport={receiveReport} onInputChange={clearReport} />
    {report && <section aria-label="本次采集分析结果" className="space-y-3">
      <p className="text-sm font-medium text-primary-600">本次采集分析结果</p>
      <Retrieval key={report.supplementId} collectionReport={report} />
    </section>}
  </div>;
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function DataCollection() {
  const [params, setParams] = useSearchParams();
  /* 标签页完全由地址栏决定，不另存一份 state ——
     两条入口都得能直达：?tab=audio|text|image|scale 来自侧栏和首页按钮；
     ?record= / ?paper= 来自记录详情与「去作答」，这类链接不带 tab，
     所以带记录参数时一律算量表页。派生值而不是用 effect 同步 state，
     也就不会出现"地址栏改了、界面慢一拍"。 */
  const tabParam = params.get('tab');
  const activeTab: Tab =
    params.get('record') || params.get('paper')
      ? 'scale'
      : tabParam === 'audio' || tabParam === 'image' || tabParam === 'scale' || tabParam === 'retrieval'
        ? tabParam
        : 'text';

  /* 切标签页只改地址栏；顺手清掉 record/paper ——
     否则切回量表页会直接落在上一次的详情里，回不到列表。 */
  const selectTab = (id: Tab) => {
    if (id === activeTab) return;
    const next = new URLSearchParams(params);
    next.set('tab', id);
    next.delete('record');
    next.delete('paper');
    setParams(next, { replace: true });
  };

  const tabs: { id: Tab; label: string; icon: typeof FileText }[] = [
    { id: 'text', label: '文本采集', icon: FileText },
    { id: 'audio', label: '语音采集', icon: Mic },
    { id: 'image', label: '图像采集', icon: ImageIcon },
    { id: 'scale', label: '量表填写', icon: ClipboardList },
    { id: 'retrieval', label: '检索分析', icon: Search },
  ];

  return (
    <div className="space-y-6">
      <div className="ui-card p-5">
        <h3 className="text-base font-semibold text-slate-800">记录一次，也能查一次</h3>
        <p className="text-sm text-slate-500 mt-2 leading-6">
          量表用于标准计分，文本、语音和图像用于补充本人近况。
          这些记录既能作为<b className="font-medium text-slate-600">本次筛查的依据</b>，
          也能在「检索分析」里<b className="font-medium text-slate-600">比对相似样本、拿到有据可循的结论</b>。
          需要专业复核时会同步生成预警；参考样本标签不直接作为本人结论。
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
      <div className="ml-2 flex w-fit max-w-full flex-wrap gap-1.5 rounded-lg border border-slate-200 bg-white p-1.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => selectTab(tab.id)}
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

      {(['text', 'audio', 'image'] as const).map((kind) => (
        <RetainedView key={kind} active={activeTab === kind}><CollectionSession kind={kind} /></RetainedView>
      ))}
      <RetainedView active={activeTab === 'scale'}><ScreeningWorkspace /></RetainedView>
      {/* 检索分析：与采集同页。Retrieval 的根元素是 space-y-6 的普通容器，
          直接嵌进来即可，不需要为它另做一套页面外壳。 */}
      <RetainedView active={activeTab === 'retrieval'}><Retrieval /></RetainedView>


    </div>
  );
}
