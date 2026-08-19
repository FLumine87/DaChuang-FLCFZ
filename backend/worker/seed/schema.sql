-- ============================================================
-- 心理筛查预警系统 - Cloudflare D1 建表 SQL
-- 由 backend/alembic/versions/001_init.py 转译（SQLAlchemy → 纯 SQLite DDL）
-- 执行方式（在 backend/ 目录）：
--   npx wrangler d1 execute mental-screening-db --remote --file=./worker/seed/schema.sql
-- ============================================================

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
CREATE INDEX IF NOT EXISTS ix_users_id ON users(id);
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
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (questionnaire_id) REFERENCES questionnaires(id),
    FOREIGN KEY (counselor_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS ix_screenings_id ON screenings(id);
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
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (questionnaire_id) REFERENCES questionnaires(id)
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
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (screening_id) REFERENCES screenings(id),
    FOREIGN KEY (assignee_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS ix_alerts_id ON alerts(id);
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
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (counselor_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS ix_cases_id ON cases(id);
CREATE INDEX IF NOT EXISTS ix_cases_case_id ON cases(case_id);

CREATE TABLE IF NOT EXISTS case_tags_association (
    case_id INTEGER NOT NULL,
    tag_id  INTEGER NOT NULL,
    PRIMARY KEY (case_id, tag_id),
    FOREIGN KEY (case_id) REFERENCES cases(id),
    FOREIGN KEY (tag_id) REFERENCES case_tag_master(id)
);

CREATE TABLE IF NOT EXISTS case_timeline (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id     INTEGER NOT NULL,
    event_type  TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    event_date  DATETIME,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (case_id) REFERENCES cases(id)
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
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (screening_id) REFERENCES screenings(id),
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS ix_media_files_id ON media_files(id);
CREATE INDEX IF NOT EXISTS ix_media_files_file_id ON media_files(file_id);
