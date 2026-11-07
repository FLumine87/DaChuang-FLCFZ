"""哈希索引的持久化层（SQLite）。

替代原先 `hashing_state.json` 的全量快照：索引单元按行存储，增量写入只追加，
不再每次重写数 MB 的 JSON。`hashing_state.json` 保留模型参数与来源元信息
（体积小，只在训练后写一次）。

表结构
------
units        索引单元，一行 = 某条记录在某个模态下的视图
records      记录级信息（主题 / 风险 / 时间窗 / 归属）
train_queue  待训练队列，审核通过后入队，重训消费后回填版本
train_runs   训练版本账本，记录每次重训用了哪些窗口、多少样本、前后指标
table_meta   时间窗表的质量与权重
meta         引擎级键值（窗口口径、数据源、迁移标记）

可见性约定
----------
scope 四态：reviewing（待审，本人与管理员可见）、public（公共池）、
private（本人私有）、rejected（审核拒绝，仅审计）。
检索侧据此过滤，见 engine.search_with_info 的 viewer 参数。
"""
import json
import os
import sqlite3
import threading
from typing import Dict, Iterable, List, Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS units (
    unit_id     TEXT PRIMARY KEY,
    record_id   TEXT NOT NULL,
    user_id     INTEGER,
    modality    TEXT DEFAULT 'text',
    code        TEXT,
    window      INTEGER,
    scope       TEXT DEFAULT 'reviewing',
    source      TEXT DEFAULT 'runtime',
    alert_level TEXT DEFAULT 'green',
    tags        TEXT,
    content     TEXT,
    excerpt     TEXT,
    deid_terms  TEXT,
    media_path  TEXT,
    media_kind  TEXT,
    media_meta  TEXT,
    feature     TEXT,
    dataset     TEXT,
    date        TEXT,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_units_window ON units(window);
CREATE INDEX IF NOT EXISTS ix_units_scope ON units(scope);
CREATE INDEX IF NOT EXISTS ix_units_record ON units(record_id);
CREATE INDEX IF NOT EXISTS ix_units_user ON units(user_id);

CREATE TABLE IF NOT EXISTS records (
    record_id   TEXT PRIMARY KEY,
    user_id     INTEGER,
    tags        TEXT,
    alert_level TEXT,
    date        TEXT,
    window      INTEGER,
    scope       TEXT DEFAULT 'reviewing',
    source      TEXT DEFAULT 'runtime'
);

CREATE TABLE IF NOT EXISTS train_queue (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id    TEXT NOT NULL,
    window       INTEGER,
    enqueued_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    consumed_at  TEXT,
    train_version TEXT
);
CREATE INDEX IF NOT EXISTS ix_queue_pending ON train_queue(consumed_at);
CREATE INDEX IF NOT EXISTS ix_queue_record ON train_queue(record_id);

CREATE TABLE IF NOT EXISTS train_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    version     TEXT,
    started_at  TEXT,
    finished_at TEXT,
    windows     TEXT,
    n_samples   INTEGER,
    map_before  REAL,
    map_after   REAL,
    note        TEXT
);

CREATE TABLE IF NOT EXISTS table_meta (
    window      INTEGER PRIMARY KEY,
    n_samples   INTEGER DEFAULT 0,
    rho         REAL DEFAULT 0,
    sigma       REAL DEFAULT 0,
    weight      REAL DEFAULT 0,
    active      INTEGER DEFAULT 0,
    version     TEXT,
    updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""

# 逻辑列（meta 字典 <-> 表字段），JSON 字段单独处理
_JSON_FIELDS = ("tags", "deid_terms", "media_meta", "feature")
_COLUMNS = (
    "unit_id", "record_id", "user_id", "modality", "code", "window", "scope",
    "source", "alert_level", "tags", "content", "excerpt", "deid_terms",
    "media_path", "media_kind", "media_meta", "feature", "dataset", "date",
)


def bits_to_hex(bits: Iterable[int]) -> str:
    """0/1 序列 -> 十六进制串（64 位 -> 16 字符）。"""
    bits = [1 if b else 0 for b in bits]
    out = []
    for i in range(0, len(bits), 4):
        nibble = 0
        for b in bits[i:i + 4]:
            nibble = (nibble << 1) | b
        out.append("0123456789abcdef"[nibble])
    return "".join(out)


def hex_to_bits(hexstr: str) -> List[int]:
    """十六进制串 -> 0/1 列表。"""
    bits: List[int] = []
    for ch in (hexstr or ""):
        v = int(ch, 16)
        bits.extend([(v >> 3) & 1, (v >> 2) & 1, (v >> 1) & 1, v & 1])
    return bits


class HashingStore:
    """索引持久化。线程安全，单连接复用（与主库同一套做法）。"""

    def __init__(self, path: str):
        self.path = path
        self._conn: Optional[sqlite3.Connection] = None
        self._lock = threading.Lock()

    # ------------------------- 连接 -------------------------

    def _c(self) -> sqlite3.Connection:
        if self._conn is None:
            os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
            self._conn = sqlite3.connect(self.path, check_same_thread=False)
            self._conn.row_factory = sqlite3.Row
            self._conn.executescript(SCHEMA)
        return self._conn

    def init_schema(self) -> None:
        with self._lock:
            conn = self._c()
            # CREATE TABLE IF NOT EXISTS 不会给已存在的表加列，缺列时单独补
            cols = {row[1] for row in conn.execute("PRAGMA table_info(units)")}
            if "feature" not in cols:
                conn.execute("ALTER TABLE units ADD COLUMN feature TEXT")
            conn.commit()

    def close(self) -> None:
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None

    # ------------------------- meta -------------------------

    def meta_get(self, key: str, default: str = "") -> str:
        with self._lock:
            row = self._c().execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default

    def meta_set(self, key: str, value: str) -> None:
        with self._lock:
            conn = self._c()
            conn.execute(
                "INSERT INTO meta(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, str(value)),
            )
            conn.commit()

    # ------------------------- units -------------------------

    @staticmethod
    def _to_row(unit_id: str, meta: Dict) -> Dict:
        row = {"unit_id": unit_id}
        for col in _COLUMNS:
            if col == "unit_id":
                continue
            if col == "code":
                raw = meta.get("code") or []
                row[col] = bits_to_hex(raw) if raw and not isinstance(raw, str) else (raw or "")
            elif col in _JSON_FIELDS:
                val = meta.get(col)
                if col == "feature" and isinstance(val, list):
                    # 特征只保留 4 位小数：重训与重编码要复用，读盘比重新解码快一个量级
                    val = [round(float(x), 4) for x in val]
                row[col] = json.dumps(val, ensure_ascii=False) if val is not None else None
            else:
                row[col] = meta.get(col)
        return row

    @staticmethod
    def _to_meta(row: sqlite3.Row) -> Dict:
        meta: Dict = {}
        for col in _COLUMNS:
            if col in ("unit_id", "code"):
                continue
            if col in _JSON_FIELDS:
                raw = row[col]
                try:
                    meta[col] = json.loads(raw) if raw else ([] if col == "tags" else None)
                except Exception:
                    meta[col] = [] if col == "tags" else None
            else:
                meta[col] = row[col]
        meta["code"] = hex_to_bits(row["code"] or "")
        return meta

    def upsert_unit(self, unit_id: str, meta: Dict) -> None:
        row = self._to_row(unit_id, meta)
        cols = list(row.keys())
        placeholders = ", ".join("?" for _ in cols)
        updates = ", ".join(f"{c} = excluded.{c}" for c in cols if c != "unit_id")
        sql = (f"INSERT INTO units({', '.join(cols)}) VALUES({placeholders}) "
               f"ON CONFLICT(unit_id) DO UPDATE SET {updates}, updated_at = CURRENT_TIMESTAMP")
        with self._lock:
            conn = self._c()
            conn.execute(sql, [row[c] for c in cols])
            conn.commit()

    def upsert_units(self, items: Dict[str, Dict]) -> None:
        """批量写入（迁移 / 重建用）。"""
        if not items:
            return
        cols = list(_COLUMNS)
        placeholders = ", ".join("?" for _ in cols)
        updates = ", ".join(f"{c} = excluded.{c}" for c in cols if c != "unit_id")
        sql = (f"INSERT INTO units({', '.join(cols)}) VALUES({placeholders}) "
               f"ON CONFLICT(unit_id) DO UPDATE SET {updates}, updated_at = CURRENT_TIMESTAMP")
        params = [[r[c] for c in cols] for r in (self._to_row(uid, m) for uid, m in items.items())]
        with self._lock:
            conn = self._c()
            conn.executemany(sql, params)
            conn.commit()

    def delete_unit(self, unit_id: str) -> None:
        with self._lock:
            conn = self._c()
            conn.execute("DELETE FROM units WHERE unit_id = ?", (unit_id,))
            conn.commit()

    def clear_all(self) -> None:
        """清空索引数据（仅开发调试用，保留表结构）。"""
        with self._lock:
            conn = self._c()
            for table in ("units", "records", "train_queue", "train_runs", "table_meta"):
                conn.execute(f"DELETE FROM {table}")
            conn.commit()

    def load_units(self) -> Dict[str, Dict]:
        with self._lock:
            rows = self._c().execute("SELECT * FROM units").fetchall()
        return {r["unit_id"]: self._to_meta(r) for r in rows}

    def count_units(self, scope: Optional[str] = None) -> int:
        sql = "SELECT COUNT(*) AS c FROM units"
        params: tuple = ()
        if scope:
            sql += " WHERE scope = ?"
            params = (scope,)
        with self._lock:
            row = self._c().execute(sql, params).fetchone()
        return int(row["c"]) if row else 0

    def update_scope(self, scope: str, record_ids: Optional[List[str]] = None,
                     unit_ids: Optional[List[str]] = None) -> int:
        """批量改可见性。record_ids 与 unit_ids 至少给一个。"""
        conn = self._c()
        n = 0
        with self._lock:
            if record_ids:
                marks = ",".join("?" for _ in record_ids)
                cur = conn.execute(
                    f"UPDATE units SET scope = ?, updated_at = CURRENT_TIMESTAMP "
                    f"WHERE record_id IN ({marks})", [scope, *record_ids])
                n += cur.rowcount or 0
                conn.execute(
                    f"UPDATE records SET scope = ? WHERE record_id IN ({marks})",
                    [scope, *record_ids])
            if unit_ids:
                marks = ",".join("?" for _ in unit_ids)
                cur = conn.execute(
                    f"UPDATE units SET scope = ?, updated_at = CURRENT_TIMESTAMP "
                    f"WHERE unit_id IN ({marks})", [scope, *unit_ids])
                n += cur.rowcount or 0
            conn.commit()
        return n

    # ------------------------- records -------------------------

    def upsert_record(self, record_id: str, meta: Dict) -> None:
        with self._lock:
            conn = self._c()
            conn.execute(
                "INSERT INTO records(record_id, user_id, tags, alert_level, date, window, scope, source) "
                "VALUES(?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(record_id) DO UPDATE SET tags = excluded.tags, "
                "alert_level = excluded.alert_level, date = excluded.date, "
                "window = excluded.window, scope = excluded.scope, source = excluded.source",
                (record_id, meta.get("user_id"), json.dumps(meta.get("tags") or [], ensure_ascii=False),
                 meta.get("alert_level") or "green", meta.get("date") or "",
                 meta.get("window"), meta.get("scope") or "reviewing",
                 meta.get("source") or "runtime"),
            )
            conn.commit()

    def upsert_records(self, items: Dict[str, Dict]) -> None:
        """批量写入记录级信息（冷启动播种后一次性落盘）。"""
        if not items:
            return
        sql = ("INSERT INTO records(record_id, user_id, tags, alert_level, date, window, scope, source) "
               "VALUES(?, ?, ?, ?, ?, ?, ?, ?) "
               "ON CONFLICT(record_id) DO UPDATE SET tags = excluded.tags, "
               "alert_level = excluded.alert_level, date = excluded.date, "
               "window = excluded.window, scope = excluded.scope, source = excluded.source")
        params = []
        for rid, m in items.items():
            params.append([
                rid, m.get("user_id"), json.dumps(m.get("tags") or [], ensure_ascii=False),
                m.get("alert_level") or "green", m.get("date") or "",
                m.get("window"), m.get("scope") or "reviewing", m.get("source") or "runtime",
            ])
        with self._lock:
            conn = self._c()
            conn.executemany(sql, params)
            conn.commit()

    def load_records(self) -> Dict[str, Dict]:
        with self._lock:
            rows = self._c().execute("SELECT * FROM records").fetchall()
        out: Dict[str, Dict] = {}
        for r in rows:
            try:
                tags = json.loads(r["tags"]) if r["tags"] else []
            except Exception:
                tags = []
            out[r["record_id"]] = {
                "record_id": r["record_id"], "user_id": r["user_id"], "tags": tags,
                "alert_level": r["alert_level"], "date": r["date"],
                "window": r["window"], "scope": r["scope"], "source": r["source"],
            }
        return out

    # ------------------------- 训练队列 -------------------------

    def enqueue(self, record_id: str, window: Optional[int], version: str = "") -> None:
        with self._lock:
            conn = self._c()
            dup = conn.execute(
                "SELECT id FROM train_queue WHERE record_id = ? AND consumed_at IS NULL",
                (record_id,)).fetchone()
            if dup:
                return
            conn.execute(
                "INSERT INTO train_queue(record_id, window, train_version) VALUES(?, ?, ?)",
                (record_id, window, version))
            conn.commit()

    def pending_training(self, limit: int = 500) -> List[Dict]:
        with self._lock:
            rows = self._c().execute(
                "SELECT * FROM train_queue WHERE consumed_at IS NULL ORDER BY id LIMIT ?",
                (int(limit),)).fetchall()
        return [dict(r) for r in rows]

    def pending_count(self) -> int:
        with self._lock:
            row = self._c().execute(
                "SELECT COUNT(*) AS c FROM train_queue WHERE consumed_at IS NULL").fetchone()
        return int(row["c"]) if row else 0

    def mark_consumed(self, queue_ids: List[int], version: str) -> None:
        if not queue_ids:
            return
        marks = ",".join("?" for _ in queue_ids)
        with self._lock:
            conn = self._c()
            conn.execute(
                f"UPDATE train_queue SET consumed_at = CURRENT_TIMESTAMP, train_version = ? "
                f"WHERE id IN ({marks})", [version, *queue_ids])
            conn.commit()

    # ------------------------- 训练版本与表元 -------------------------

    def save_train_run(self, version: str, started_at: str, finished_at: str,
                       windows: List[int], n_samples: int,
                       map_before: Optional[float] = None,
                       map_after: Optional[float] = None, note: str = "") -> None:
        with self._lock:
            conn = self._c()
            conn.execute(
                "INSERT INTO train_runs(version, started_at, finished_at, windows, n_samples, "
                "map_before, map_after, note) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                (version, started_at, finished_at, json.dumps(windows), n_samples,
                 map_before, map_after, note))
            conn.commit()

    def last_train_version(self) -> str:
        with self._lock:
            row = self._c().execute(
                "SELECT version FROM train_runs ORDER BY id DESC LIMIT 1").fetchone()
        return row["version"] if row else ""

    def save_table_meta(self, stats: List[Dict]) -> None:
        with self._lock:
            conn = self._c()
            for s in stats:
                conn.execute(
                    "INSERT INTO table_meta(window, n_samples, rho, sigma, weight, active, version, updated_at) "
                    "VALUES(?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) "
                    "ON CONFLICT(window) DO UPDATE SET n_samples = excluded.n_samples, "
                    "rho = excluded.rho, sigma = excluded.sigma, weight = excluded.weight, "
                    "active = excluded.active, version = excluded.version, updated_at = CURRENT_TIMESTAMP",
                    (int(s.get("window") or 0), int(s.get("size") or s.get("n_samples") or 0),
                     float(s.get("rho") or 0), float(s.get("sigma") or 0),
                     float(s.get("weight") or s.get("trust") or 0),
                     1 if s.get("active") else 0, str(s.get("version") or "")))
            conn.commit()

    def load_table_meta(self) -> Dict[int, Dict]:
        with self._lock:
            rows = self._c().execute("SELECT * FROM table_meta").fetchall()
        return {int(r["window"]): dict(r) for r in rows}

    def delete_table_meta(self, window: int) -> None:
        with self._lock:
            conn = self._c()
            conn.execute("DELETE FROM table_meta WHERE window = ?", (int(window),))
            conn.commit()

    # ------------------------- 迁移 -------------------------

    def migrate_state_file(self, state_path: str, default_scope: str = "public") -> int:
        """把旧版 hashing_state.json 的 units/records 导入 SQLite。

        返回导入单元数。已存在同名 unit 时覆盖，保证可重复执行。
        历史数据默认 public：迁移前它们已在公共检索池中，不改变线上可见性。
        """
        if not os.path.exists(state_path):
            return 0
        try:
            with open(state_path, "r", encoding="utf-8") as f:
                state = json.load(f)
        except Exception:
            return 0
        units = state.get("units") or {}
        records = state.get("records") or {}
        if not units:
            return 0
        payload: Dict[str, Dict] = {}
        for uid, meta in units.items():
            m = dict(meta)
            m.setdefault("scope", default_scope)
            m.setdefault("source", "corpus" if state.get("source", "").startswith("corpus") else "runtime")
            payload[uid] = m
        self.upsert_units(payload)
        for rid, meta in records.items():
            r = dict(meta)
            r.setdefault("scope", default_scope)
            r.setdefault("source", "corpus" if state.get("source", "").startswith("corpus") else "runtime")
            self.upsert_record(rid, r)
        self.meta_set("source", state.get("source") or "")
        self.meta_set("source_count", str(state.get("source_count") or 0))
        self.meta_set("corpus_meta", json.dumps(state.get("corpus_meta") or {}, ensure_ascii=False))
        self.meta_set("migrated_from", os.path.basename(state_path))
        return len(payload)
