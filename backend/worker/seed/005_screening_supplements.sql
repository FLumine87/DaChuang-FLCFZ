-- 005_screening_supplements.sql
-- 「多模态采集」页在筛查记录上的自愿补充（文本日记 / 语音片段 / 图片）。
-- 配套接口：POST /api/personal/screenings/{screening_id}/supplement
--（2026-10-14 修复：此前采集上传链路在真实模式下不可用——/api/upload 固定 503、
--  本接口缺失；本地已完整实现，本文件供已部署的 D1 手动执行一次）。
-- 与 schema.sql / app/db/database.py 的 SCHEMA_SQL 保持同步。

CREATE TABLE IF NOT EXISTS screening_supplements (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER,
    screening_id    TEXT,
    kind            TEXT NOT NULL,
    text            TEXT,
    filename        TEXT,
    url             TEXT,
    description     TEXT,
    analysis        TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_screening_supplements_sid ON screening_supplements(screening_id);
CREATE INDEX IF NOT EXISTS ix_screening_supplements_uid ON screening_supplements(user_id);
