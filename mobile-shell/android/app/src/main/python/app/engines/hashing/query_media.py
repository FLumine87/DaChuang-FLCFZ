"""媒体查询落盘：把前端上传的 base64 图像/语音写成临时文件。

为什么需要落盘
--------------
图像特征（Pillow）与语音特征（wave）都按**文件路径**读取；而真实数据集在
仓库外、前端只能上传"单次查询片段"。因此把查询字节写入系统临时目录，
检索结束立即删除：既不进 uploads/ 目录、也不落库，无持久化残留。

安全边界
--------
* 只接受白名单扩展名（图像 png/jpg/jpeg/bmp/webp；语音 wav）；
* base64 解码前后都校验体积上限，避免超大 body 撑爆内存；
* 文件名由调用方提供，这里只取扩展名，实际落盘名随机生成（防路径穿越）。
"""
import base64
import os
import re
import tempfile
import uuid

# 单次媒体查询体积上限（解码后）。语音 wav 约 2.5s / 80KB，图像 48×48 更小，
# 8MB 足以覆盖用户自录片段，又能挡住误传的大文件。
MAX_MEDIA_BYTES = 8 * 1024 * 1024

IMAGE_EXT = (".png", ".jpg", ".jpeg", ".bmp", ".webp")
AUDIO_EXT = (".wav",)

_DATA_URL_RE = re.compile(r"^data:[^;,]*;base64,", re.IGNORECASE)


class MediaQueryError(ValueError):
    """媒体查询不合法（体积超限 / 扩展名不支持 / base64 解码失败）。"""


def _pick_ext(filename: str, modality: str) -> str:
    ext = os.path.splitext(str(filename or "").strip())[1].lower()
    allowed = IMAGE_EXT if modality == "image" else AUDIO_EXT
    if ext in allowed:
        return ext
    return allowed[0]


def decode_media_query(raw, filename: str, modality: str) -> str:
    """base64（可带 data URL 前缀）-> 临时文件路径。失败抛 MediaQueryError。

    返回的路径由调用方负责删除；检索异常时也要删（handler 用 try/finally）。
    """
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("ascii", "ignore")
    if not isinstance(raw, str) or not raw.strip():
        raise MediaQueryError("媒体查询内容为空")
    s = _DATA_URL_RE.sub("", raw.strip())
    # 估算解码后体积，先挡住明显超限的输入再真正解码（省内存）
    if len(s) * 3 // 4 > MAX_MEDIA_BYTES + 1024:
        raise MediaQueryError(f"媒体文件过大（上限 {MAX_MEDIA_BYTES // 1024 // 1024}MB）")
    try:
        data = base64.b64decode(s, validate=False)
    except Exception as exc:
        raise MediaQueryError("媒体内容不是合法的 base64 编码") from exc
    if not data:
        raise MediaQueryError("媒体查询内容为空")
    if len(data) > MAX_MEDIA_BYTES:
        raise MediaQueryError(f"媒体文件过大（上限 {MAX_MEDIA_BYTES // 1024 // 1024}MB）")

    ext = _pick_ext(filename, modality)
    path = os.path.join(tempfile.gettempdir(), f"dcq_{uuid.uuid4().hex}{ext}")
    with open(path, "wb") as f:
        f.write(data)
    return path


def remove_media_query(path) -> None:
    """删除临时查询文件；已不存在时静默忽略。"""
    if not path:
        return
    try:
        os.remove(path)
    except OSError:
        pass