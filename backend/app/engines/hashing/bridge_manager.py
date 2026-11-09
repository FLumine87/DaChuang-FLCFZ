"""桥接管理器：统一加载、按模态对路由。

路由规则（「查询模态 × 结果模态」→ 通道）
----------------------------------------
    文↔文 / 文↔音 / 音↔音  → 主引擎共享码空间（真同源，四格 0.44 稳定）
    文↔图 / 图↔文            → 文-图桥接（CNN 特征，λ=20）
    音↔图 / 图↔音            → 音-图桥接（CNN 特征，λ=50）
    图↔图                    → 独立图像库（image_index.py，队长已实现）

实测（653 查询，九格）：
    图搜文 0.2231 → 0.5776    图搜音 0.2439 → 0.4193
    九格均值 0.3522 → 0.4407   文-音四格完全不变（桥接与主引擎隔离）

桥接模型缺失时（未跑 build_bridges.py）自动降级到主引擎，不报错。
"""
import os
import threading
from typing import Dict, Optional, Tuple

from ..hashing.bridge_store import BridgeStore

# 模态对 → 通道名
TEXT_IMAGE = ("text", "image")
AUDIO_IMAGE = ("audio", "image")

# 实测最优参数（见 docs 与 eval_bridge_lambda.py）
DEFAULT_LAMBDA = {TEXT_IMAGE: 20.0, AUDIO_IMAGE: 50.0}
DEFAULT_CODE_LENGTH = 64


class BridgeManager:
    """桥接模型的懒加载与路由。"""

    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        self._cache: Dict[Tuple[str, str], object] = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    def get(self, pair: Tuple[str, str]):
        """取指定模态对的桥接；没有或加载失败返回 None。"""
        with self._lock:
            if pair in self._cache:
                return self._cache[pair]
            br = None
            try:
                br = BridgeStore(self.data_dir, pair).load()
            except Exception:
                br = None
            self._cache[pair] = br
            return br

    def available(self, pair: Tuple[str, str]) -> bool:
        return self.get(pair) is not None

    def status(self) -> Dict:
        out = {}
        for pair in (TEXT_IMAGE, AUDIO_IMAGE):
            br = self.get(pair)
            tag = f"{pair[0]}-{pair[1]}"
            if br is None:
                out[tag] = {"ready": False,
                            "hint": "运行 scripts/build_bridges.py 构建"}
            else:
                out[tag] = {
                    "ready": True, "units": len(br.units),
                    "records": len(br.records), "code_length": br.K,
                    "lambda_s": br.lambda_s,
                }
        return out

    # ------------------------------------------------------------------
    def route(self, query_modality: str, result_modality: Optional[str]):
        """按「查询模态 × 结果模态」选通道。

        返回 ("main", None) 表示走主引擎；
        返回 ("bridge", (pair, 桥接对象)) 表示走桥接。
        result_modality 为 None（不限结果模态）时一律走主引擎。
        """
        if not result_modality:
            return ("main", None)
        if query_modality == "image" and result_modality == "text":
            pair = TEXT_IMAGE
        elif query_modality == "text" and result_modality == "image":
            pair = TEXT_IMAGE
        elif query_modality == "image" and result_modality == "audio":
            pair = AUDIO_IMAGE
        elif query_modality == "audio" and result_modality == "image":
            pair = AUDIO_IMAGE
        else:
            return ("main", None)
        br = self.get(pair)
        if br is None:
            return ("main", None)
        return ("bridge", (pair, br))


_MANAGER: Optional[BridgeManager] = None
_MANAGER_LOCK = threading.Lock()


def get_bridge_manager(data_dir: str = "") -> BridgeManager:
    """全局单例。"""
    global _MANAGER
    with _MANAGER_LOCK:
        if _MANAGER is None:
            if not data_dir:
                from app.config import settings
                data_dir = settings.HASHING_DATA_DIR
            _MANAGER = BridgeManager(data_dir)
        return _MANAGER
