"""桥接的持久化：模型参数（state.json）+ 单元索引（SQLite）。

与主引擎的持久化方式一致：
  主引擎  hashing_state.json（模型参数）+ index.db（索引单元）
  桥接    bridge_<pair>_state.json（模型参数）+ bridge_<pair>_units.db（单元）

为什么单元放 SQLite 而不是全塞 state.json
--------------------------------------
桥接的语料单元有 6000~9000 个，state.json 约 9.4MB。
运行时新增的采集数据要增量写入 —— 若每次新增都重写整个 JSON，
一次采集就是 9.4MB 的写放大。SQLite upsert 一行即可，
加载时从库里读全部单元重建位带索引。

单元表结构与主引擎的 units 表同构，便于同一套 meta 字段
（标签溯源需要 dataset / alert_level / media_path 等）。
"""
import json
import os
import sqlite3
from typing import Dict, Optional, Tuple

from .multi_table_index import MultiTableHashIndex

STATE_VERSION = 4

_UNITS_SCHEMA = (
    """CREATE TABLE IF NOT EXISTS bridge_units(
    unit_id TEXT PRIMARY KEY,
    record_id TEXT,
    modality TEXT,
    code TEXT,
    tags TEXT,
    source TEXT,
    scope TEXT,
    meta TEXT
)""",
    "CREATE INDEX IF NOT EXISTS ix_bridge_rec ON bridge_units(record_id)",
    "CREATE INDEX IF NOT EXISTS ix_bridge_src ON bridge_units(source)",
)


class BridgeStore:
    """桥接模型的落库与加载。"""

    def __init__(self, data_dir: str, pair: Tuple[str, str]):
        self.dir = data_dir
        self.pair = tuple(pair)
        tag = f"{pair[0]}-{pair[1]}"
        self.state_path = os.path.join(data_dir, f"bridge_{tag}_state.json")
        self.units_path = os.path.join(data_dir, f"bridge_{tag}_units.db")

    # ------------------------------------------------------------------
    def _conn(self) -> sqlite3.Connection:
        os.makedirs(self.dir, exist_ok=True)
        conn = sqlite3.connect(self.units_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        for stmt in _UNITS_SCHEMA:
            conn.execute(stmt)
        return conn

    # ------------------------------------------------------------------
    @staticmethod
    def _row(uid: str, m: Dict):
        return (
            uid, m.get("record_id"), m.get("modality"),
            json.dumps(m.get("code") or []),
            json.dumps(m.get("tags") or [], ensure_ascii=False),
            m.get("source") or "runtime", m.get("scope"),
            json.dumps({k: v for k, v in m.items()
                        if k not in ("code", "tags")},
                       ensure_ascii=False, default=str),
        )

    # ------------------------------------------------------------------
    def save_model(self, bridge) -> None:
        """只存模型参数（单元另存 units.db）。"""
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
        }
        tmp = self.state_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False)
        os.replace(tmp, self.state_path)

    def save_units(self, units: Dict[str, Dict]) -> None:
        """全量覆盖写入单元（构建时用）。"""
        conn = self._conn()
        try:
            conn.execute("DELETE FROM bridge_units")
            conn.executemany(
                "INSERT OR REPLACE INTO bridge_units VALUES (?,?,?,?,?,?,?,?)",
                [self._row(uid, m) for uid, m in units.items()])
            conn.commit()
        finally:
            conn.close()

    def upsert_units(self, units: Dict[str, Dict]) -> int:
        """增量写入单元（运行时新增采集数据时用）。"""
        if not units:
            return 0
        conn = self._conn()
        try:
            conn.executemany(
                "INSERT OR REPLACE INTO bridge_units VALUES (?,?,?,?,?,?,?,?)",
                [self._row(uid, m) for uid, m in units.items()])
            conn.commit()
            return len(units)
        finally:
            conn.close()

    def load_units(self) -> Dict[str, Dict]:
        conn = self._conn()
        try:
            out = {}
            for r in conn.execute("SELECT * FROM bridge_units"):
                try:
                    meta = json.loads(r["meta"] or "{}")
                except Exception:
                    meta = {}
                try:
                    code = json.loads(r["code"] or "[]")
                except Exception:
                    code = []
                try:
                    tags = json.loads(r["tags"] or "[]")
                except Exception:
                    tags = []
                meta.update({"record_id": r["record_id"],
                             "modality": r["modality"],
                             "tags": tags, "code": code})
                if r["source"]:
                    meta.setdefault("source", r["source"])
                if r["scope"]:
                    meta.setdefault("scope", r["scope"])
                out[r["unit_id"]] = meta
            return out
        finally:
            conn.close()

    # ------------------------------------------------------------------
    def load(self):
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

        br.units = self.load_units()
        br.records = {}
        for m in br.units.values():
            rid = m.get("record_id")
            if rid and rid not in br.records:
                br.records[rid] = {"record_id": rid, "tags": m.get("tags") or []}

        br.index = MultiTableHashIndex(
            code_length=br.K, band_bits=br.band_bits,
            probe_bits=br.probe_bits, rho_min=0.0, sigma_min=0.0,
        )
        for uid, m in br.units.items():
            if m.get("code"):
                br.index.insert(uid, list(m["code"]), m, window=0)
        return br
