-- Station-only review requests and per-account notifications. Apply before Worker rollout.

CREATE TABLE IF NOT EXISTS review_requests (
        id TEXT PRIMARY KEY, source_task_id TEXT UNIQUE NOT NULL, case_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL, title TEXT NOT NULL, instructions TEXT NOT NULL,
        questionnaire TEXT NOT NULL, due_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'sent',
        created_by INTEGER NOT NULL, screening_id TEXT, review_notes TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        acknowledged_at TEXT, submitted_at TEXT, reviewed_at TEXT, reviewed_by INTEGER);

CREATE TABLE IF NOT EXISTS review_notifications (
        id TEXT PRIMARY KEY, recipient_id INTEGER NOT NULL, request_id TEXT NOT NULL,
        event_key TEXT NOT NULL, message TEXT NOT NULL, read_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(recipient_id,event_key));

CREATE INDEX IF NOT EXISTS ix_review_requests_user ON review_requests(user_id,created_at);

CREATE INDEX IF NOT EXISTS ix_review_notifications_user ON review_notifications(recipient_id,read_at);
