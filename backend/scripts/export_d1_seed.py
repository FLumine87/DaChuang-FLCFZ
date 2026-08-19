"""
将本地 SQLite 主库（data/dev.db）全量导出为 D1 可执行的 INSERT SQL。

用法（在 backend/ 目录下）：
    python scripts/export_d1_seed.py [--db 本地数据库路径] [--output 输出SQL路径]

默认读取 settings.DATABASE_URL 指向的本地库（data/dev.db），输出到
worker/seed/d1_seed.sql；随后执行：
    npx wrangler d1 execute mental-screening-db --remote --file=./worker/seed/d1_seed.sql

说明：
  - 表结构应与 worker/seed/schema.sql 一致，本脚本仅导出数据（全量 INSERT）；
  - datetime 字段输出为 ISO 字符串（D1/SQLite 均可识别）；
  - 密码哈希由 init_data.py 以 pbkdf2_sha256 生成，Worker 下可直接验证登录。
"""
import argparse
import os
import sqlite3
from datetime import datetime, date

# 导出顺序与表定义一致（含外键引用关系）
TABLES = [
    "users",
    "questionnaires",
    "screenings",
    "alert_rules",
    "alerts",
    "case_tag_master",
    "cases",
    "case_tags_association",
    "case_timeline",
    "media_files",
]


def _sql_value(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (datetime, date)):
        return f"'{v.isoformat()}'"
    s = str(v).replace("'", "''")
    return f"'{s}'"


def export(db_path: str, output: str) -> None:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    lines = [
        "-- ============================================================",
        "-- 心理筛查预警系统 - D1 种子数据（由本地 SQLite 导出）",
        f"-- 来源: {db_path}",
        "-- 执行: npx wrangler d1 execute <db> --remote --file=./worker/seed/d1_seed.sql",
        "-- ============================================================",
    ]
    total = 0
    try:
        for table in TABLES:
            rows = conn.execute(f'SELECT * FROM "{table}"').fetchall()
            if not rows:
                continue
            # PRAGMA table_info 返回行：cid, name, type, notnull, dflt_value, pk
            cols = [d["name"] for d in conn.execute(f'PRAGMA table_info("{table}")').fetchall()]
            col_list = ", ".join(f'"{c}"' for c in cols)
            for row in rows:
                vals = ", ".join(_sql_value(row[c]) for c in cols)
                lines.append(f'INSERT INTO "{table}" ({col_list}) VALUES ({vals});')
                total += 1
        os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
        with open(output, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        print(f"已导出 {total} 条记录 → {output}")
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="导出本地 SQLite 为 D1 INSERT SQL")
    parser.add_argument("--db", default=None, help="本地 SQLite 数据库路径（默认取配置）")
    parser.add_argument("--output", default=os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "worker", "seed", "d1_seed.sql",
    ), help="输出 SQL 文件路径")
    args = parser.parse_args()

    db_path = args.db
    if db_path is None:
        import sys
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from app.config import settings  # noqa: E402
        db_path = settings.DATABASE_URL.replace("sqlite:///", "", 1)

    if not os.path.exists(db_path):
        print(f"本地数据库不存在: {db_path}（请先运行 init_data.py 生成种子数据）")
        return
    export(db_path, args.output)


if __name__ == "__main__":
    main()
