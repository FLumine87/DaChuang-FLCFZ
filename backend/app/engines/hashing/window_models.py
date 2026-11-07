"""按时间窗维护的哈希模型池。

项目书要求「每一模态维护多张基于不同时间子集训练的哈希表」。原实现只有一套
全局投影矩阵 W，6 个时间窗共用，窗口只体现为索引分区。这里把窗口升级为模型
分区：每个窗口独立训练一套 CMFH，检索时各窗口用各自的 W 编码查询、各自召回，
再按表权重融合。

权重由三个因子相乘：语义一致性 rho、编码信息量 sigma、时效衰减 exp(-dT/tau)。
权重只影响融合排序，不改变返回给前端的相似度数值。
"""
import datetime
import math
from typing import Dict, List, Optional

from app.engines.hashing.cmfh import OnlineSupervisedCMFH


class WindowModelBank:
    """窗口 -> 独立哈希模型。"""

    def __init__(self, code_length: int = 64, lambda_s: float = 0.6, tau_days: int = 365):
        self.code_length = int(code_length)
        self.lambda_s = float(lambda_s)
        self.tau_days = int(tau_days)
        self.models: Dict[int, OnlineSupervisedCMFH] = {}
        self.meta: Dict[int, Dict] = {}

    # ------------------------- 训练 -------------------------

    def fit(self, window: int, features: Dict[str, List[List[float]]],
            similarity: List[List[float]], n_samples: int = 0) -> bool:
        """为单个窗口训练一套投影矩阵。features 为 {modality: [vec, ...]}。"""
        if not features or not similarity:
            return False
        model = OnlineSupervisedCMFH(code_length=self.code_length,
                                     lambda_s=self.lambda_s)
        try:
            model.fit(features, similarity)
        except Exception:
            return False
        if not model.W:
            return False
        self.models[int(window)] = model
        self.meta[int(window)] = {
            "n_samples": int(n_samples or len(similarity)),
            "modalities": list(model.W.keys()),
            "trained_at": datetime.datetime.now().isoformat(timespec="seconds"),
        }
        return True

    def drop(self, window: int) -> None:
        self.models.pop(int(window), None)
        self.meta.pop(int(window), None)

    # ------------------------- 取用 -------------------------

    def get(self, window: int) -> Optional[OnlineSupervisedCMFH]:
        return self.models.get(int(window))

    def nearest(self, window: int) -> Optional[OnlineSupervisedCMFH]:
        """取最近的已训练窗口模型，供新窗口冷启动借用。"""
        if not self.models:
            return None
        w = int(window)
        return self.models[min(self.models.keys(), key=lambda k: abs(k - w))]

    def model_for(self, window: int) -> Optional[OnlineSupervisedCMFH]:
        return self.get(window) or self.nearest(window)

    def windows(self) -> List[int]:
        return sorted(self.models.keys())

    # ------------------------- 权重 -------------------------

    def window_center(self, window: int, epoch: datetime.date, window_days: int) -> datetime.date:
        start = epoch + datetime.timedelta(days=int(window) * int(window_days))
        return start + datetime.timedelta(days=int(window_days) // 2)

    def weight_from_quality(self, window: int, quality: float,
                            epoch: datetime.date, window_days: int,
                            today: Optional[datetime.date] = None,
                            cold_start: bool = False) -> float:
        """由综合质量分算表权重（质量分由调用方按单指标或双指标给出）。"""
        base = 0.85 if cold_start else 0.78 + 0.22 * max(0.0, min(1.0, float(quality)))
        today = today or datetime.date.today()
        center = self.window_center(window, epoch, window_days)
        decay = math.exp(-abs((today - center).days) / max(1, self.tau_days))
        return round(base * max(0.8, decay), 6)

    def weight(self, window: int, rho: float, sigma: float,
               epoch: datetime.date, window_days: int,
               today: Optional[datetime.date] = None,
               cold_start: bool = False) -> float:
        """表权重 = 语义质量 × 时效衰减，输出区间约 [0.6, 1.0]。

        关键约束：权重只能做温和调制。各窗口的模型是独立训练的，相似度数值
        本身就不在同一尺度上，权重系数放大到两倍以上会直接压过相似度，
        把低分窗口的结果顶到前面（实测 mAP 从 0.48 掉到 0.38）。
        """
        if cold_start:
            base = 0.85
        else:
            rho_score = min(1.0, max(0.0, float(rho)) / 0.4)
            sigma_score = min(1.0, max(0.0, float(sigma)) / 0.3)
            base = 0.78 + 0.22 * (0.75 * rho_score + 0.25 * sigma_score)
        today = today or datetime.date.today()
        center = self.window_center(window, epoch, window_days)
        delta = abs((today - center).days)
        decay = math.exp(-delta / max(1, self.tau_days))
        # 衰减下限 0.8：时效只做排序偏好，不淘汰历史经验
        return round(base * max(0.8, decay), 6)

    # ------------------------- 持久化 -------------------------

    def to_state(self) -> Dict:
        return {
            "code_length": self.code_length,
            "lambda_s": self.lambda_s,
            "tau_days": self.tau_days,
            "models": {str(w): {"W": m.W, "modalities": m.modalities,
                                "n": self.meta.get(w, {}).get("n_samples", 0),
                                "trained_at": self.meta.get(w, {}).get("trained_at", "")}
                       for w, m in self.models.items()},
        }

    def from_state(self, state: Dict) -> bool:
        models = (state or {}).get("models") or {}
        if not models:
            return False
        self.code_length = int(state.get("code_length") or self.code_length)
        self.lambda_s = float(state.get("lambda_s") or self.lambda_s)
        self.tau_days = int(state.get("tau_days") or self.tau_days)
        loaded = 0
        for raw_w, payload in models.items():
            try:
                w = int(raw_w)
            except (TypeError, ValueError):
                continue
            W = (payload or {}).get("W") or {}
            if not W:
                continue
            model = OnlineSupervisedCMFH(code_length=self.code_length,
                                         lambda_s=self.lambda_s)
            model.W = W
            model.modalities = (payload or {}).get("modalities") or list(W.keys())
            model.trained = True
            self.models[w] = model
            self.meta[w] = {
                "n_samples": int((payload or {}).get("n") or 0),
                "modalities": model.modalities,
                "trained_at": (payload or {}).get("trained_at") or "",
            }
            loaded += 1
        return loaded > 0

    def prune(self, max_tables: int, weights: Dict[int, float]) -> List[int]:
        """活跃表超过上限时淘汰权重最低的窗口，返回被淘汰的窗口号。"""
        if max_tables <= 0 or len(self.models) <= max_tables:
            return []
        ranked = sorted(self.models.keys(), key=lambda w: weights.get(w, 0.0))
        dropped = ranked[: len(self.models) - max_tables]
        for w in dropped:
            self.drop(w)
        return dropped
