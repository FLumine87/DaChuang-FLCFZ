"""同源关系建模：把「哪些模态视图彼此同源」变成可计算的结构。

为什么需要它
------------
主引擎是**一个共享码空间**（文/音/图三模态一起投影）。但各数据集的
「同源程度」差别极大：

    EATD      文 ↔ 音   同源（同一受试者同一句作答）   文 ↔ 图   异源
    CSEMOTIONS 文 ↔ 音   同源                          文 ↔ 图   异源
    AVDD-TCMI 音 ↔ 图   同源（同一人的面诊）           文 ↔ 音   异源
    FER2013   图 ↔ 任何  异源（表情图与文本/语音无对应）

若把 FER2013 的表情图和 EATD 的自述音频丢进同一个码空间、用同一份
主题 Jaccard 监督，图像视图就变成「凑数的第三模态」——它没有任何真同源
伙伴，只能被主题标签牵着走。这正是图搜文在主引擎里只有 0.26 的原因。

统一的做法不是「再开一个引擎」（那就还是两个引擎），而是
**一个码空间 + 一份按同源关系分组的监督矩阵**：

    S[i][j] = λ_strong × 1                      i 与 j 同源
            = λ_weak × Jaccard(tags_i, tags_j)   否则

同源对被强行拉到一起，异源对只给弱的主题约束。这样：
  · 只有一个码空间、一个索引、一套检索接口（统一）
  · 弱配对的图像不再污染真同源的对（T1 在有同源数据的模态对间可学）
  · λ 从「一个全局标量」变成「按关系类型的两档」

对齐到队长的方案 2（两两桥接 + 单模态）：桥接是**空间级**的隔离，
这里是**监督级**的分组 —— 后者保留了单一码空间的全局可检索性，
而前者靠牺牲全局性换来了单对的精度。
"""
from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Sequence, Tuple

# 同源关系的强度档位
LAMBDA_STRONG = 1.0    # 同源：视图来自同一次采集/同一个人/同一句话
LAMBDA_WEAK = 0.6      # 异源：只靠主题标签的弱约束（沿用主引擎原值）


class PairingRegistry:
    """记录「哪些记录的哪些模态视图彼此同源」。

    数据集适配器在构建记录时声明自己的同源模态对，例如：

        AVDD-TCMI 适配器：
            reg.declare(record_id, "audio", "image")

        EATD 适配器：
            reg.declare(record_id, "text", "audio")

    没有声明关系的视图对一律视为异源（走弱监督）。
    """

    def __init__(self) -> None:
        # (record_id, modality_a, modality_b) -> True，同源对无序存储
        self._pairs: set = set()
        # record_id -> {modality: True}，该记录有哪些视图
        self._views: Dict[str, set] = {}

    # ------------------------------------------------------------------
    def declare(self, record_id: str, modality_a: str, modality_b: str) -> None:
        """声明某条记录的两个模态视图同源。"""
        if not record_id or modality_a == modality_b:
            return
        key = (record_id,) + tuple(sorted((modality_a, modality_b)))
        self._pairs.add(key)
        self._views.setdefault(record_id, set()).update((modality_a, modality_b))

    def add_view(self, record_id: str, modality: str) -> None:
        """登记某条记录有该模态的视图（不建立同源关系）。"""
        if record_id and modality:
            self._views.setdefault(record_id, set()).add(modality)

    # ------------------------------------------------------------------
    def is_same_source(self, record_id_a: str, modality_a: str,
                       record_id_b: str, modality_b: str) -> bool:
        """两个（记录, 模态）视图是否同源。"""
        if record_id_a != record_id_b:
            return False
        key = (record_id_a,) + tuple(sorted((modality_a, modality_b)))
        return key in self._pairs

    def source_pairs(self, record_id: str) -> List[Tuple[str, str]]:
        """某条记录的所有同源模态对。"""
        out = []
        for rec, a, b in self._pairs:
            if rec == record_id:
                out.append((a, b))
        return out

    def stats(self) -> Dict:
        """统计信息，用于诊断与报告。"""
        by_type: Dict[str, int] = {}
        for rec, a, b in self._pairs:
            key = f"{a}<->{b}"
            by_type[key] = by_type.get(key, 0) + 1
        return {
            "同源对总数": len(self._pairs),
            "按模态对": dict(sorted(by_type.items(), key=lambda x: -x[1])),
            "涉及记录数": len(self._views),
        }

    def __len__(self) -> int:
        return len(self._pairs)


# ----------------------------------------------------------------------
def build_supervision(
    records: Sequence[Dict],
    units: Sequence[Dict],
    registry: PairingRegistry,
    lambda_strong: float = LAMBDA_STRONG,
    lambda_weak: float = LAMBDA_WEAK,
    base_similarity: Optional[callable] = None,
) -> List[List[float]]:
    """构造分组监督矩阵 S。

    records : [{record_id, themes}]，顺序即矩阵行序
    units   : [{record_id, modality}]，用于定位每个视图的行列
    registry: 同源关系登记
    base_similarity : (tags_i, tags_j) -> float，缺省用 Jaccard

    返回 n×n 的对称矩阵，行列顺序与 records 一致。
    """
    n = len(records)
    idx: Dict[str, int] = {}
    for i, r in enumerate(records):
        rid = r.get("record_id")
        if rid is not None and rid not in idx:
            idx[rid] = i

    # 每个视图 → 它在 records 里的下标
    view_at: Dict[Tuple[str, str], int] = {}
    for u in units:
        rid = u.get("record_id")
        mod = u.get("modality")
        if rid in idx and mod:
            view_at[(rid, mod)] = idx[rid]

    if base_similarity is None:
        def base_similarity(tags_a, tags_b):
            a, b = set(tags_a or []), set(tags_b or [])
            union = a | b
            return len(a & b) / len(union) if union else 0.0

    S = [[0.0] * n for _ in range(n)]
    for i in range(n):
        S[i][i] = 1.0

    # 1) 基础弱监督：主题相似
    tags = [r.get("themes") or [] for r in records]
    for i in range(n):
        ti = tags[i]
        row = S[i]
        for j in range(i + 1, n):
            v = lambda_weak * float(base_similarity(ti, tags[j]))
            row[j] = v
            S[j][i] = v

    # 2) 同源对：提升到 λ_strong
    for (rid, a, b) in registry._pairs:
        ia = view_at.get((rid, a))
        ib = view_at.get((rid, b))
        if ia is None or ib is None:
            continue
        S[ia][ib] = lambda_strong
        S[ib][ia] = lambda_strong

    return S


def pairing_report(records: Sequence[Dict], units: Sequence[Dict],
                   registry: PairingRegistry) -> Dict:
    """生成一份人可读的配对结构报告（写进评测产物，便于追溯）。"""
    stats = registry.stats()
    by_ds: Dict[str, Dict] = {}
    ds_of = {r.get("record_id"): (r.get("dataset") or "?") for r in records}
    for (rid, a, b) in registry._pairs:
        d = ds_of.get(rid, "?")
        slot = by_ds.setdefault(d, {"同源对": 0, "模态对": {}})
        slot["同源对"] += 1
        k = f"{a}<->{b}"
        slot["模态对"][k] = slot["模态对"].get(k, 0) + 1
    return {
        "总体": stats,
        "按数据集": {k: {"同源对": v["同源对"],
                          "模态对": dict(sorted(v["模态对"].items(),
                                              key=lambda x: -x[1]))}
                     for k, v in sorted(by_ds.items())},
    }
