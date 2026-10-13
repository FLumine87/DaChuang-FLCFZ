"""导入迷你领域心理 KG 种子数据（幂等，可重复执行）。

用法（在 backend/ 目录下）：
    python scripts/seed_domain_kg.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.neo4j import get_driver

CYPHER_FILE = Path(__file__).parent / "seed_domain_kg.cypher"


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
    print(f"完成，共执行 {len(statements)} 条语句（Disorder/Symptom/Trigger/Coping + 关系）。")


if __name__ == "__main__":
    main()
