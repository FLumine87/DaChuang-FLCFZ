#!/usr/bin/env python3
"""把仓库里的 D1 结构升级应用到**已经存在**的 Cloudflare D1 数据库。

为什么需要这个脚本
------------------
Worker 代码一直在往前走，但线上 D1 是在 2026-08 用当时的 schema.sql 建的。
后续 002/003/004/005/006 这几个 seed 文件是给"已经部署过的库"手写的迁移，
一直没人执行；结果线上表现为：

  · 登录能成功（users 表没问题）；
  · 一进首页就 500：
        D1_ERROR: no such column: user_id
        D1_ERROR: no such table: screening_supplements

即"后端是新的、库是旧的"。手动去 Cloudflare 控制台逐条执行既容易漏，也不幂等
（ALTER TABLE ADD COLUMN 重复执行会报错）。所以把迁移做成脚本：

  · 先用 PRAGMA table_info / sqlite_master 看现状，只补缺的列/表；
  · 需要放开 NOT NULL 的表（alerts、screening_supplements）按本地
    app/db/database.py 里 init_db_sync() 的同一套逻辑重建 + 搬运数据；
  · 演示账号（adminer / xiaoyu）按 004 的哈希补齐/纠正；
  · 任何一步失败立即非零退出，CI 不会在库没修好的情况下继续部署。

用法
----
    # 真正执行（CI 用；需要 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID）
    python3 scripts/migrate_d1.py

    # 只看会执行什么，不写库
    python3 scripts/migrate_d1.py --dry-run

    # 本地拿一份旧结构的 sqlite 演练（开发/测试用）
    python3 scripts/migrate_d1.py --sqlite /tmp/old.db

环境变量：
    CLOUDFLARE_API_TOKEN    必需（远程模式）
    CLOUDFLARE_ACCOUNT_ID   必需（远程模式）
    D1_DATABASE_ID          可选，默认读 wrangler.toml 里的 database_id
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

WORKER_DIR = Path(__file__).resolve().parents[1]
WRANGLER_TOML = WORKER_DIR / "wrangler.toml"
D1_API = "https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{db}/query"


class MigrationError(RuntimeError):
    pass


def log(message: str) -> None:
    print(f"[d1-migrate] {message}", flush=True)


# ─── 执行器：远程 D1 REST API / 本地 sqlite，共用同一套迁移逻辑 ──────────────

class SqliteExecutor:
    def __init__(self, path: str) -> None:
        self.conn = sqlite3.connect(path)
        self.conn.row_factory = sqlite3.Row

    def run(self, sql: str, params: tuple = ()) -> list[dict]:
        cur = self.conn.execute(sql, params)
        if sql.lstrip().upper().startswith(("SELECT", "PRAGMA")):
            return [dict(row) for row in cur.fetchall()]
        self.conn.commit()
        return []

    def close(self) -> None:
        self.conn.close()


class D1Executor:
    """Cloudflare D1 HTTP API。

    每个请求只发一条语句：D1 虽然支持多语句，但失败时定位困难；迁移脚本
    需要精确知道是哪一条 DDL 失败，所以这里保持"一条一条来"。
    """

    def __init__(self, account_id: str, token: str, database_id: str) -> None:
        self.url = D1_API.format(account=account_id, db=database_id)
        self.token = token

    def run(self, sql: str, params: tuple = ()) -> list[dict]:
        body = json.dumps({"sql": sql, "params": list(params)}).encode("utf-8")
        payload: dict = {}
        for attempt in range(4):
            request = urllib.request.Request(
                self.url,
                data=body,
                method="POST",
                headers={
                    "Authorization": f"Bearer {self.token}",
                    "Content-Type": "application/json",
                },
            )
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    payload = json.loads(response.read().decode("utf-8") or "{}")
                break
            except urllib.error.HTTPError as error:
                raw = error.read().decode("utf-8", "replace")
                try:
                    payload = json.loads(raw or "{}")
                except json.JSONDecodeError:
                    payload = {"success": False, "errors": [{"message": raw[:500]}]}
                if error.code in (429, 500, 502, 503, 504) and attempt < 3:
                    time.sleep(2 * (attempt + 1))
                    continue
                break
            except (urllib.error.URLError, TimeoutError) as error:
                if attempt < 3:
                    time.sleep(2 * (attempt + 1))
                    continue
                raise MigrationError(f"请求 D1 失败：{error}") from error

        if not payload.get("success"):
            detail = payload.get("errors") or payload.get("messages") or payload
            raise MigrationError(f"D1 返回失败：{detail}")
        result = payload.get("result") or []
        if not result:
            return []
        first = result[0]
        if not first.get("success", True):
            raise MigrationError(f"D1 语句失败：{first}")
        return first.get("results") or []


# ─── 迁移逻辑 ────────────────────────────────────────────────────────────────

CREATE_SCREENING_SUPPLEMENTS = """CREATE TABLE IF NOT EXISTS screening_supplements (
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
)"""

CREATE_ALERTS = """CREATE TABLE IF NOT EXISTS alerts (
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
)"""

CREATE_ALERT_EVENTS = """CREATE TABLE IF NOT EXISTS alert_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_id    INTEGER NOT NULL,
    actor_id    INTEGER NOT NULL,
    from_status TEXT,
    to_status   TEXT NOT NULL,
    note        TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
)"""

KG_DDL = [
    """CREATE TABLE IF NOT EXISTS kg_entities (
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
    )""",
    "CREATE INDEX IF NOT EXISTS ix_kg_entities_type ON kg_entities(entity_type)",
    """CREATE TABLE IF NOT EXISTS kg_relations (
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
    )""",
    "CREATE INDEX IF NOT EXISTS ix_kg_relations_subject ON kg_relations(subject_key)",
    "CREATE INDEX IF NOT EXISTS ix_kg_relations_predicate ON kg_relations(predicate)",
    """CREATE TABLE IF NOT EXISTS kg_rules (
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
    )""",
    """CREATE TABLE IF NOT EXISTS kg_evidence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        screening_id INTEGER,
        relation_id INTEGER,
        evidence_type TEXT NOT NULL,
        evidence_key TEXT,
        evidence_value TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )""",
    "CREATE INDEX IF NOT EXISTS ix_kg_evidence_screening ON kg_evidence(screening_id)",
]

# 004_demo_accounts.sql 里的哈希（pbkdf2-sha256，29000 轮）。
# 账号与 frontend/src/pages/LoginPage.tsx 的 fillDemo 保持一致。
DEMO_ACCOUNTS = [
    (
        "adminer",
        "admin",
        "admin",
        "$pbkdf2-sha256$29000$G6_yOX0q-MTlAyCpXL2G7Q$T-C-PyZrV5kOWxQuBdyBh41VUE4otZJU0x2642jXSME",
    ),
    (
        "xiaoyu",
        "123456",
        "user",
        "$pbkdf2-sha256$29000$BCVzFTpGs1NgiGO6DMZriw$chZRO9aooJzqOCo_7dvouKLduPTeaUZ7pa5RiJhbpd0",
    ),
]


class Migrator:
    def __init__(self, executor, dry_run: bool = False) -> None:
        self.ex = executor
        self.dry_run = dry_run
        self.actions: list[str] = []

    # —— 基础工具 ——

    def query(self, sql: str, params: tuple = ()) -> list[dict]:
        return self.ex.run(sql, params)

    def execute(self, sql: str, params: tuple = (), note: str | None = None) -> None:
        if note:
            self.actions.append(note)
            log(("DRY-RUN " if self.dry_run else "") + note)
        if self.dry_run:
            return
        self.ex.run(sql, params)

    def table_exists(self, table: str) -> bool:
        rows = self.query(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
        )
        return bool(rows)

    def columns(self, table: str) -> dict[str, dict]:
        rows = self.query(f"PRAGMA table_info({table})")
        return {row["name"]: row for row in rows}

    def add_column(self, table: str, column: str, decl: str) -> None:
        if column in self.columns(table):
            return
        self.execute(
            f"ALTER TABLE {table} ADD COLUMN {column} {decl}",
            note=f"{table}.{column} 缺失 → 补列",
        )

    def index(self, sql: str) -> None:
        # CREATE INDEX IF NOT EXISTS 本身幂等，不需要额外判断
        self.execute(sql)

    # —— 各表迁移 ——

    def migrate_screenings(self) -> None:
        if not self.table_exists("screenings"):
            raise MigrationError("screenings 表不存在：这不是「旧结构」，请先跑 schema.sql")
        self.add_column("screenings", "user_id", "INTEGER")
        self.add_column("screenings", "case_id", "INTEGER")
        self.add_column("screenings", "consent_status", "TEXT DEFAULT 'unknown'")
        self.index("CREATE INDEX IF NOT EXISTS ix_screenings_user_id ON screenings(user_id)")
        self.index("CREATE INDEX IF NOT EXISTS ix_screenings_case_id ON screenings(case_id)")

    def migrate_cases(self) -> None:
        if not self.table_exists("cases"):
            log("cases 表不存在，跳过（管理端案例功能会不可用）")
            return
        self.add_column("cases", "user_id", "INTEGER")
        self.index("CREATE INDEX IF NOT EXISTS ix_cases_user_id ON cases(user_id)")

    def migrate_kg(self) -> None:
        for ddl in KG_DDL:
            self.execute(ddl, note="确保 Agent 知识图谱表存在" if "TABLE" in ddl else None)

    def migrate_supplements(self) -> None:
        table = "screening_supplements"
        if not self.table_exists(table):
            self.execute(CREATE_SCREENING_SUPPLEMENTS, note=f"{table} 整张表缺失 → 新建")
            self.execute(
                "CREATE INDEX IF NOT EXISTS ix_screening_supplements_sid ON screening_supplements(screening_id)"
            )
            self.execute(
                "CREATE INDEX IF NOT EXISTS ix_screening_supplements_uid ON screening_supplements(user_id)"
            )
            return

        cols = self.columns(table)
        needs_rebuild = "user_id" not in cols or int(cols.get("screening_id", {}).get("notnull", 0)) == 1
        if needs_rebuild:
            if self.table_exists(f"{table}_old"):
                raise MigrationError(
                    f"{table}_old 已存在（上次迁移中断？）。请先人工确认后删除再重跑。"
                )
            self.execute(
                f"ALTER TABLE {table} RENAME TO {table}_old",
                note=f"{table} 结构过旧（缺 user_id 或 screening_id NOT NULL）→ 重建",
            )
            self.execute(CREATE_SCREENING_SUPPLEMENTS, note=f"创建新版 {table}")
            copy_cols = [
                col
                for col in (
                    "id",
                    "user_id",
                    "screening_id",
                    "kind",
                    "text",
                    "filename",
                    "url",
                    "description",
                    "analysis",
                    "created_at",
                )
                if col in cols
            ]
            column_list = ", ".join(copy_cols)
            self.execute(
                f"INSERT INTO {table} ({column_list}) "
                f"SELECT {column_list} FROM {table}_old",
                note=f"搬运 {table} 既有数据（{len(copy_cols)} 列）",
            )
            self.execute(f"DROP TABLE {table}_old", note=f"删除 {table}_old")
        else:
            if "analysis" not in cols:
                self.execute(
                    f"ALTER TABLE {table} ADD COLUMN analysis TEXT",
                    note=f"{table}.analysis 缺失 → 补列",
                )

        # 挂记录的旧数据回填归属
        self.execute(
            "UPDATE screening_supplements SET user_id = ("
            " SELECT s.user_id FROM screenings s WHERE s.screening_id = screening_supplements.screening_id"
            ") WHERE user_id IS NULL AND screening_id IS NOT NULL",
            note="回填 screening_supplements.user_id",
        )
        self.execute(
            "CREATE INDEX IF NOT EXISTS ix_screening_supplements_sid ON screening_supplements(screening_id)"
        )
        self.execute(
            "CREATE INDEX IF NOT EXISTS ix_screening_supplements_uid ON screening_supplements(user_id)"
        )

    def _rebuild_alert_events(self, backup: str) -> None:
        """重建 alert_events 并从 backup 搬回数据（表可能为空/不存在）。"""
        if not self.table_exists(backup):
            self.execute(CREATE_ALERT_EVENTS, note="创建 alert_events")
            return
        backup_cols = self.columns(backup)
        self.execute(CREATE_ALERT_EVENTS, note="创建新版 alert_events")
        target_cols = self.columns("alert_events")
        shared = [c for c in target_cols if c in backup_cols]
        if shared:
            column_list = ", ".join(shared)
            self.execute(
                f"INSERT INTO alert_events ({column_list}) "
                f"SELECT {column_list} FROM {backup}",
                note=f"搬回 alert_events 历史数据（{len(shared)} 列）",
            )
        self.execute(f"DROP TABLE {backup}", note="删除 alert_events 备份表")

    def migrate_alerts(self) -> None:
        if not self.table_exists("alerts"):
            self.execute(CREATE_ALERTS, note="alerts 整张表缺失 → 新建")
            self.execute(
                "CREATE INDEX IF NOT EXISTS ix_alerts_alert_id ON alerts(alert_id)"
            )
            return

        cols = self.columns("alerts")
        needs_rebuild = "user_id" not in cols or int(cols.get("screening_id", {}).get("notnull", 0)) == 1
        if needs_rebuild:
            if self.table_exists("alerts_old"):
                raise MigrationError("alerts_old 已存在（上次迁移中断？）。请先人工确认后删除再重跑。")
            # alert_events 是 alerts 的子表：先备份成普通表再拆，避免外键/数据丢失
            events_backup = "_alert_events_backup"
            has_events = self.table_exists("alert_events")
            if has_events:
                if self.table_exists(events_backup):
                    self.execute(f"DROP TABLE {events_backup}", note="清理残留的 alert_events 备份表")
                self.execute(
                    f"CREATE TABLE {events_backup} AS SELECT * FROM alert_events",
                    note="备份 alert_events",
                )
                self.execute("DROP TABLE alert_events", note="临时删除 alert_events（重建父表）")

            self.execute(
                "ALTER TABLE alerts RENAME TO alerts_old",
                note="alerts 结构过旧（缺 user_id 或 screening_id NOT NULL）→ 重建",
            )
            self.execute(CREATE_ALERTS, note="创建新版 alerts")

            fallbacks = {
                "id": "id",
                "alert_id": "alert_id",
                "screening_id": "NULL",
                "user_id": "NULL",
                "name": "'未知'",
                "level": "'green'",
                "trigger": "NULL",
                "description": "NULL",
                "status": "'pending'",
                "assignee_id": "NULL",
                "follow_up_notes": "NULL",
                "resolved_at": "NULL",
                "created_at": "CURRENT_TIMESTAMP",
                "updated_at": "CURRENT_TIMESTAMP",
            }
            target_cols = list(fallbacks)
            select_exprs = [
                fallbacks[col] if col not in cols else col for col in target_cols
            ]
            self.execute(
                f"INSERT INTO alerts ({', '.join(target_cols)}) "
                f"SELECT {', '.join(select_exprs)} FROM alerts_old",
                note="搬运 alerts 既有数据",
            )
            self.execute("DROP TABLE alerts_old", note="删除 alerts_old")
            self.execute(
                "CREATE INDEX IF NOT EXISTS ix_alerts_alert_id ON alerts(alert_id)"
            )
            self._rebuild_alert_events(events_backup)
        else:
            self.execute(
                "CREATE INDEX IF NOT EXISTS ix_alerts_alert_id ON alerts(alert_id)"
            )

        # 历史预警的归属回填：user_id = 对应筛查记录的 user_id
        self.execute(
            "UPDATE alerts SET user_id = ("
            " SELECT s.user_id FROM screenings s WHERE s.id = alerts.screening_id"
            ") WHERE (user_id IS NULL OR user_id = 0) AND screening_id IS NOT NULL",
            note="回填 alerts.user_id",
        )

    def migrate_alert_events(self) -> None:
        if self.table_exists("alert_events"):
            self.execute(
                "CREATE INDEX IF NOT EXISTS ix_alert_events_alert_id ON alert_events(alert_id)"
            )
            return
        self.execute(CREATE_ALERT_EVENTS, note="alert_events 缺失 → 新建（归属变更历史）")
        self.execute(
            "CREATE INDEX IF NOT EXISTS ix_alert_events_alert_id ON alert_events(alert_id)"
        )

    def seed_demo_accounts(self) -> None:
        for username, password, role, password_hash in DEMO_ACCOUNTS:
            self.execute(
                "INSERT INTO users (username, password_hash, name, role, is_active) "
                "SELECT ?, ?, ?, ?, 1 WHERE NOT EXISTS "
                "(SELECT 1 FROM users WHERE username = ?)",
                (username, password_hash, username, role, username),
                note=f"确保演示账号 {username} 存在",
            )
            self.execute(
                "UPDATE users SET role = ?, password_hash = ? WHERE username = ?",
                (role, password_hash, username),
                note=f"纠正演示账号 {username} 的角色/密码",
            )

    def verify(self) -> None:
        problems = []
        scr = self.columns("screenings")
        for col in ("user_id", "case_id", "consent_status"):
            if col not in scr:
                problems.append(f"screenings.{col} 仍缺失")
        if self.table_exists("screening_supplements"):
            sup = self.columns("screening_supplements")
            for col in ("user_id", "analysis"):
                if col not in sup:
                    problems.append(f"screening_supplements.{col} 仍缺失")
        else:
            problems.append("screening_supplements 仍不存在")
        if self.table_exists("alerts"):
            if "user_id" not in self.columns("alerts"):
                problems.append("alerts.user_id 仍缺失")
        else:
            problems.append("alerts 不存在")
        if not self.table_exists("alert_events"):
            problems.append("alert_events 不存在")
        if problems:
            raise MigrationError("迁移后校验失败：" + "；".join(problems))

    def run(self) -> None:
        log("开始检查 D1 结构…")
        self.migrate_screenings()
        self.migrate_cases()
        self.migrate_kg()
        self.migrate_supplements()
        self.migrate_alerts()
        self.migrate_alert_events()
        self.seed_demo_accounts()
        if self.dry_run:
            log(f"dry-run 完成：计划执行 {len(self.actions)} 处变更")
            return
        self.verify()
        log(f"迁移完成：共执行 {len(self.actions)} 处变更，校验通过")


def read_database_id() -> str:
    if os.environ.get("D1_DATABASE_ID"):
        return os.environ["D1_DATABASE_ID"]
    try:
        text = WRANGLER_TOML.read_text(encoding="utf-8")
    except OSError as error:
        raise MigrationError(f"读不到 {WRANGLER_TOML}：{error}") from error
    match = re.search(r'database_id\s*=\s*"([^"]+)"', text)
    if not match:
        raise MigrationError("wrangler.toml 里没有 database_id，请设置 D1_DATABASE_ID")
    return match.group(1)


def main() -> int:
    parser = argparse.ArgumentParser(description="幂等升级 Cloudflare D1 结构")
    parser.add_argument("--sqlite", help="对本地 sqlite 文件演练（不访问 Cloudflare）")
    parser.add_argument("--dry-run", action="store_true", help="只打印计划，不写库")
    parser.add_argument("--database-id", help="覆盖 wrangler.toml 里的 database_id")
    args = parser.parse_args()

    try:
        if args.sqlite:
            executor = SqliteExecutor(args.sqlite)
        else:
            account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
            token = os.environ.get("CLOUDFLARE_API_TOKEN")
            if not account_id or not token:
                raise MigrationError(
                    "缺少 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN；"
                    "本地演练请用 --sqlite <path>"
                )
            executor = D1Executor(account_id, token, args.database_id or read_database_id())

        Migrator(executor, dry_run=args.dry_run).run()
        return 0
    except MigrationError as error:
        log(f"失败：{error}")
        return 1
    finally:
        close = getattr(locals().get("executor"), "close", None)
        if callable(close):
            close()


if __name__ == "__main__":
    sys.exit(main())
