"""执行 scripts/init_kg.cypher 初始化个人 KG 本体（约束与索引）。

用法（在 backend/ 目录下，且已配置好 .env）：
    python scripts/init_kg.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.neo4j import get_driver

CYPHER_FILE = Path(__file__).parent / "init_kg.cypher"


def main() -> None:
    raw = CYPHER_FILE.read_text(encoding="utf-8")
    statements = []
    for chunk in raw.split(";"):
        lines = [ln for ln in chunk.splitlines() if ln.strip() and not ln.strip().startswith("//")]
        if lines:
            statements.append("\n".join(lines))
    driver = get_driver()
    with driver.session() as session:
        for stmt in statements:
            session.run(stmt)
            print(f"[ok] {stmt.splitlines()[0]}")
    print(f"完成，共执行 {len(statements)} 条语句。")


if __name__ == "__main__":
    main()
