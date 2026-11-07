"""全量图像库的独立哈希索引（图像搜图像）。

与主跨模态引擎分开：主索引里的图像是按情绪弱配对挂到文本语音记录上的
1686 张，用于验证跨模态链路；这里覆盖 FER2013 全量 35887 张，只做单模态检索。

为什么不用 CMFH：CMFH 的 G 是 n×n 稠密矩阵，35887 条要 10GB 内存。
这里用 PCA + ITQ（迭代量化），纯 numpy，训练秒级完成。ITQ 是无监督的，
不依赖标签，FER 的情绪类别只在评测时用作相关性判据。

编码流程：
    x (192d) → 去均值 → PCA 投影到 64d → ITQ 旋转 → 符号化 → 64 位码
"""
import json
import os
from typing import Dict, List, Optional

from app.engines.hashing.multi_table_index import MultiTableHashIndex

try:
    import numpy as np
except Exception:  # Worker / 精简环境下降级，由调用方判断
    np = None

_CACHE_LIMIT = 2000


class ImageHashIndex:
    def __init__(self, corpus_db: str, state_path: str,
                 code_length: int = 64, band_bits: int = 8, itq_iters: int = 20):
        self.corpus_db = corpus_db
        self.state_path = state_path
        self.code_length = int(code_length)
        self.band_bits = int(band_bits)
        self.itq_iters = int(itq_iters)
        self.index = MultiTableHashIndex(code_length=self.code_length,
                                         band_bits=self.band_bits)
        self.mean = None
        self.W = None      # PCA 投影 (192×K)
        self.R = None      # ITQ 旋转 (K×K)
        self.meta: Dict[str, Dict] = {}
        self.ready = False
        self.feature_kind = "handcrafted"
        self.continuous = None   # n×K 连续向量（符号化之前），用于精排
        self._row_of: Dict[str, int] = {}
        self._feat_cache: Dict[str, List[float]] = {}

    # ------------------------- 载入与训练 -------------------------

    def _load_features(self):
        import sqlite3
        conn = sqlite3.connect(self.corpus_db)
        try:
            rows = conn.execute("SELECT image_id, path, label, split, feature "
                                "FROM images").fetchall()
        finally:
            conn.close()
        if not rows:
            return None, None, None
        # float32 每维 4 字节，直接用首条记录长度推断维度
        dim = len(rows[0][4]) // 4
        feats = np.empty((len(rows), dim), dtype=np.float32)
        ids, labels, paths = [], [], []
        for i, (image_id, path, label, _split, blob) in enumerate(rows):
            vec = np.frombuffer(blob, dtype=np.float32)
            if vec.shape[0] < dim:
                continue
            feats[i] = vec[:dim]
            ids.append(image_id)
            labels.append(label)
            paths.append(path)
        feats = feats[: len(ids)]
        return ids, labels, (feats, paths)

    def _fit(self, feats):
        """PCA 降维 + ITQ 旋转，返回 (mean, W, R)。"""
        mean = feats.mean(axis=0)
        Xc = feats - mean
        # 协方差特征分解：192×192，比 SVD 全矩阵快得多
        cov = (Xc.T @ Xc) / max(1, Xc.shape[0] - 1)
        vals, vecs = np.linalg.eigh(cov)
        order = np.argsort(vals)[::-1][: self.code_length]
        W = vecs[:, order].astype(np.float32)
        Z = Xc @ W

        R = np.eye(self.code_length, dtype=np.float32)
        for _ in range(self.itq_iters):
            B = np.sign(Z @ R)
            U, _s, Vt = np.linalg.svd(Z.T @ B)
            R = (U @ Vt).astype(np.float32)
        return mean.astype(np.float32), W, R

    def _read_meta(self) -> Dict[str, str]:
        import sqlite3
        try:
            conn = sqlite3.connect(self.corpus_db)
            try:
                return {r[0]: r[1] for r in conn.execute("SELECT key, value FROM meta")}
            finally:
                conn.close()
        except Exception:
            return {}

    def build(self, force: bool = False) -> bool:
        if np is None:
            return False
        meta = self._read_meta()
        self.feature_kind = meta.get("feature") or "handcrafted"
        ids, labels, packed = self._load_features()
        if not ids:
            return False
        feats, paths = packed

        state = self._load_state()
        if state and not force and state.get("count") == len(ids):
            self.mean = np.array(state["mean"], dtype=np.float32)
            self.W = np.array(state["W"], dtype=np.float32)
            self.R = np.array(state["R"], dtype=np.float32)
        else:
            self.mean, self.W, self.R = self._fit(feats)
            self._save_state(len(ids))

        Z = (feats - self.mean) @ self.W
        self.continuous = (Z @ self.R).astype(np.float32)   # n×K，精排用
        codes = (np.sign(self.continuous) > 0).astype(np.int8)

        self.index = MultiTableHashIndex(code_length=self.code_length,
                                         band_bits=self.band_bits)
        self._row_of = {}
        for i, image_id in enumerate(ids):
            meta = {"record_id": image_id, "modality": "image",
                    "tags": [labels[i]], "window": 0,
                    "media_path": paths[i], "dataset": "FER2013",
                    "content": labels[i]}
            self.meta[image_id] = meta
            self._row_of[image_id] = i
            self.index.insert(image_id, codes[i].tolist(), meta, window=0)
        self.ready = True
        return True

    def _load_state(self) -> Optional[Dict]:
        if not os.path.exists(self.state_path):
            return None
        try:
            with open(self.state_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None

    def _save_state(self, count: int) -> None:
        os.makedirs(os.path.dirname(self.state_path) or ".", exist_ok=True)
        payload = {
            "code_length": self.code_length,
            "count": count,
            "mean": self.mean.tolist(),
            "W": self.W.tolist(),
            "R": self.R.tolist(),
        }
        with open(self.state_path, "w", encoding="utf-8") as f:
            json.dump(payload, f)

    # ------------------------- 编码与检索 -------------------------

    def encode_feature(self, vec: List[float]):
        if np is None or not self.ready:
            return None, None
        x = np.asarray(vec, dtype=np.float32)
        if x.shape[0] != self.mean.shape[0]:
            return None, None
        z = (x - self.mean) @ self.W
        continuous = z @ self.R
        code = (np.sign(continuous) > 0).astype(np.int8)
        return code.tolist(), continuous.tolist()

    def encode_path(self, path: str):
        if path in self._feat_cache:
            return self.encode_feature(self._feat_cache[path])
        if self.feature_kind == "cnn":
            from app.engines.hashing.fer_encoder import get_encoder
            enc = get_encoder()
            feat = enc.feature(path) if enc is not None else None
            if feat is None:
                # 模型缺失时退回手工特征，但维度对不上，直接判失败
                return None, None
        else:
            from app.engines.hashing import real_features as RF
            feat = RF.image_feature(path)
        if not feat:
            return None, None
        if len(self._feat_cache) >= _CACHE_LIMIT:
            self._feat_cache.clear()
        self._feat_cache[path] = feat
        return self.encode_feature(feat)

    def search(self, path: str = "", feature: List[float] = None,
               top_k: int = 10, rerank: bool = True) -> List[Dict]:
        """两阶段：位带粗排取候选池，再用连续向量余弦精排。

        二值码只保留符号，丢掉的幅值信息在精排里找回来。
        候选池默认 200，精排 200 次余弦不到 0.1 毫秒，在线延迟基本不变。
        """
        if not self.ready:
            return []
        if feature is not None:
            code, qvec = self.encode_feature(feature)
        else:
            code, qvec = self.encode_path(path)
        if code is None:
            return []
        pool = max(top_k * 5, 100) if rerank else top_k
        ids, sims, _info = self.index.search(
            code, top_k=pool, modality_filter="image", query_vec=qvec)

        if rerank and self.continuous is not None and ids:
            rows = [self._row_of[uid] for uid in ids if uid in self._row_of]
            cand = self.continuous[rows]
            cand = cand / (np.linalg.norm(cand, axis=1, keepdims=True) + 1e-9)
            q = np.asarray(qvec, dtype=np.float32)
            q = q / (np.linalg.norm(q) + 1e-9)
            order = np.argsort(-(cand @ q))[:top_k]
            picked = [(ids[order[i]], float((cand[order[i]] @ q + 1) / 2))
                      for i in range(min(top_k, len(order)))]
        else:
            picked = list(zip(ids, sims))[:top_k]

        out = []
        for uid, sim in picked:
            meta = self.meta.get(uid) or {}
            out.append({
                "image_id": uid,
                "label": (meta.get("tags") or [""])[0],
                "path": meta.get("media_path"),
                "similarity": round(float(sim), 4),
            })
        return out

    # ------------------------- 评测与统计 -------------------------

    def evaluate(self, sample: int = 300, top_k: int = 10, split: str = "test") -> Dict:
        """用测试集样本查询，统计 top-k 中同类表情的比例。"""
        import sqlite3
        conn = sqlite3.connect(self.corpus_db)
        try:
            rows = conn.execute(
                "SELECT image_id, path, label, feature FROM images "
                "WHERE split = ? ORDER BY image_id LIMIT ?", (split, sample)).fetchall()
        finally:
            conn.close()
        if not rows:
            return {"error": "no test samples"}
        hits = 0
        total = 0
        for image_id, _path, label, blob in rows:
            vec = np.frombuffer(blob, dtype=np.float32)
            code, qvec = self.encode_feature(vec.tolist())
            if code is None:
                continue
            found = self.search(feature=vec.tolist(), top_k=top_k + 1, rerank=True)
            ids = [h["image_id"] for h in found]
            got = [self.meta.get(i, {}).get("tags", [""])[0] for i in ids if i != image_id]
            got = got[:top_k]
            hits += sum(1 for g in got if g == label)
            total += len(got)
        return {"precision@k": round(hits / total, 4) if total else 0.0,
                "k": top_k, "queries": len(rows), "corpus": len(self.meta)}

    def stats(self) -> Dict:
        labels: Dict[str, int] = {}
        for meta in self.meta.values():
            for t in meta.get("tags") or []:
                labels[t] = labels.get(t, 0) + 1
        return {
            "ready": self.ready,
            "feature_kind": self.feature_kind,
            "images": len(self.meta),
            "code_length": self.code_length,
            "labels": labels,
            "has_model": self.W is not None,
        }
