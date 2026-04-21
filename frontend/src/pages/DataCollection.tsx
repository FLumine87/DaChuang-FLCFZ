import { useState, useRef, useEffect, useCallback } from 'react';
import {
  FileText, Mic, ImageIcon, Upload, Check, ChevronRight, Sparkles,
  Square, Play, Pause, Trash2, CheckCircle2, X,
} from 'lucide-react';

type Tab = 'text' | 'audio' | 'image';
type RecordState = 'idle' | 'requesting' | 'recording' | 'stopped';

interface AudioEntry {
  id: string;
  name: string;
  url: string;
  duration: number;
  source: 'recorded' | 'uploaded';
}

interface ImageEntry {
  id: string;
  name: string;
  url: string;
  size: string;
}

const questionnaires = [
  { id: 'phq9', name: 'PHQ-9 抑郁症筛查量表', questions: 9, time: '约3分钟' },
  { id: 'gad7', name: 'GAD-7 广泛性焦虑量表', questions: 7, time: '约2分钟' },
  { id: 'scl90', name: 'SCL-90 症状自评量表', questions: 90, time: '约15分钟' },
  { id: 'sds', name: 'SDS 抑郁自评量表', questions: 20, time: '约5分钟' },
  { id: 'sas', name: 'SAS 焦虑自评量表', questions: 20, time: '约5分钟' },
];

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
function AudioTab() {
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [audioList, setAudioList] = useState<AudioEntry[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

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
        setAudioList((prev) => [
          ...prev,
          {
            id,
            name: `录音_${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.webm`,
            url,
            duration: elapsed,
            source: 'recorded',
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
        { id: Date.now().toString() + Math.random(), name: file.name, url, duration: 0, source: 'uploaded' },
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
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
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
                  : 'bg-primary-600 hover:bg-primary-700'
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
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col gap-4">
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
                  className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center shrink-0 hover:bg-primary-700 cursor-pointer"
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
            onClick={() => setSubmitted(true)}
            className="inline-flex items-center justify-center gap-2 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium transition-colors cursor-pointer"
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
      </div>
    </div>
  );
}

// ─── Image Tab ────────────────────────────────────────────────────────────────
function ImageTab() {
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const url = URL.createObjectURL(file);
      setImages((prev) => [
        ...prev,
        { id: Date.now().toString() + Math.random(), name: file.name, url, size: formatBytes(file.size) },
      ]);
    });
    setSubmitted(false);
  }, []);

  const remove = (id: string) => setImages((prev) => prev.filter((img) => img.id !== id));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Drop zone */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="font-semibold text-slate-800 mb-2">绘画 / 图像上传</h3>
        <p className="text-sm text-slate-400 mb-4">
          请上传房树人测试（HTP）或情绪日记配图，用于辅助识别认知与情绪表达特征
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
      </div>

      {/* Preview */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col gap-4">
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
                    className="opacity-0 group-hover:opacity-100 transition-opacity bg-white rounded-full p-1 cursor-pointer"
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
            onClick={() => setSubmitted(true)}
            className="inline-flex items-center justify-center gap-2 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium transition-colors cursor-pointer"
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
      </div>
    </div>
  );
}

// ─── Text Tab ─────────────────────────────────────────────────────────────────
function TextTab() {
  const [selectedQ, setSelectedQ] = useState<string | null>(null);
  const [freeText, setFreeText] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (!freeText.trim()) return;
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 4000);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Questionnaire selector */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="font-semibold text-slate-800 mb-4">选择量表（跳转至筛查页作答）</h3>
        <div className="space-y-2">
          {questionnaires.map((q) => (
            <button
              key={q.id}
              onClick={() => setSelectedQ(selectedQ === q.id ? null : q.id)}
              className={`w-full flex items-center justify-between p-3.5 rounded-lg border transition-colors text-left cursor-pointer ${
                selectedQ === q.id
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  selectedQ === q.id ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-400'
                }`}>
                  {selectedQ === q.id ? <Check className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-800">{q.name}</p>
                  <p className="text-xs text-slate-400">{q.questions} 题 · {q.time}</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300" />
            </button>
          ))}
        </div>
        {selectedQ && (
          <p className="mt-3 text-xs text-slate-400">
            请前往「心理筛查」页面作答 {questionnaires.find(q => q.id === selectedQ)?.name}
          </p>
        )}
      </div>

      {/* Free text */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="font-semibold text-slate-800 mb-2">开放式情绪日记</h3>
        <p className="text-sm text-slate-400 mb-3">
          描述你近期的情绪状态、睡眠情况、人际关系和学习压力变化
        </p>
        <textarea
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          placeholder="今天感觉...最近睡眠...人际上..."
          className="w-full h-44 p-3 border border-slate-200 rounded-lg text-sm text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-slate-400">{freeText.length} 字</span>
          <div className="flex items-center gap-2">
            {submitted && (
              <span className="text-xs text-success-600 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> 已送入哈希检索
              </span>
            )}
            <button
              onClick={handleSubmit}
              disabled={!freeText.trim()}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary-700 transition-colors cursor-pointer"
            >
              提交文本
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function DataCollection() {
  const [activeTab, setActiveTab] = useState<Tab>('text');

  const tabs: { id: Tab; label: string; icon: typeof FileText }[] = [
    { id: 'text', label: '文本采集', icon: FileText },
    { id: 'audio', label: '语音采集', icon: Mic },
    { id: 'image', label: '图像采集', icon: ImageIcon },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-base font-semibold text-slate-800">多模态采集工作台</h3>
        <p className="text-sm text-slate-500 mt-2 leading-6">
          你可以在这里提交文本日记、语音片段和图片。系统会进行动态跨模态哈希编码，与历史模式检索，再结合
          RAG 生成个性化建议。当前为前端原型，不会上传到后端。
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-white rounded-xl border border-slate-200 p-1.5 shadow-sm w-fit">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                isActive ? 'bg-primary-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'text' && <TextTab />}
      {activeTab === 'audio' && <AudioTab />}
      {activeTab === 'image' && <ImageTab />}
    </div>
  );
}
