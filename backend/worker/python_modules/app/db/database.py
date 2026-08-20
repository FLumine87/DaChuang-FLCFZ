"""轻量数据访问层（标准库 sqlite3 / Cloudflare D1 双模式）。

两套 API：
  - async（业务链使用，Worker 下必须 await D1 binding）：
      query_a / query_one_a / execute_a / init_db
  - sync（仅本地：sqlite3 引擎播种、本地脚本）：
      query / query_one / execute / init_db_sync
    注意：sync 版在 Worker 下不可用（D1 为异步 API）。
"""
import sqlite3
import threading

from app.core import runtime
from app.config import settings

_local_conn = None
_local_lock = threading.Lock()

# 建表 SQL（与 backend/worker/seed/schema.sql 保持一致；Worker 打包时依赖此内嵌版本）
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    role          TEXT DEFAULT 'counselor',
    department    TEXT,
    phone         TEXT,
    email         TEXT,
    is_active     INTEGER DEFAULT 1,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_users_username ON users(username);

CREATE TABLE IF NOT EXISTS questionnaires (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    code          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    description   TEXT,
    max_score     INTEGER NOT NULL,
    questions     TEXT,
    scoring_rules TEXT,
    is_active     INTEGER DEFAULT 1,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS screenings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    screening_id    TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    age             INTEGER,
    gender          TEXT,
    department      TEXT,
    phone           TEXT,
    questionnaire_id INTEGER NOT NULL,
    score           INTEGER DEFAULT 0,
    max_score       INTEGER DEFAULT 100,
    answers         TEXT,
    status          TEXT DEFAULT 'pending',
    alert_level     TEXT DEFAULT 'green',
    counselor_id    INTEGER,
    notes           TEXT,
    screening_date  DATETIME,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_screenings_screening_id ON screenings(screening_id);

CREATE TABLE IF NOT EXISTS alert_rules (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL,
    questionnaire_id INTEGER,
    min_score        INTEGER,
    max_score        INTEGER,
    alert_level      TEXT NOT NULL,
    description      TEXT,
    is_active        INTEGER DEFAULT 1,
    priority         INTEGER DEFAULT 0,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alerts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_id        TEXT NOT NULL UNIQUE,
    screening_id    INTEGER NOT NULL,
    name            TEXT NOT NULL,
    level           TEXT DEFAULT 'green',
    trigger         TEXT,
    description     TEXT,
    status          TEXT DEFAULT 'pending',
    assignee_id     INTEGER,
    follow_up_notes TEXT,
    resolved_at     DATETIME,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_alerts_alert_id ON alerts(alert_id);

CREATE TABLE IF NOT EXISTS case_tag_master (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    color       TEXT DEFAULT '#3b82f6',
    description TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cases (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id             TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    age                 INTEGER,
    gender              TEXT,
    department          TEXT,
    phone               TEXT,
    id_number           TEXT,
    alert_level         TEXT DEFAULT 'green',
    status              TEXT DEFAULT 'active',
    counselor_id        INTEGER,
    notes               TEXT,
    screening_count     INTEGER DEFAULT 0,
    last_screening_date DATETIME,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_cases_case_id ON cases(case_id);

CREATE TABLE IF NOT EXISTS case_tags_association (
    case_id INTEGER NOT NULL,
    tag_id  INTEGER NOT NULL,
    PRIMARY KEY (case_id, tag_id)
);

CREATE TABLE IF NOT EXISTS case_timeline (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id     INTEGER NOT NULL,
    event_type  TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    event_date  DATETIME,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media_files (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id         TEXT NOT NULL UNIQUE,
    screening_id    INTEGER,
    file_type       TEXT NOT NULL,
    file_name       TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    file_size       INTEGER DEFAULT 0,
    mime_type       TEXT,
    description     TEXT,
    analysis_result TEXT,
    uploaded_by     INTEGER,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_media_files_file_id ON media_files(file_id);
"""


def _get_local_conn() -> sqlite3.Connection:
    global _local_conn
    if _local_conn is None:
        path = settings.DATABASE_URL.replace("sqlite:///", "", 1)
        import os
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        _local_conn = sqlite3.connect(path, check_same_thread=False)
        _local_conn.row_factory = sqlite3.Row
    return _local_conn


def _norm_params(params):
    """参数规范化：datetime/date → 字符串（'YYYY-MM-DD HH:MM:SS'）。

    D1 的 bind() 不接受 Python datetime 对象，必须转字符串；
    sqlite3 本地路径统一处理保持一致。
    """
    out = []
    for p in params:
        if hasattr(p, "isoformat"):  # datetime / date
            out.append(str(p))
        else:
            out.append(p)
    return out


# ---------------- sync（仅本地 sqlite3） ----------------

def init_db_sync() -> None:
    with _local_lock:
        conn = _get_local_conn()
        conn.executescript(SCHEMA_SQL)
        conn.commit()


def query(sql: str, params=()) -> list:
    """SELECT（本地同步）。Worker 下请使用 query_a。"""
    if runtime.is_worker():
        raise RuntimeError("sync query 不可在 Worker 使用，请改用 query_a")
    with _local_lock:
        cur = _get_local_conn().execute(sql, list(_norm_params(params)))
        return [dict(r) for r in cur.fetchall()]


def query_one(sql: str, params=()):
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params=()) -> int:
    """INSERT/UPDATE/DELETE（本地同步）。Worker 下请使用 execute_a。"""
    if runtime.is_worker():
        raise RuntimeError("sync execute 不可在 Worker 使用，请改用 execute_a")
    with _local_lock:
        conn = _get_local_conn()
        cur = conn.execute(sql, list(_norm_params(params)))
        conn.commit()
        return cur.lastrowid


# ---------------- async（Worker D1 / 本地 sqlite3） ----------------

async def init_db() -> None:
    """幂等建表。Worker 走 D1（await exec）；本地执行 sqlite3。"""
    if runtime.is_worker():
        env = runtime.get_worker_env()
        if env is None:
            return
        await env.DB.exec(SCHEMA_SQL)
    else:
        init_db_sync()


async def query_a(sql: str, params=()) -> list:
    """SELECT，返回 dict 列表。Worker 下 await D1；本地复用 sync。"""
    if runtime.is_worker():
        env = runtime.get_worker_env()
        res = await env.DB.prepare(sql).bind(*_norm_params(params)).all()
        return [dict(r) for r in res.get("results", [])]
    return query(sql, params)


async def query_one_a(sql: str, params=()):
    rows = await query_a(sql, params)
    return rows[0] if rows else None


async def execute_a(sql: str, params=()) -> int:
    """INSERT/UPDATE/DELETE，返回 last_rowid（INSERT）或 rowcount。"""
    if runtime.is_worker():
        env = runtime.get_worker_env()
        res = await env.DB.prepare(sql).bind(*_norm_params(params)).run()
        meta = res.get("meta", {}) or {}
        return meta.get("last_row_id", 0)
    return execute(sql, params)
