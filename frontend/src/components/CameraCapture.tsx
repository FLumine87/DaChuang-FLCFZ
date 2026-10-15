import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2, RefreshCw, X } from 'lucide-react';

interface CameraCaptureProps {
  open: boolean;
  onClose: () => void;
  /** 拍照确认后回调，返回 JPEG File（与文件选择同一处理链路） */
  onCapture: (file: File) => void;
}

/**
 * 现场拍照：getUserMedia 取摄像头流 → video 预览 → canvas 截帧成 JPEG File。
 * 关闭 / 组件卸载时释放摄像头；权限被拒、无设备时给出可操作的提示。
 * 拍完先在面板里预览，可重拍，确认后才交给调用方。
 */
export default function CameraCapture({ open, onClose, onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  /** 拍好的画面（dataURL）：先预览再确认，支持重拍 */
  const [shot, setShot] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError('');
    setShot(null);
    setStarting(true);
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (e) {
        const name = (e as DOMException)?.name;
        if (name === 'NotAllowedError') {
          setError('摄像头权限被拒绝：请在浏览器地址栏的权限设置里允许摄像头，然后重新打开。');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setError('没有检测到可用的摄像头。');
        } else {
          setError(`无法打开摄像头：${(e as Error).message || name || '未知错误'}`);
        }
      } finally {
        if (!cancelled) setStarting(false);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open]);

  // hooks 全部在顶部之后才允许提前返回
  if (!open) return null;

  const take = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    setShot(canvas.toDataURL('image/jpeg', 0.92));
  };

  const confirm = () => {
    if (!shot) return;
    const bin = atob(shot.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    onCapture(new File([bytes], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="ui-card w-full max-w-lg p-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="现场拍照"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <Camera className="w-4 h-4 text-primary-600" /> 现场拍照
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer" aria-label="关闭">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="relative rounded-xl overflow-hidden bg-slate-900 aspect-[4/3]">
          {shot ? (
            <img src={shot} alt="拍照结果" className="w-full h-full object-contain" />
          ) : (
            <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
          )}
          {starting && !shot && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-300 text-sm gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> 正在打开摄像头…
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <p className="text-sm text-danger-200 text-center leading-6">{error}</p>
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center justify-end gap-2">
          {shot ? (
            <>
              <button
                onClick={() => setShot(null)}
                className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" /> 重拍
              </button>
              <button
                onClick={confirm}
                className="px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors cursor-pointer"
              >
                用这张检索
              </button>
            </>
          ) : (
            <button
              onClick={take}
              disabled={starting || !!error}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <Camera className="w-4 h-4" /> 拍照
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
