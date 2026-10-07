import { useRef, useState } from 'react';
import { CheckCircle2, FileText, ImageIcon, Loader2, Mic, Square, X } from 'lucide-react';
import { uploadFile } from '@shared/services/mockApi';
import { useAudioRecorder } from '@shared/hooks/useAudioRecorder';
import { Banner, Card, Chip, PrimaryButton } from '../components/ui';
import { base64ToFile, pickImage } from '../platform/native';

type Tab = 'text' | 'audio' | 'image';

interface Entry {
  id: string;
  name: string;
  size: number;
  previewUrl?: string;
  analysis: string;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export default function DataCollectionPage() {
  const [tab, setTab] = useState<Tab>('text');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // 文本
  const [text, setText] = useState('');

  // 语音
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const recorder = useAudioRecorder((file) => setAudioFile(file));

  // 图像
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const pushEntry = (name: string, size: number, analysis: string, previewUrl?: string) => {
    setEntries((prev) => [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, size, analysis, previewUrl },
      ...prev,
    ]);
  };

  const upload = async (file: File, previewUrl?: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await uploadFile(file);
      pushEntry(res.filename || file.name, file.size, res.analysis, previewUrl);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitText = async () => {
    const content = text.trim();
    if (!content) {
      setError('请先输入内容');
      return;
    }
    const file = new File([content], `self_report_${Date.now()}.txt`, { type: 'text/plain' });
    if (await upload(file)) setText('');
  };

  const submitAudio = async () => {
    if (!audioFile) return;
    if (await upload(audioFile)) setAudioFile(null);
  };

  const chooseImage = async () => {
    setError('');
    const native = await pickImage();
    if (native) {
      const file = base64ToFile(native.base64, native.name, `image/${native.name.split('.').pop()}`);
      setImageFile(file);
      setImagePreview(native.dataUrl);
      return;
    }
    // 非原生环境：退回文件选择器
    imageInputRef.current?.click();
  };

  const submitImage = async () => {
    if (!imageFile) return;
    if (await upload(imageFile, imagePreview ?? undefined)) {
      setImageFile(null);
      setImagePreview(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(
          [
            ['text', '文本自述', FileText],
            ['audio', '语音片段', Mic],
            ['image', '面部图像', ImageIcon],
          ] as [Tab, string, typeof FileText][]
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => {
              setTab(key);
              setError('');
            }}
            className={`flex-1 min-h-[44px] rounded-xl border text-[13px] inline-flex items-center justify-center gap-1.5 transition-colors ${
              tab === key
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-medium'
                : 'border-slate-200 bg-white text-slate-500'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {error && <Banner kind="error">{error}</Banner>}

      {/* ── 文本 ── */}
      {tab === 'text' && (
        <Card className="p-4 space-y-3">
          <p className="text-[13px] text-slate-500 leading-6">
            用几句话描述近期的感受（例如睡眠、情绪、精力、对事情的兴趣）。文本会作为自述模态送入特征编码。
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder="例如：最近两周入睡困难，白天提不起劲，对课程也没什么兴趣……"
            className="w-full px-3 py-3 rounded-xl border border-slate-200 text-[15px] leading-6 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <PrimaryButton onClick={() => void submitText()} disabled={busy} className="!bg-emerald-600">
            {busy ? '处理中…' : '提交文本'}
          </PrimaryButton>
        </Card>
      )}

      {/* ── 语音 ── */}
      {tab === 'audio' && (
        <Card className="p-4 space-y-3">
          <p className="text-[13px] text-slate-500 leading-6">
            录一段语音（最长 60 秒），系统会转成 24414Hz 单声道 WAV 后抽取声学特征。
          </p>

          {recorder.recording ? (
            <div className="rounded-xl bg-danger-50 border border-danger-200 p-4 text-center">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-danger-500 animate-pulse" />
              <p className="text-[15px] font-medium text-danger-600 mt-2">
                正在录音 {recorder.seconds}s
              </p>
              <div className="flex gap-2.5 mt-3">
                <button
                  onClick={recorder.cancel}
                  className="flex-1 min-h-[44px] rounded-xl border border-slate-200 bg-white text-slate-600 text-sm"
                >
                  取消
                </button>
                <button
                  onClick={recorder.stop}
                  className="flex-1 min-h-[44px] rounded-xl bg-danger-600 text-white text-sm font-medium inline-flex items-center justify-center gap-2"
                >
                  <Square className="w-4 h-4" />
                  停止
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => void recorder.start()}
              disabled={!recorder.supported}
              className="w-full min-h-[48px] rounded-xl border-2 border-dashed border-emerald-400 text-emerald-600 text-[15px] font-medium inline-flex items-center justify-center gap-2 active:bg-emerald-50 disabled:opacity-40"
            >
              <Mic className="w-5 h-5" />
              开始录音
            </button>
          )}

          {recorder.error && <Banner kind="error">{recorder.error}</Banner>}

          <button
            onClick={() => audioInputRef.current?.click()}
            className="w-full min-h-[44px] rounded-xl border border-slate-200 text-slate-500 text-[13px] active:bg-slate-50"
          >
            或从文件选择音频
          </button>
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) setAudioFile(f);
            }}
          />

          {audioFile && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
              <Mic className="w-5 h-5 text-emerald-600 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-emerald-800 truncate">{audioFile.name}</p>
                <p className="text-[11px] text-emerald-600">{formatBytes(audioFile.size)}</p>
              </div>
              <button
                onClick={() => setAudioFile(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg active:bg-emerald-100"
              >
                <X className="w-4 h-4 text-emerald-600" />
              </button>
            </div>
          )}

          {audioFile && (
            <PrimaryButton onClick={() => void submitAudio()} disabled={busy} className="!bg-emerald-600">
              {busy ? '上传中…' : '上传语音'}
            </PrimaryButton>
          )}
        </Card>
      )}

      {/* ── 图像 ── */}
      {tab === 'image' && (
        <Card className="p-4 space-y-3">
          <p className="text-[13px] text-slate-500 leading-6">
            拍摄或选择一张面部图像。系统会做灰度化与 HOG 特征抽取，编码为哈希码。
          </p>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/bmp,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setImageFile(f);
              setImagePreview(URL.createObjectURL(f));
            }}
          />
          <button
            onClick={() => void chooseImage()}
            className="w-full min-h-[48px] rounded-xl border-2 border-dashed border-emerald-400 text-emerald-600 text-[15px] font-medium inline-flex items-center justify-center gap-2 active:bg-emerald-50"
          >
            <ImageIcon className="w-5 h-5" />
            {imageFile ? '重新选择' : '拍照 / 从相册选择'}
          </button>

          {imagePreview && (
            <div className="flex items-center gap-3">
              <img
                src={imagePreview}
                alt="待上传图像"
                className="w-16 h-16 rounded-xl object-cover border border-slate-200"
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-slate-700 truncate">{imageFile?.name}</p>
                <p className="text-[11px] text-slate-400">
                  {imageFile ? formatBytes(imageFile.size) : ''}
                </p>
              </div>
              <button
                onClick={() => {
                  setImageFile(null);
                  setImagePreview(null);
                }}
                className="w-8 h-8 flex items-center justify-center rounded-lg active:bg-slate-100"
              >
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
          )}

          {imageFile && (
            <PrimaryButton onClick={() => void submitImage()} disabled={busy} className="!bg-emerald-600">
              {busy ? '上传中…' : '上传图像'}
            </PrimaryButton>
          )}
        </Card>
      )}

      {/* ── 已采集 ── */}
      {entries.length > 0 && (
        <div>
          <p className="text-[15px] font-semibold text-slate-800 px-1 mb-2">本次采集</p>
          <div className="space-y-2.5">
            {entries.map((e) => (
              <Card key={e.id} className="p-4">
                <div className="flex items-start gap-3">
                  {e.previewUrl ? (
                    <img
                      src={e.previewUrl}
                      alt=""
                      className="w-12 h-12 rounded-lg object-cover border border-slate-200 shrink-0"
                    />
                  ) : (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-slate-800 truncate">{e.name}</p>
                    <p className="text-[11px] text-slate-400">{formatBytes(e.size)}</p>
                    <p className="text-[12px] text-slate-600 leading-5 mt-1.5">{e.analysis}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {busy && (
        <p className="text-center text-xs text-slate-400 inline-flex items-center gap-1.5 w-full justify-center">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          正在处理…
        </p>
      )}
    </div>
  );
}
