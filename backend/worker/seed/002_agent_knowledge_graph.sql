-- Agent + knowledge graph migration for an EXISTING Cloudflare D1 database.
-- Review and run manually with a Cloudflare account that owns the target D1.
-- Do not apply this file to a database that was freshly created from schema.sql
-- after the schema has already been updated with these same columns.

ALTER TABLE screenings ADD COLUMN case_id INTEGER;
ALTER TABLE screenings ADD COLUMN consent_status TEXT DEFAULT 'unknown';
CREATE INDEX IF NOT EXISTS ix_screenings_case_id ON screenings(case_id);

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

-- kg_evidence keeps a trace of evidence already confirmed by an authorized
-- reviewer. The MVP does not write screening text into it.
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
