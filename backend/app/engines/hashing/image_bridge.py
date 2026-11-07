"""文-图弱监督桥接：一条与主引擎完全隔离的跨模态通道。

为什么需要它
------------
主引擎的共享码空间里，文/语音/图像被强制归到同一个语义空间。
但 FER2013 是纯图像集，与文本/语音没有任何同源关系，仅按情绪语义对齐挂接，
是「同类别不同对象」的弱配对。实测（九格评测，653 查询）：

    图搜图 0.197 / 图搜文 0.331 / 图搜音 0.257     ← 图像侧显著落后

把 CNN 特征塞进主码空间能救图搜图（0.362），但图搜文反而崩到 0.162
（CNN 特征由 FER 的 7 类表情定义，与文本语义空间不同构）。
而让图像退出配对训练也不可行：W 里没有 W_image，查询侧只能退回文本编码器，
图像查询变成文本查询（实测 12 条图像查询两两余弦 0.8157，区分度尽失）。

结论：文↔图 需要一条**独立**的通道。

做法
----
复用与主引擎同一套 CMFH 公式，但只喂 text + image 两个模态：

    G_bridge = Gram(X_text)/scale + Gram(X_image)/scale + λ·S_bridge
    S_bridge[i][j] = 记录主题的 Jaccard（弱监督，唯一可用的对齐依据）

特征分解取前 K → 符号化 → 学两个投影矩阵 W_text→bridge / W_image→bridge。
查询时：

    文查图：u = W_text→bridge · 查询文本特征，  比对图像单元的 B_bridge 码
    图查文：u = W_image→bridge · 查询图像特征，  比对文本单元的 B_bridge 码

与主引擎隔离：参数独立、索引独立，调桥接不会动文-音的指标。
"""
import os
from typing import Dict, List, Optional, Tuple

from .cmfh import OnlineSupervisedCMFH
from .linalg import mean_abs


def _jaccard(a, b) -> float:
    sa, sb = set(a or []), set(b or [])
    u = sa | sb
    return (len(sa & sb) / len(u)) if u else 0.0


class ImageTextBridge:
    """模态对弱监督桥接：独立 CMFH + 独立索引。

    与主引擎的差别只有一处：**只喂两个模态**。
    公式、投影矩阵求解方式、位带索引全部复用，保证行为可预期。

    模态对可以是 ("text","image")、("audio","image") 等任意组合 ——
    第一个是「查询侧语义模态」，第二个是「图像模态」。
    """

    def __init__(self, code_length: int = 64, lambda_s: float = 20.0,
                 band_bits: int = 8, probe_bits: int = 2):
        """code_length : 码长 K。实测 64 最优（128/256 反而下降）——
        K 增大时前 K 个特征向量里 Gram 主导的变多、S 主导的块状主题结构被稀释。

        lambda_s : 监督权重。**桥接必须远大于主引擎的 0.6**。
        实测（文-图，CNN 特征）：
            λ=0.6 → 0.1799 / 0.4452
            λ=5   → 0.2680 / 0.5020
            λ=20  → 0.3000 / 0.5776   ← 最优
            λ=50  → 0.2600 / 0.5764
        机理：λ 小则图像码被自己的 Gram 主导（CNN 判别力强），与文本码脱节；
        λ 大则 S 的主题结构主导 G，图像码被拉向文本码；
        λ 过大则退化成纯 S（同主题块内全等价），反而回落。
        """
        self.K = code_length
        self.lambda_s = lambda_s
        self.band_bits = band_bits
        self.probe_bits = probe_bits
        self.model = OnlineSupervisedCMFH(code_length=code_length,
                                          lambda_s=lambda_s)
        self.index = None
        # unit_id -> {record_id, modality, code, ...}
        self.units: Dict[str, Dict] = {}
        self.records: Dict[str, Dict] = {}
        self.trained = False
        self.feature_spec = {}
        # 桥接的模态对：(语义模态, 图像模态)
        self.pair = ("text", "image")

    # ------------------------------------------------------------------
    def fit(self, rows: List[Dict], feature_spec: Optional[Dict] = None,
            pair: Tuple[str, str] = ("text", "image")):
        """训练桥接码空间。

        rows: [{record_id, text_feature, image_feature, tags}]
          text_feature / image_feature 必须等长且已按行对齐
          （一条记录的两个模态视图各一个，按 record_id 配对）
        pair: (语义模态名, 图像模态名)，决定两个投影矩阵的角色
        """
        q_mod, i_mod = pair
        self.pair = (q_mod, i_mod)
        rows = [r for r in rows
                if r.get("text_feature") is not None
                and r.get("image_feature") is not None]
        if len(rows) < 8:
            return False
        # 同一模态内维度必须一致，否则 Gram 矩阵无法构造
        if len({len(r["text_feature"]) for r in rows}) != 1:
            return False
        if len({len(r["image_feature"]) for r in rows}) != 1:
            return False

        feats = {
            q_mod: [list(r["text_feature"]) for r in rows],
            i_mod: [list(r["image_feature"]) for r in rows],
        }
        n = len(rows)
        sim = [[_jaccard(rows[i].get("tags"), rows[j].get("tags"))
                for j in range(n)] for i in range(n)]
        for i in range(n):
            sim[i][i] = 1.0

        self.model.fit(feats, sim)
        self.trained = True
        self.feature_spec = feature_spec or {}
        self._last_S = sim

        # 建索引：每条记录两个单元，两个模态各一
        from .multi_table_index import MultiTableHashIndex
        self.index = MultiTableHashIndex(
            code_length=self.K, band_bits=self.band_bits,
            probe_bits=self.probe_bits, rho_min=0.0, sigma_min=0.0,
        )
        self.units = {}
        self.records = {}
        for i, r in enumerate(rows):
            rid = r.get("record_id") or f"BR-{i:06d}"
            self.records[rid] = {"record_id": rid, "tags": r.get("tags") or []}
            for mod in (q_mod, i_mod):
                code = self.model.encode({mod: feats[mod][i]})
                uid = f"{rid}-{mod}"
                meta = self._unit_meta(r, rid, mod)
                self.units[uid] = dict(meta, code=list(code))
                self.index.insert(uid, list(code), meta, window=0)
        return True

    # ------------------------------------------------------------------
    @staticmethod
    def _unit_meta(row: Dict, rid: str, modality: str) -> Dict:
        """单元元信息：保留标签溯源需要的字段。

        不能只留 record_id / modality / tags —— 队长的 label_provenance
        要靠 dataset、alert_level、media_path 等字段判断「这是 FER 表情
        还是 EATD 的 SDS 筛查样本」。缺了这些，桥接结果就会给错告警等级
        （FER 表情图本应是 unknown，按记录级给 green 是错的）。
        """
        keep = ("dataset", "alert_level", "media_path", "media_kind",
                "media_meta", "emotion_label", "screening_label",
                "label_source", "label_validity", "pairing_type",
                "screening_usable", "date", "created_at", "severity")
        meta = {"record_id": rid, "modality": modality,
                "tags": row.get("tags") or [], "window": 0}
        for k in keep:
            v = row.get(k)
            if v is not None:
                meta[k] = v
        return meta

    def _fit_with_S(self, rows: List[Dict], feats: Dict[str, List[List[float]]],
                    S: List[List[float]], pair: Tuple[str, str] = ("text", "image")):
        """用外部给定的监督矩阵 S 训练（供 S 构造方案的对照实验使用）。

        与 fit 的区别只是 S 的来源：fit 用主题标签 Jaccard 自动构造，
        这里由调用方决定怎么造（语义余弦 / 混合 / 加连续强度等）。
        """
        q_mod, i_mod = pair
        self.pair = (q_mod, i_mod)
        n = len(rows)
        if len(S) != n:
            return False
        self.model.fit(feats, S)
        self.trained = True
        self._last_S = [list(r) for r in S]

        from .multi_table_index import MultiTableHashIndex
        self.index = MultiTableHashIndex(
            code_length=self.K, band_bits=self.band_bits,
            probe_bits=self.probe_bits, rho_min=0.0, sigma_min=0.0,
        )
        self.units = {}
        self.records = {}
        for i, r in enumerate(rows):
            rid = r.get("record_id") or f"BR-{i:06d}"
            self.records[rid] = {"record_id": rid, "tags": r.get("tags") or []}
            for mod in (q_mod, i_mod):
                code = self.model.encode({mod: feats[mod][i]})
                uid = f"{rid}-{mod}"
                meta = self._unit_meta(r, rid, mod)
                self.units[uid] = dict(meta, code=list(code))
                self.index.insert(uid, list(code), meta, window=0)
        return True

    # ------------------------------------------------------------------
    def add_unit(self, unit_id: str, meta: Dict, feature: List[float],
                 modality: Optional[str] = None) -> bool:
        """增量加入一个单元（运行时新增的采集数据）。

        不需要重训：投影矩阵 W 已训练好，直接用它编码即可（推理路径）。
        新单元没有主题标签 → 它不参与 S 监督，但**可以被检索到**
        （作为候选参与打分），这正是「用户自己刚采集的图文对能被搜到」。

        modality 为该单元所属的模态（text / image / audio）。
        """
        if not self.trained or self.index is None:
            return False
        mod = modality or meta.get("modality") or "text"
        if mod not in (self.model.W or {}):
            return False
        code = list(self.model.encode({mod: list(feature)}))
        m = dict(meta)
        m["record_id"] = meta.get("record_id") or unit_id
        m["modality"] = mod
        m["tags"] = meta.get("tags") or []
        m["window"] = 0
        m["code"] = code
        self.units[unit_id] = m
        self.index.insert(unit_id, code, m, window=0)
        rid = m["record_id"]
        if rid not in self.records:
            self.records[rid] = {"record_id": rid, "tags": m["tags"]}
        return True

    # ------------------------------------------------------------------
    def encode_query(self, feature: List[float], modality: str) -> List[float]:
        """查询侧：连续实数向量 u（保留投影幅值，供非对称距离 u·s）。"""
        if not self.trained:
            return [0.0] * self.K
        return list(self.model.encode_continuous({modality: list(feature)}))

    def search(self, feature: List[float], modality: str,
               top_k: int = 30, result_modality: Optional[str] = None,
               exclude_record: Optional[str] = None,
               allowed_ids: Optional[set] = None) -> List[Dict]:
        """桥接检索。

        modality        : 查询模态（text / image），决定用哪个投影矩阵
        result_modality : 限定结果模态（文查图 → "image"，图查文 → "text"）
        allowed_ids     : 可见性白名单（按 scope 与调用者身份算出的单元集合）。
                          None 表示不过滤（内部评测 / 全库扫描）。
                          运行时采集的数据带 scope（public / reviewing / 私有），
                          必须与主引擎同一套可见性规则，否则会泄露未审核数据。

        打分走非对称距离 u·s：查询端用连续向量 u，库端用 ±1 二值码，
        与主引擎一致（见 MultiTableHashIndex.search 的 query_vec 参数）。
        """
        if not self.trained or self.index is None:
            return []
        u = self.encode_query(feature, modality)
        # 非对称距离：库端码需要按 ±1 约定，索引内部用 0/1 位串，
        # 这里传入 query_vec 让索引走 u·s 分支。
        ids, sims, _info = self.index.search(
            u, top_k=max(top_k * 4, 60),
            modality_filter=result_modality,
            query_vec=u,
            allowed_ids=allowed_ids,
        )
        out = []
        for uid, sim in zip(ids, sims):
            meta = self.units.get(uid) or {}
            rid = meta.get("record_id")
            if exclude_record and rid == exclude_record:
                continue
            out.append({
                "unit_id": uid, "record_id": rid,
                "modality": meta.get("modality"),
                "sim": sim, "score": sim,
                "tags": meta.get("tags") or [],
                # 单元级元信息：调用方用它做标签溯源（队长的 label_provenance）
                "unit_meta": {k: v for k, v in meta.items()
                              if k not in ("code",)},
            })
            if len(out) >= top_k:
                break
        return out

    # ------------------------------------------------------------------
    def stats(self) -> Dict:
        mods = {}
        for m in self.units.values():
            mods[m.get("modality")] = mods.get(m.get("modality"), 0) + 1
        return {
            "trained": self.trained,
            "units": len(self.units),
            "records": len(self.records),
            "modalities": mods,
            "code_length": self.K,
            "lambda_s": self.lambda_s,
            "feature_spec": self.feature_spec,
            "W_modalities": sorted((self.model.W or {}).keys()),
        }
