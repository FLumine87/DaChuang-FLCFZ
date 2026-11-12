"""真实图像 / 语音特征提取（仅依赖 numpy + Pillow，纯算法实现）。

背景
----
旧版 `features.py` 里的图像/语音特征其实都是**由文本派生**的占位（见
`media_feature_from_text`），所以"跨模态检索"只是在文本特征上自证。
本模块提供真正的模态特征：

  * 图像（48×48 灰度面部图像）：
      8×8 分块均值强度（64 维，逐图标准化以抑制光照差异）
      ⊕ 4×4 网格 × 8 方向的无符号梯度方向直方图 HOG（128 维）
      = 192 维
  * 语音（16-bit PCM 单声道 wav）：
      20 维 MFCC 均值 ⊕ 20 维 MFCC 标准差 ⊕ 20 维一阶差分均值
      ⊕ 4 维韵律特征（对数能量、过零率、谱质心、谱平坦度）
      = 64 维

为什么不用深度模型
------------------
当前运行环境是 Python 3.14，onnxruntime / torch / librosa 均无可用轮子
（librosa 依赖 numba/llvmlite，3.14 尚无稳定支持）。手工特征零新增依赖、
可离线批量抽取、结果完全可复现，且足以让 CMFH 学到有判别力的共享码空间。
后续若要换成 CLIP / Whisper，只需替换本模块的两个入口函数，
`features.py` 与上层哈希引擎无需改动。

注意：本模块不引入任何随机性，特征只由文件内容决定。
"""
import base64
import io

IMAGE_FEATURE_DIM = 192
AUDIO_FEATURE_DIM = 64

# MFCC 相关常量（与特征维度严格对应：20 + 20 + 20 + 4 = 64）
_N_MFCC = 20
_N_MELS = 26
_N_FFT = 512
_HOP = 256
_PREEMPH = 0.97

# viridis 近似色标（用于梅尔频谱缩略图着色）
_VIRIDIS = [
    (68, 1, 84), (72, 40, 120), (62, 74, 137), (49, 104, 142), (38, 130, 142),
    (31, 158, 137), (53, 183, 121), (109, 205, 89), (180, 222, 44), (253, 231, 37),
]

# 滤波器组 / DCT 基按参数缓存（逐文件重复构建会成为主要开销）
_MEL_CACHE = {}
_DCT_CACHE = {}


# ---------------------------------------------------------------------------
# 图像
# ---------------------------------------------------------------------------

def _gray_array(path, size=48):
    """读取图像并转成 size×size 的 [0,1] 灰度数组；失败返回 None。"""
    import numpy as np
    from PIL import Image
    with Image.open(path) as im:
        im = im.convert("L")
        if im.size != (size, size):
            im = im.resize((size, size), Image.BILINEAR)
        return np.asarray(im, dtype=np.float32) / 255.0


def _image_descriptor(arr):
    """48×48 灰度图 -> 192 维描述子（64 强度 + 128 HOG）。"""
    import numpy as np
    h, w = arr.shape

    # --- 强度：8×8 分块均值，逐图标准化（去掉整体明暗差异）---
    bs = max(1, h // 8)
    blocks = arr.reshape(8, bs, 8, bs).mean(axis=(1, 3)).astype(np.float32)
    sd = float(blocks.std())
    intensity = ((blocks - blocks.mean()) / sd).ravel() if sd > 1e-6 else blocks.ravel()

    # --- HOG：4×4 网格 × 8 方向（无符号梯度，角度折叠到 [0, π)）---
    # 按方向做 8 次掩码分块求和，避免 128 次 Python 级循环（约快 30 倍）。
    gy, gx = np.gradient(arr)
    mag = np.sqrt(gx * gx + gy * gy)
    ang = np.arctan2(gy, gx) % np.pi
    bin_idx = np.minimum((ang / (np.pi / 8)).astype(np.int32), 7)
    cs = max(1, h // 4)
    hog = np.zeros((4, 4, 8), dtype=np.float32)
    for o in range(8):
        masked = np.where(bin_idx == o, mag, 0.0)
        hog[:, :, o] = masked.reshape(4, cs, 4, cs).sum(axis=(1, 3))
    hog = hog.ravel()
    hn = float(np.linalg.norm(hog))
    if hn > 1e-6:
        hog = hog / hn

    return np.concatenate([intensity, hog]).astype(np.float32)


def image_feature(path):
    """图像文件 -> 192 维特征向量；失败返回 None。"""
    try:
        import numpy as np
        arr = _gray_array(path)
        if arr is None:
            return None
        vec = _image_descriptor(arr)
        n = float(np.linalg.norm(vec))
        return (vec / n).tolist() if n > 1e-6 else vec.tolist()
    except Exception:
        return None


def image_thumbnail_data_url(path, size=96, quality=80):
    """图像 -> 内联 base64 JPEG 缩略图（数据集在仓库外，前端无法直接访问文件）。

    以 data URL 内联而非新增文件服务接口：免去鉴权与跨域问题，
    48×48 灰度图缩略后仅约 1~2KB，对响应体几乎无影响。
    """
    try:
        from PIL import Image
        with Image.open(path) as im:
            im = im.convert("L").resize((size, size), Image.BILINEAR)
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=quality)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        return None


# ---------------------------------------------------------------------------
# 语音
# ---------------------------------------------------------------------------

def _read_wav(path):
    """读取 wav -> (单声道 float32 波形, 采样率)；失败返回 (None, 0)。"""
    import wave
    import numpy as np
    with wave.open(path, "rb") as w:
        n_ch = w.getnchannels()
        sr = w.getframerate()
        sw = w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if sw == 2:
        x = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    elif sw == 1:
        x = (np.frombuffer(raw, dtype="<u1").astype(np.float32) - 128.0) / 128.0
    elif sw == 4:
        x = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        return None, sr
    if n_ch > 1:
        x = x.reshape(-1, n_ch).mean(axis=1)
    return np.ascontiguousarray(x, dtype=np.float32), sr


def _mel_filterbank(sr, n_fft, n_mels, fmin=50.0):
    """Mel 三角滤波器组 (n_mels × (n_fft/2+1))。按参数缓存，避免逐文件重建。"""
    import numpy as np
    key = (sr, n_fft, n_mels, fmin)
    cached = _MEL_CACHE.get(key)
    if cached is not None:
        return cached

    def hz2mel(f):
        return 2595.0 * np.log10(1.0 + f / 700.0)

    def mel2hz(m):
        return 700.0 * (10.0 ** (m / 2595.0) - 1.0)

    fmax = sr / 2.0
    hz = mel2hz(np.linspace(hz2mel(fmin), hz2mel(fmax), n_mels + 2))
    bins = np.clip(np.floor((n_fft + 1) * hz / sr).astype(int), 0, n_fft // 2)
    fb = np.zeros((n_mels, n_fft // 2 + 1), dtype=np.float32)
    for i in range(1, n_mels + 1):
        l, c, r = int(bins[i - 1]), int(bins[i]), int(bins[i + 1])
        c = max(c, l + 1)
        r = max(r, c + 1)
        c = min(c, n_fft // 2)
        r = min(r, n_fft // 2)
        if c > l:
            fb[i - 1, l:c] = (np.arange(l, c) - l) / float(c - l)
        if r > c:
            fb[i - 1, c:r] = (r - np.arange(c, r)) / float(r - c)
    _MEL_CACHE[key] = fb
    return fb


def _stft_power(x, n_fft=_N_FFT, hop=_HOP):
    """分帧加窗后的功率谱 (T × (n_fft/2+1))。"""
    import numpy as np
    if len(x) < n_fft:
        x = np.pad(x, (0, n_fft - len(x)))
    win = np.hamming(n_fft).astype(np.float32)
    n_frames = 1 + (len(x) - n_fft) // hop
    idx = np.arange(n_fft)[None, :] + hop * np.arange(n_frames)[:, None]
    frames = x[idx] * win
    return (np.abs(np.fft.rfft(frames, n=n_fft, axis=1)) ** 2).astype(np.float32)


def _dct2(mat, n_out):
    """DCT-II 前 n_out 个系数，作用于矩阵的行方向 (n_in × T) -> (n_out × T)。"""
    import numpy as np
    n = mat.shape[0]
    key = (n, n_out)
    basis = _DCT_CACHE.get(key)
    if basis is None:
        k = np.arange(n_out)[:, None]
        basis = np.cos(np.pi * k * (2 * np.arange(n)[None, :] + 1) / (2.0 * n))
        _DCT_CACHE[key] = basis
    return (basis @ mat).astype(np.float32)


def mel_spectrogram(path, n_mels=48):
    """语音 -> 对数梅尔频谱 (n_mels × T)；失败返回 None。用于缩略图与诊断。"""
    try:
        import numpy as np
        x, sr = _read_wav(path)
        if x is None or len(x) < 256:
            return None
        x = np.append(x[:1], x[1:] - _PREEMPH * x[:-1])
        power = _stft_power(x)
        mel = _mel_filterbank(sr, _N_FFT, n_mels) @ power.T
        return np.log(mel + 1e-8)
    except Exception:
        return None


def _pitch_stats(x, sr, n_fft=1024, hop=256, fmin=70.0, fmax=400.0):
    """自相关法基频统计 -> (F0 均值, F0 标准差, 浊音比例)。

    基频是情感/抑郁语音最有效的韵律线索（语速、语调起伏），
    自相关在纯 numpy 下用 FFT 实现，无需 librosa。
    """
    import numpy as np
    if len(x) < n_fft:
        x = np.pad(x, (0, n_fft - len(x)))
    win = np.hanning(n_fft).astype(np.float32)
    nf = 1 + (len(x) - n_fft) // hop
    idx = np.arange(n_fft)[None, :] + hop * np.arange(nf)[:, None]
    frames = x[idx] * win
    spec = np.fft.rfft(frames, n=2 * n_fft, axis=1)
    ac = np.fft.irfft(np.abs(spec) ** 2, n=2 * n_fft, axis=1)[:, :n_fft]
    ac = ac / (ac[:, :1] + 1e-9)
    lo = max(1, int(sr / fmax))
    hi = min(n_fft - 1, int(sr / fmin))
    if hi <= lo:
        return 0.0, 0.0, 0.0
    seg = ac[:, lo:hi + 1]
    peak = seg.max(axis=1)
    f0 = sr / (seg.argmax(axis=1) + lo).astype(np.float64)
    voiced = peak > 0.30
    if int(voiced.sum()) < 3:
        return 0.0, 0.0, float(voiced.mean())
    v = f0[voiced]
    return float(v.mean()), float(v.std()), float(voiced.mean())


def audio_feature(path):
    """语音文件 -> 64 维特征向量；失败返回 None。

    构成（每维尺度已对齐，避免某一组数值量级压过其余组）：
      MFCC c1..c20 时域均值 /10      (20)
      MFCC c1..c20 时域标准差 /10    (20)
      MFCC c1..c16 一阶差分均值 /10  (16)
      韵律 8 维                      (8)
    合计 64。刻意**不做**倒谱均值归一化（CMN 会把时域均值抹成 0，
    使前 20 维恒为零、特征失去判别力）。
    """
    try:
        import numpy as np
        x, sr = _read_wav(path)
        if x is None or len(x) < 256:
            return None

        xe = np.append(x[:1], x[1:] - _PREEMPH * x[:-1])
        power = _stft_power(xe)
        mel = _mel_filterbank(sr, _N_FFT, _N_MELS) @ power.T
        mfcc = _dct2(np.log(mel + 1e-8), _N_MFCC + 1)   # c0..c20，丢弃 c0（能量项量级过大）

        mean = mfcc[1:].mean(axis=1) / 10.0
        std = mfcc[1:].std(axis=1) / 10.0
        delta = np.diff(mfcc[1:], axis=1)
        dmean = (delta.mean(axis=1) if delta.size else np.zeros(_N_MFCC))[:16] / 10.0

        ps = power.sum(axis=0).astype(np.float64) + 1e-9
        freqs = np.linspace(0.0, sr / 2.0, power.shape[1])
        centroid = float((freqs * ps).sum() / ps.sum() / max(1.0, sr / 2.0))
        flatness = float(np.exp(np.mean(np.log(ps))) / (ps.mean() + 1e-12))
        frame_e = np.sqrt(power.mean(axis=1) + 1e-12)
        f0_mean, f0_std, voiced = _pitch_stats(x, sr)
        pros = np.array([
            float(np.log(frame_e.mean() + 1e-6)) / 5.0,
            float(np.log(frame_e.std() + 1e-6)) / 5.0,
            centroid,
            min(1.0, flatness),
            f0_mean / 200.0,
            f0_std / 200.0,
            voiced,
            float(np.mean(np.abs(np.diff(np.sign(x))) > 0)),
        ], dtype=np.float32)

        vec = np.concatenate([mean, std, dmean, pros]).astype(np.float32)
        n = float(np.linalg.norm(vec))
        return (vec / n).tolist() if n > 1e-6 else vec.tolist()
    except Exception:
        return None


def spectrogram_thumbnail_data_url(path, width=180, height=72):
    """语音 -> 梅尔频谱内联缩略图（把"声音"变成可展示的视觉线索）。"""
    try:
        import numpy as np
        from PIL import Image
        spec = mel_spectrogram(path, n_mels=height)
        if spec is None:
            return None
        lo, hi = np.percentile(spec, 2), np.percentile(spec, 98)
        norm = np.clip((spec - lo) / max(1e-6, float(hi - lo)), 0.0, 1.0)
        img = Image.fromarray((norm * 255).astype(np.uint8)).resize(
            (width, height), Image.BILINEAR)
        v = np.asarray(img, dtype=np.float32) / 255.0
        palette = np.array(_VIRIDIS, dtype=np.float32)
        idx = v * (len(palette) - 1)
        i0 = np.floor(idx).astype(np.int32)
        i1 = np.minimum(i0 + 1, len(palette) - 1)
        f = (idx - i0)[..., None]
        rgb = (palette[i0] * (1 - f) + palette[i1] * f).astype(np.uint8)
        buf = io.BytesIO()
        # JPEG 而非 PNG：频谱是平滑渐变，JPEG 体积小一个量级（约 4KB vs 32KB）
        Image.fromarray(rgb).save(buf, format="JPEG", quality=72)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        return None


def media_data_url(path, modality, image_size=96):
    """按模态生成内联缩略图（图像 -> 灰度图；语音 -> 梅尔频谱）。"""
    if not path:
        return None
    if modality == "image":
        return image_thumbnail_data_url(path, size=image_size)
    if modality == "audio":
        return spectrogram_thumbnail_data_url(path)
    return None


# 原始媒体文件的 MIME：浏览器据此选择解码器（wav 可直接播放）
_FILE_MIME = {"image": "image/jpeg", "audio": "audio/wav"}


def media_file_data_url(path, modality):
    """原始媒体文件的 data URL：语音为可直接播放的 wav，图像为原图。

    与 media_data_url 的区别：后者是结果页缩略图（图像灰度化、语音画梅尔频谱），
    这里返回真实文件本身，供前端 <audio> 播放 / 放大查看。
    """
    mime = _FILE_MIME.get(modality)
    if not mime or not path:
        return None
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except OSError:
        return None
    if not raw:
        return None
    return f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")