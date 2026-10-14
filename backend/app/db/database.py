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
    user_id         INTEGER,
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
    case_id         INTEGER,
    consent_status  TEXT DEFAULT 'unknown',
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
    -- screening_id 可空：多模态采集产生的预警挂在用户名下（user_id），
    -- 不强制依赖筛查记录（新账号首次采集也能产生预警）。旧表为 NOT NULL，
    -- 由 init_db_sync 迁移重建放开。
    screening_id    INTEGER,
    user_id         INTEGER,
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

CREATE TABLE IF NOT EXISTS alert_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_id    INTEGER NOT NULL,
    actor_id    INTEGER NOT NULL,
    from_status TEXT,
    to_status   TEXT NOT NULL,
    note        TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_alert_events_alert_id ON alert_events(alert_id);

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
    user_id             INTEGER,
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

-- 「多模态采集」页的自愿补充（文本日记 / 语音片段 / 图片）。
-- 两种挂靠方式：
--   · screening_id 非空：挂在某条筛查记录下（有筛查记录时的默认方式）；
--   · screening_id 为空：挂在用户名下（user_id），新账号首次采集也能进档案。
-- 一条记录可以补多条（保留历史），列表接口只挂最新一条给前端展示。
CREATE TABLE IF NOT EXISTS screening_supplements (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER,
    screening_id    TEXT,
    kind            TEXT NOT NULL,
    text            TEXT,
    filename        TEXT,
    url             TEXT,
    description     TEXT,
    -- 哈希检索引擎分析结果（JSON）：风险等级/结论/命中记录，
    -- 由 supplement 接口保存时同步写入，供首页/检索页/采集页展示。
    analysis        TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_screening_supplements_sid ON screening_supplements(screening_id);
-- 注意：user_id 是后加的列（旧表通过 init_db_sync 的 ALTER 迁移），
-- 其索引必须在迁移之后创建，不能写进这里（旧表上执行会报 no such column）。

-- ---- Agent 知识图谱（对应 worker/seed/002_agent_knowledge_graph.sql）----
-- 本地早期版本漏建这组表，导致 RAG 报告 / 智能研判流程在
-- agent_graph.ensure_seeded() 处报 "no such table: kg_entities"（2026-10-14 修复）。
-- 建表幂等；种子数据由 app/services/agent_graph.py 的 ensure_seeded() 写入。
CREATE TABLE IF NOT EXISTS kg_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_key TEXT NOT NULL UNIQUE,
    entity_type TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    source TEXT,
    source_version TEXT,
    review_status TEXT DEFAULT 'approved',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_kg_entities_type ON kg_entities(entity_type);

CREATE TABLE IF NOT EXISTS kg_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_key TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object_key TEXT NOT NULL,
    confidence REAL DEFAULT 1.0,
    source TEXT,
    rule_id TEXT,
    review_status TEXT DEFAULT 'approved',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(subject_key, predicate, object_key)
);
CREATE INDEX IF NOT EXISTS ix_kg_relations_subject ON kg_relations(subject_key);
CREATE INDEX IF NOT EXISTS ix_kg_relations_predicate ON kg_relations(predicate);

CREATE TABLE IF NOT EXISTS kg_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    priority INTEGER DEFAULT 0,
    condition_json TEXT NOT NULL,
    action_json TEXT NOT NULL,
    source TEXT,
    review_status TEXT DEFAULT 'approved',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kg_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    screening_id INTEGER,
    relation_id INTEGER,
    evidence_type TEXT NOT NULL,
    evidence_key TEXT,
    evidence_value TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_kg_evidence_screening ON kg_evidence(screening_id);
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
        # CREATE TABLE IF NOT EXISTS 不会为既有 SQLite 表增加列。
        for table in ("screenings", "cases"):
            columns = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
            if "user_id" not in columns:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN user_id INTEGER")
        conn.execute("CREATE INDEX IF NOT EXISTS ix_screenings_user_id ON screenings(user_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS ix_cases_user_id ON cases(user_id)")
        # Agent 知识图谱迁移层（对应 worker/seed/002）：早期本地库缺这两列，
        # 报告/研判流程会连带失败（2026-10-14 修复）
        scr_cols = {row[1] for row in conn.execute("PRAGMA table_info(screenings)")}
        if "case_id" not in scr_cols:
            conn.execute("ALTER TABLE screenings ADD COLUMN case_id INTEGER")
        if "consent_status" not in scr_cols:
            conn.execute("ALTER TABLE screenings ADD COLUMN consent_status TEXT DEFAULT 'unknown'")
        conn.execute("CREATE INDEX IF NOT EXISTS ix_screenings_case_id ON screenings(case_id)")
        # screening_supplements 的早期版本只有 screening_id（NOT NULL）且无 user_id。
        # SQLite 无法用 ALTER 放开 NOT NULL —— 该表是 2026-10-14 新增的、无历史包袱，
        # 直接重建为新结构并搬运数据（新库上 SCHEMA_SQL 建的就是新结构，此分支不触发）。
        sup_cols = {row[1]: row[3] for row in conn.execute("PRAGMA table_info(screening_supplements)")}
        if "user_id" not in sup_cols or sup_cols.get("screening_id") == 1:
            has_uid = "user_id" in sup_cols
            conn.execute("ALTER TABLE screening_supplements RENAME TO screening_supplements_old")
            conn.executescript(
                "CREATE TABLE IF NOT EXISTS screening_supplements ("
                " id INTEGER PRIMARY KEY AUTOINCREMENT,"
                " user_id INTEGER,"
                " screening_id TEXT,"
                " kind TEXT NOT NULL,"
                " text TEXT,"
                " filename TEXT,"
                " url TEXT,"
                " description TEXT,"
                " created_at DATETIME DEFAULT CURRENT_TIMESTAMP);"
                "CREATE INDEX IF NOT EXISTS ix_screening_supplements_sid ON screening_supplements(screening_id);"
            )
            cols = ("id, user_id, screening_id, kind, text, filename, url, description, created_at"
                    if has_uid else
                    "id, screening_id, kind, text, filename, url, description, created_at")
            conn.execute(
                f"INSERT INTO screening_supplements ({cols}) SELECT {cols} FROM screening_supplements_old"
            )
            conn.execute("DROP TABLE screening_supplements_old")
        # 挂记录的历史数据回填归属；user_id 索引在列存在之后再建
        conn.execute(
            "UPDATE screening_supplements SET user_id = ("
            " SELECT s.user_id FROM screenings s WHERE s.screening_id = screening_supplements.screening_id"
            ") WHERE user_id IS NULL AND screening_id IS NOT NULL"
        )
        conn.execute("CREATE INDEX IF NOT EXISTS ix_screening_supplements_uid ON screening_supplements(user_id)")
        # analysis 列（哈希检索分析结果 JSON）：纯新增列，ALTER 即可
        sup_cols2 = {row[1] for row in conn.execute("PRAGMA table_info(screening_supplements)")}
        if "analysis" not in sup_cols2:
            conn.execute("ALTER TABLE screening_supplements ADD COLUMN analysis TEXT")
        # alerts：旧表 screening_id 为 NOT NULL（预警必须挂筛查记录）。
        # 多模态采集的预警允许挂在用户名下（user_id，screening_id 可空），
        # SQLite 无法 ALTER 放开约束 —— 重建搬运（既有预警数据原样保留）。
        alert_cols = {row[1]: row[3] for row in conn.execute("PRAGMA table_info(alerts)")}
        if alert_cols.get("screening_id") == 1 or "user_id" not in alert_cols:
            has_uid = "user_id" in alert_cols
            conn.execute("ALTER TABLE alerts RENAME TO alerts_old")
            conn.executescript(
                "CREATE TABLE alerts ("
                " id INTEGER PRIMARY KEY AUTOINCREMENT,"
                " alert_id TEXT NOT NULL UNIQUE,"
                " screening_id INTEGER,"
                " user_id INTEGER,"
                " name TEXT NOT NULL,"
                " level TEXT DEFAULT 'green',"
                " trigger TEXT,"
                " description TEXT,"
                " status TEXT DEFAULT 'pending',"
                " assignee_id INTEGER,"
                " follow_up_notes TEXT,"
                " resolved_at DATETIME,"
                " created_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
                " updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);"
                "CREATE INDEX IF NOT EXISTS ix_alerts_alert_id ON alerts(alert_id);"
            )
            base = ("id, alert_id, screening_id, user_id, name, level, trigger, description, status, "
                    "assignee_id, follow_up_notes, resolved_at, created_at, updated_at")
            src = base if has_uid else (
                "id, alert_id, screening_id, NULL, name, level, trigger, description, status, "
                "assignee_id, follow_up_notes, resolved_at, created_at, updated_at")
            conn.execute(f"INSERT INTO alerts ({base}) SELECT {src} FROM alerts_old")
            conn.execute("DROP TABLE alerts_old")
        # 归属回填（幂等，每次启动执行）：user_id = 0 是早期搬运填入的字面量（应为 NULL）。
        # 放在重建分支之外 —— 表已重建过时这里仍要把历史数据的归属补齐/纠正。
        conn.execute(
            "UPDATE alerts SET user_id = ("
            " SELECT s.user_id FROM screenings s WHERE s.id = alerts.screening_id"
            ") WHERE (user_id IS NULL OR user_id = 0) AND screening_id IS NOT NULL"
        )
        _seed_demo_accounts(conn)
        conn.commit()


def _seed_demo_accounts(conn: sqlite3.Connection) -> None:
    """确保登录页宣传的两个演示账号存在且凭证正确（幂等，仅本地启动时执行）。

    背景（2026-10-14 用户报告的两个 bug）：
      1. 登录页「演示账号」展示 xiaoyu/123456，但后端没有任何种子账号，
         该用户在库里根本不存在 → 真实后端模式下登录必失败；
      2. 登录页「管理端 · 咨询师」展示 adminer/admin，但 adminer 是用户经
         公开注册接口创建的，注册接口按安全要求（防提权）固定 role='user'，
         于是管理端账号能登录、落地的却是个人端。
    这里在每次本地启动时补齐：不存在则创建；角色或密码与宣传不符则纠正。
    账号清单与 frontend/src/pages/LoginPage.tsx 的 fillDemo 保持一致。
    """
    # 延迟导入：避免模块顶层的循环依赖
    from app.core.security import get_password_hash, verify_password

    demo_accounts = (
        ("adminer", "admin", "admin"),
        ("xiaoyu", "123456", "user"),
    )
    for username, password, role in demo_accounts:
        row = conn.execute(
            "SELECT password_hash, role FROM users WHERE username = ?", (username,)
        ).fetchone()
        if row is None:
            conn.execute(
                "INSERT INTO users (username, password_hash, name, role, is_active) "
                "VALUES (?, ?, ?, ?, 1)",
                (username, get_password_hash(password), username, role),
            )
            continue
        if row["role"] != role:
            conn.execute(
                "UPDATE users SET role = ? WHERE username = ?", (role, username)
            )
        if not verify_password(password, row["password_hash"] or ""):
            conn.execute(
                "UPDATE users SET password_hash = ? WHERE username = ?",
                (get_password_hash(password), username),
            )


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


async def mutate_returning_a(sql: str, params=()):
    """Atomic mutation with RETURNING; local results are committed before return."""
    if runtime.is_worker():
        return await query_one_a(sql, params)
    with _local_lock:
        conn = _get_local_conn()
        try:
            rows = conn.execute(sql, list(_norm_params(params))).fetchall()
            conn.commit()
            return dict(rows[0]) if rows else None
        except Exception:
            conn.rollback()
            raise


async def execute_a(sql: str, params=()) -> int:
    """INSERT/UPDATE/DELETE，返回 last_rowid（INSERT）或 rowcount。"""
    if runtime.is_worker():
        env = runtime.get_worker_env()
        res = await env.DB.prepare(sql).bind(*_norm_params(params)).run()
        meta = res.get("meta", {}) or {}
        return meta.get("last_row_id", 0)
    return execute(sql, params)
