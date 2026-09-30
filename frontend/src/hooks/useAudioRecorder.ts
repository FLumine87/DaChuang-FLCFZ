import { useCallback, useEffect, useRef, useState } from 'react';
import { toCorpusWavFile } from '../utils/audioRecorder';

/** 单次录音上限：语料片段约 2.3s，60s 足够，同时挡住忘停导致的超大体积 */
const MAX_SECONDS = 60;

export interface AudioRecorder {
  /** 是否正在录音 */
  recording: boolean;
  /** 已录秒数 */
  seconds: number;
  /** 浏览器是否支持录音（不支持时前端应禁用「直接录音」） */
  supported: boolean;
  error: string | null;
  start: () => Promise<void>;
  /** 停止并回调 onComplete（转码为 WAV 后） */
  stop: () => void;
  /** 停止且丢弃本次录音 */
  cancel: () => void;
}

/**
 * 麦克风录音 -> WAV 文件。
 *
 * onComplete 收到的是已转码的 24414Hz 单声道 WAV，可直接走上传链路。
 */
export function useAudioRecorder(onComplete: (file: File) => void): AudioRecorder {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  // onComplete 每次渲染都是新函数；放进 ref 避免录音期间拿到过期闭包
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const supported =
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia;

  const release = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!supported) {
      setError('当前浏览器不支持录音，请改用「从文件选择」');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];
      cancelledRef.current = false;

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        const dropped = cancelledRef.current;
        release();
        setRecording(false);
        setSeconds(0);
        if (dropped || blob.size === 0) return;
        try {
          onCompleteRef.current(await toCorpusWavFile(blob, 'recording.wav'));
        } catch {
          setError('录音转码失败，请改用「从文件选择」');
        }
      };

      rec.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) recorderRef.current?.stop();
          return s + 1;
        });
      }, 1000);
    } catch {
      release();
      setRecording(false);
      setSeconds(0);
      setError('无法访问麦克风（授权被拒绝或没有可用设备）');
    }
  }, [release, supported]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    recorderRef.current?.stop();
  }, []);

  // 组件卸载时释放麦克风，避免指示灯一直亮
  useEffect(() => release, [release]);

  return { recording, seconds, supported, error, start, stop, cancel };
}