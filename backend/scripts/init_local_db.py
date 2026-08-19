"""本地数据库初始化（标准库 sqlite3，替代旧 init_data.py）。

用法（在 backend/ 目录下）：
    python scripts/init_local_db.py

逻辑：若本地主库（data/dev.db）尚无 users 表：
  1. 执行建表 SQL（与 Cloudflare D1 的 worker/seed/schema.sql 一致，见 app/db/database.py）；
  2. 导入已导出的种子数据（worker/seed/d1_seed.sql，含 admin/admin123 等）。
已有数据则跳过（幂等）。
"""
import os
import sqlite3
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _db_path() -> str:
    sys.path.insert(0, BASE_DIR)
    from app.config import settings  # noqa: E402
    return settings.DATABASE_URL.replace("sqlite:///", "", 1)


def main() -> None:
    db_path = _db_path()
    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
    conn = sqlite3.connect(db_path)

    has_users = conn.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='users'"
    ).fetchone()[0] > 0
    if has_users:
        users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if users > 0:
            print(f"数据库已有数据（{users} 个用户），跳过初始化。")
            conn.close()
            return

    # 建表（与 D1 schema 保持一致）
    sys.path.insert(0, BASE_DIR)
    from app.db.database import SCHEMA_SQL  # noqa: E402
    conn.executescript(SCHEMA_SQL)
    conn.commit()

    # 导入种子数据（d1_seed.sql 由 scripts/export_d1_seed.py 生成；缺失则仅建表）
    seed_sql = os.path.join(BASE_DIR, "worker", "seed", "d1_seed.sql")
    if os.path.exists(seed_sql):
        with open(seed_sql, "r", encoding="utf-8") as f:
            conn.executescript(f.read())
        conn.commit()
        print(f"已导入种子数据 → {db_path}")
    else:
        print(f"未找到种子数据 {seed_sql}，仅完成建表。")
    conn.close()


if __name__ == "__main__":
    main()
