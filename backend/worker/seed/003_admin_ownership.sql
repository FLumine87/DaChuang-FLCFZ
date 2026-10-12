-- Existing D1 databases: apply once before deploying the admin API changes.
-- Do not infer owners for legacy records from names; leave user_id NULL.
ALTER TABLE screenings ADD COLUMN user_id INTEGER;
ALTER TABLE cases ADD COLUMN user_id INTEGER;
CREATE INDEX IF NOT EXISTS ix_screenings_user_id ON screenings(user_id);
CREATE INDEX IF NOT EXISTS ix_cases_user_id ON cases(user_id);
CREATE TABLE IF NOT EXISTS alert_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_id INTEGER NOT NULL,
    actor_id INTEGER NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_alert_events_alert_id ON alert_events(alert_id);
