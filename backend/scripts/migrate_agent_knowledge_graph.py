"""本地 SQLite 的 Agent + 知识图谱迁移。

执行：在 backend 目录运行
    python scripts/migrate_agent_knowledge_graph.py

脚本只新增列、表和索引，已存在时会跳过；不会删除、修改已有筛查记录。
Cloudflare D1 请使用 worker/seed/002_agent_knowledge_graph.sql。
"""
import os
import sqlite3


KG_SQL = """
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


def main() -> None:
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    db_path = os.path.join(backend_dir, "data", "dev.db")
    if not os.path.exists(db_path):
        raise SystemExit(f"未找到本地数据库：{db_path}")
    conn = sqlite3.connect(db_path)
    try:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(screenings)")}
        if "case_id" not in columns:
            conn.execute("ALTER TABLE screenings ADD COLUMN case_id INTEGER")
        if "consent_status" not in columns:
            conn.execute(
                "ALTER TABLE screenings ADD COLUMN consent_status TEXT DEFAULT 'unknown'"
            )
        conn.execute("CREATE INDEX IF NOT EXISTS ix_screenings_case_id ON screenings(case_id)")
        conn.executescript(KG_SQL)
        conn.commit()
        print("Agent + 知识图谱本地迁移完成。")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
