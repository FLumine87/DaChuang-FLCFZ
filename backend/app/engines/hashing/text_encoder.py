"""bge-small-zh 句向量编码器（ONNX）。

当前文本特征是 256 维 TF 哈希 + 19 维主题桥，只认字面重合：
实测「最近总是睡不着」与「失眠好几天了」相似度 0.146，与「今天天气不错」
0.134，几乎没有区分力；「和室友关系很僵」与「宿舍相处不太愉快」甚至算出 0。

这里换成语义句向量。模型缺失或依赖不可用时返回 None，调用方自动退回 TF。

分词用 tokenizers（项目 venv 已装），推理只用 onnxruntime，
不需要 transformers / torch。
"""
import os
from typing import List, Optional

import numpy as np

try:
    from tokenizers import Tokenizer
except Exception:
    Tokenizer = None

try:
    import onnxruntime as ort
    ort.set_default_logger_severity(3)
except Exception:
    ort = None

_BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))
# 可用 HASHING_BGE_MODEL 指定其他变体（如 int8 量化版），
# 切换模型必须重建索引，否则查询码与库码不同源。
DEFAULT_MODEL = os.environ.get(
    "HASHING_BGE_MODEL",
    os.path.join(_BASE, "models", "bge-small-zh.onnx"))
DEFAULT_TOKENIZER = os.path.join(_BASE, "models", "bge-small-zh", "tokenizer.json")
MAX_LEN = 256


class TextEncoder:
    def __init__(self, model_path: str = "", tokenizer_path: str = ""):
        self.model_path = model_path or DEFAULT_MODEL
        self.tokenizer_path = tokenizer_path or DEFAULT_TOKENIZER
        self.session = None
        self.tokenizer = None
        self.dim = 0
        self.available = False
        self._load()

    def _load(self):
        if ort is None or Tokenizer is None:
            return
        if not os.path.exists(self.model_path) or not os.path.exists(self.tokenizer_path):
            return
        try:
            self.session = ort.InferenceSession(self.model_path)
            self.tokenizer = Tokenizer.from_file(self.tokenizer_path)
            self.tokenizer.enable_truncation(max_length=MAX_LEN)
            self.tokenizer.enable_padding(length=None)
            self.dim = int(self.session.get_outputs()[0].shape[-1])
            self.available = True
        except Exception:
            self.session = None
            self.tokenizer = None
            self.available = False

    def encode(self, text: str) -> Optional[List[float]]:
        if not self.available:
            return None
        text = (text or "").strip()
        if not text:
            return None
        try:
            enc = self.tokenizer.encode(text)
            ids = np.array([enc.ids], dtype=np.int64)
            mask = np.array([enc.attention_mask], dtype=np.int64)
            out = self.session.run(None, {"input_ids": ids, "attention_mask": mask})[0][0]
            v = np.asarray(out, dtype=np.float32)
            n = float(np.linalg.norm(v))
            return (v / n).tolist() if n > 1e-9 else v.tolist()
        except Exception:
            return None

    def encode_batch(self, texts: List[str]) -> Optional[np.ndarray]:
        vecs = [self.encode(t) for t in texts]
        if any(v is None for v in vecs):
            return None
        return np.stack(vecs)


_ENCODER = None
_TRIED = False


def get_text_encoder() -> Optional[TextEncoder]:
    global _ENCODER, _TRIED
    if _TRIED:
        return _ENCODER
    _TRIED = True
    enc = TextEncoder()
    _ENCODER = enc if enc.available else None
    return _ENCODER
