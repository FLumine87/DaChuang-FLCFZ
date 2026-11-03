"""桥接的持久化：state.json（W 矩阵）+ index.db（位带索引与单元元信息）。

与主引擎的持久化方式保持一致：
  主引擎  state.json（模型参数）+ index.db（索引单元）
  桥接    bridge_<pair>_state.json（模型参数）+ bridge_<pair>_index.db（索引单元）

为什么要持久化：桥接训练要 30~60 秒（3000 行 n×n 监督矩阵的特征分解），
每次服务重启都重训不可接受；且线上与评测必须用同一份码，否则查询码与库码不同源。
"""
import json
import os
import sqlite3
from typing import Dict, List, Optional, Tuple

from .cmfh import OnlineSupervisedCMFH
from .multi_table_index import MultiTableHashIndex

STATE_VERSION = 3


class BridgeStore:
    """桥接模型的落库与加载。"""

    def __init__(self, data_dir: str, pair: Tuple[str, str]):
        self.dir = data_dir
        self.pair = pair
        tag = f"{pair[0]}-{pair[1]}"
        self.state_path = os.path.join(data_dir, f"bridge_{tag}_state.json")
        self.index_path = os.path.join(data_dir, f"bridge_{tag}_index.db")

    # ------------------------------------------------------------------
    def save(self, bridge) -> None:
        """保存模型参数与索引单元。"""
        os.makedirs(self.dir, exist_ok=True)
        state = {
            "version": STATE_VERSION,
            "pair": list(self.pair),
            "code_length": bridge.K,
            "lambda_s": bridge.lambda_s,
            "band_bits": bridge.band_bits,
            "probe_bits": bridge.probe_bits,
            "modalities": list((bridge.model.W or {}).keys()),
            "W": bridge.model.W,
            "B": bridge.model.B,
            "continuous": bridge.model.continuous,
            "feature_spec": bridge.feature_spec,
            "units": {uid: {k: v for k, v in m.items() if k != "code"}
                      for uid, m in bridge.units.items()},
            "codes": {uid: m.get("code") for uid, m in bridge.units.items()},
            "records": bridge.records,
        }
        tmp = self.state_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False)
        os.replace(tmp, self.state_path)

    # ------------------------------------------------------------------
    def load(self) -> Optional[object]:
        """加载已保存的桥接；没有或版本不符返回 None。"""
        if not os.path.exists(self.state_path):
            return None
        try:
            with open(self.state_path, "r", encoding="utf-8") as f:
                st = json.load(f)
        except Exception:
            return None
        if st.get("version") != STATE_VERSION:
            return None
        if tuple(st.get("pair") or ()) != tuple(self.pair):
            return None

        from .image_bridge import ImageTextBridge
        br = ImageTextBridge(code_length=int(st.get("code_length") or 64),
                             lambda_s=float(st.get("lambda_s") or 0.6),
                             band_bits=int(st.get("band_bits") or 8),
                             probe_bits=int(st.get("probe_bits") or 2))
        br.model.W = st.get("W") or {}
        br.model.B = st.get("B")
        br.model.continuous = st.get("continuous")
        br.model.modalities = list((br.model.W or {}).keys())
        br.model.trained = True
        # 桥接自身的 trained 也要置位：ImageTextBridge.encode_query 会先看它，
        # 漏掉的话查询向量直接返回全 0 → 位带键全是 "00000000" → 召不回任何东西。
        br.trained = True
        br.feature_spec = st.get("feature_spec") or {}
        br.pair = tuple(st.get("pair") or self.pair)

        codes = st.get("codes") or {}
        units = st.get("units") or {}
        br.units = {}
        for uid, meta in units.items():
            m = dict(meta)
            m["code"] = codes.get(uid) or []
            br.units[uid] = m
        br.records = st.get("records") or {}

        br.index = MultiTableHashIndex(
            code_length=br.K, band_bits=br.band_bits,
            probe_bits=br.probe_bits, rho_min=0.0, sigma_min=0.0,
        )
        for uid, m in br.units.items():
            if m.get("code"):
                br.index.insert(uid, list(m["code"]), m, window=0)
        return br
