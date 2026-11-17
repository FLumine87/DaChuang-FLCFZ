"""Durable per-person evidence, consent, derived state and generation jobs."""
import json
from contextlib import contextmanager

from sqlalchemy import text
from ..db.database import engine

SCHEMA = [
    "CREATE TABLE IF NOT EXISTS steward_imports (user_id TEXT NOT NULL,kind TEXT NOT NULL,PRIMARY KEY(user_id,kind))",
    """CREATE TABLE IF NOT EXISTS steward_accounts (
      user_id TEXT PRIMARY KEY, username TEXT NOT NULL, settings TEXT NOT NULL,
      since TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0,
      snapshot TEXT NOT NULL DEFAULT '{}', fingerprint TEXT NOT NULL DEFAULT '',
      sync_version INTEGER NOT NULL DEFAULT -1, sync_error TEXT NOT NULL DEFAULT '',
      dirty INTEGER NOT NULL DEFAULT 1, lease REAL NOT NULL DEFAULT 0,
      retry_at REAL NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
      epoch INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT '')""",
    """CREATE TABLE IF NOT EXISTS steward_evidence (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,source TEXT NOT NULL,source_key TEXT NOT NULL,
      occurred_at TEXT NOT NULL,body TEXT NOT NULL,payload TEXT NOT NULL,
      UNIQUE(user_id,source,source_key))""",
    "CREATE INDEX IF NOT EXISTS ix_steward_evidence_user ON steward_evidence(user_id,occurred_at)",
    """CREATE TABLE IF NOT EXISTS steward_memories (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,kind TEXT NOT NULL,content TEXT NOT NULL,
      evidence_ids TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
      corrected INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL)""",
    "CREATE INDEX IF NOT EXISTS ix_steward_memory_user ON steward_memories(user_id)",
    """CREATE TABLE IF NOT EXISTS steward_suggestions (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,title TEXT NOT NULL,detail TEXT NOT NULL,
      reason TEXT NOT NULL,evidence_ids TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'suggested',
      plan_id INTEGER,created_at TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS steward_suppressed (
      user_id TEXT NOT NULL,source TEXT NOT NULL,source_key TEXT NOT NULL,
      PRIMARY KEY(user_id,source,source_key))""",
    """CREATE TABLE IF NOT EXISTS steward_chat_runs (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,message TEXT NOT NULL,reply TEXT NOT NULL DEFAULT '',
      history TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,lease REAL NOT NULL DEFAULT 0)""",
]


def init():
    with engine.begin() as c:
        for statement in SCHEMA:
            c.execute(text(statement))


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def load(value, default=None):
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return {} if default is None else default


@contextmanager
def transaction():
    with engine.begin() as c:
        yield c


def execute(c, sql, params=None):
    return c.execute(text(sql), params or {})


def rows(c, sql, params=None):
    return [dict(r) for r in execute(c, sql, params).mappings()]


def one(c, sql, params=None):
    result = rows(c, sql, params)
    return result[0] if result else None


def now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


DEFAULTS = {'enabled': False, 'screening': True, 'chat': False, 'checkin': False, 'feedback': False, 'history': True}


def account(user):
    uid = str(user.get('sub') or '')
    if not uid or user.get('role') != 'user':
        from fastapi import HTTPException
        raise HTTPException(403, '心理管家仅供本人个人账号使用')
    with transaction() as c:
        execute(c, 'INSERT INTO steward_accounts(user_id,username,settings,since) VALUES (:u,:n,:s,:t) ON CONFLICT(user_id) DO NOTHING',
                {'u': uid, 'n': user.get('username', ''), 's': dump(DEFAULTS), 't': now()})
        return one(c, 'SELECT * FROM steward_accounts WHERE user_id=:u', {'u': uid})


def dirty(uid, c=None):
    if c is None:
        with transaction() as conn:
            dirty(uid, conn)
    else:
        execute(c, "UPDATE steward_accounts SET dirty=1,retry_at=0,lease=0,sync_error='',epoch=epoch+1 WHERE user_id=:u", {'u': uid})


def enabled(a, source=None):
    s = load(a['settings'])
    return bool(s.get('enabled') and (source is None or s.get(source)))
