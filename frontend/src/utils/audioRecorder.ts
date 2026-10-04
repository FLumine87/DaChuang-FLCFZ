/**
 * 浏览器录音 -> 后端可用的 PCM WAV。
 *
 * 为什么不能直接用 MediaRecorder 产出的文件：
 * MediaRecorder 默认给的是 webm/opus，而后端语音特征走 Python wave 模块、
 * 只解析 PCM（16bit 分支），webm 会直接抽取失败。所以录完先解码成原始采样，
 * 再重新编码为 16bit 单声道 WAV。
 *
 * 为什么重采样到 24414Hz：
 * 真实语料 300 条语音全部是 24414Hz。后端梅尔滤波器组按文件自身采样率构建，
 * 但 FFT 点数固定（_N_FFT），采样率越高低频分辨率越粗、每帧统计量也随帧数漂移，
 * 会让查询特征与语料分布对不齐。统一到语料采样率可消除这个系统性偏差。
 */

/** 真实语料统一采样率（见 backend/app/engines/hashing/real_features.py） */
export const CORPUS_SAMPLE_RATE = 24414;

/** 线性插值重采样；采样率相同则原样返回 */
function resample(x: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || x.length === 0) return x;
  const ratio = fromRate / toRate;
  const n = Math.max(1, Math.round(x.length / ratio));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, x.length - 1);
    const t = pos - i0;
    out[i] = x[i0] * (1 - t) + x[i1] * t;
  }
  return out;
}

/** Float32 [-1,1] 单声道 -> 16bit PCM WAV Blob（44 字节标准头） */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt 块长度
  v.setUint16(20, 1, true); // 编码方式 PCM
  v.setUint16(22, 1, true); // 单声道
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // 字节率 = 采样率 × 声道 × 位深/8
  v.setUint16(32, 2, true); // 块对齐
  v.setUint16(34, 16, true); // 位深
  ascii(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** 浏览器录音/上传的音频 Blob -> 24414Hz 单声道 16bit WAV 文件 */
export async function toCorpusWavFile(blob: Blob, name: string): Promise<File> {
  const Ctor = getAudioContextCtor();
  if (!Ctor) throw new Error('浏览器不支持音频解码');
  const ctx = new Ctor();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channels = decoded.numberOfChannels;
    let mono: Float32Array;
    if (channels === 1) {
      mono = decoded.getChannelData(0);
    } else {
      const len = decoded.length;
      mono = new Float32Array(len);
      for (let c = 0; c < channels; c++) {
        const data = decoded.getChannelData(c);
        for (let i = 0; i < len; i++) mono[i] += data[i] / channels;
      }
    }
    const samples = resample(mono, decoded.sampleRate, CORPUS_SAMPLE_RATE);
    return new File([encodeWav(samples, CORPUS_SAMPLE_RATE)], name, { type: 'audio/wav' });
  } finally {
    void ctx.close();
  }
}