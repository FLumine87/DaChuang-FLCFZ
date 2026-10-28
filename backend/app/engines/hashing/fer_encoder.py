"""FER 表情特征的 ONNX 编码器。

微调后的 MobileNetV2 输出 1280 维表情特征。建库与在线查询共用这一份实现，
避免两处预处理不一致导致检索漂移。

模型文件缺失或 onnxruntime 不可用时返回 None，调用方自动退回 192 维手工特征。
"""
import os
from typing import List, Optional

import numpy as np

try:
    from PIL import Image
except Exception:
    Image = None

try:
    import onnxruntime as ort
    ort.set_default_logger_severity(3)
except Exception:
    ort = None

_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

_SESSIONS = {}
_DEFAULT_MODEL = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))))), "models", "mobilenetv2-fer.onnx")


class FerEncoder:
    """把一张人脸图编码成 1280 维表情特征。"""

    def __init__(self, model_path: str = ""):
        self.model_path = model_path or _DEFAULT_MODEL
        self.session = None
        self.input_name = ""
        self.size = 160
        self.available = False
        self._load()

    def _load(self):
        if ort is None or Image is None:
            return
        if not os.path.exists(self.model_path):
            return
        sess = _SESSIONS.get(self.model_path)
        if sess is None:
            try:
                sess = ort.InferenceSession(self.model_path)
            except Exception:
                return
            _SESSIONS[self.model_path] = sess
        self.session = sess
        self.input_name = sess.get_inputs()[0].name
        shape = sess.get_inputs()[0].shape
        if len(shape) == 4 and isinstance(shape[2], int):
            self.size = int(shape[2])
        self.available = True

    def feature(self, path: str) -> Optional[List[float]]:
        if not self.available or not path:
            return None
        try:
            with Image.open(path) as im:
                im = im.convert("RGB").resize((self.size, self.size), Image.BILINEAR)
                arr = np.asarray(im, dtype=np.float32) / 255.0
            arr = (arr - _MEAN) / _STD
            x = arr.transpose(2, 0, 1)[None]
            out = self.session.run(None, {self.input_name: x})[0]
            return np.asarray(out, dtype=np.float32).ravel().tolist()
        except Exception:
            return None

    def feature_batch(self, paths: List[str]) -> Optional[np.ndarray]:
        vecs = []
        for p in paths:
            v = self.feature(p)
            if v is None:
                return None
            vecs.append(v)
        return np.stack(vecs) if vecs else None


_ENC = None


def get_encoder(model_path: str = "") -> Optional[FerEncoder]:
    global _ENC
    if _ENC is None:
        enc = FerEncoder(model_path)
        if not enc.available:
            return None
        _ENC = enc
    return _ENC
