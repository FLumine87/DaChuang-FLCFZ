-- 006_alerts_user_and_analysis.sql
-- 配套「多模态采集 → 哈希检索分析 → 报告与预警挂载」功能（2026-10-14）：
--   1. alerts 允许挂在用户名下：screening_id 放开 NOT NULL + 新增 user_id
--      （多模态采集的预警不再强制依赖筛查记录，新账号首次采集也能产生预警）
--   2. screening_supplements 新增 analysis 列：哈希检索引擎的分析报告 JSON
--      （风险等级 / 结论 / 命中记录），由 supplement 接口保存时同步写入
--
-- 本地 sqlite 由 app/db/database.py 的 init_db_sync 自动迁移（含 alerts 表重建）；
-- 本文件供已部署的 D1 手动执行一次（wrangler d1 execute）。
-- 注：D1 不支持 ALTER 放开 NOT NULL，alerts 需要重建表。

-- ---- screening_supplements: 新增 analysis 列 ----
ALTER TABLE screening_supplements ADD COLUMN analysis TEXT;

-- ---- alerts: 重建为 screening_id 可空 + user_id ----
-- 若表中已有数据，下面这段会原样搬运；user_id 由筛查记录归属回填。
CREATE TABLE alerts_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_id        TEXT NOT NULL UNIQUE,
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
INSERT INTO alerts_new (id, alert_id, screening_id, user_id, name, level, trigger, description,
                        status, assignee_id, follow_up_notes, resolved_at, created_at, updated_at)
SELECT a.id, a.alert_id, a.screening_id, s.user_id, a.name, a.level, a.trigger, a.description,
       a.status, a.assignee_id, a.follow_up_notes, a.resolved_at, a.created_at, a.updated_at
FROM alerts a LEFT JOIN screenings s ON a.screening_id = s.id;
DROP TABLE alerts;
ALTER TABLE alerts_new RENAME TO alerts;
CREATE INDEX IF NOT EXISTS ix_alerts_alert_id ON alerts(alert_id);
