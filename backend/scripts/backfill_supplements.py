"""把历史采集数据补录进哈希索引。

在 `_index_supplement` 上线之前，采集内容只落业务表、没有写索引，
审核页看不到这些数据。本脚本按主库记录补录，字段与线上写入保持一致。

可重复执行：索引里已存在的 sup-* 单元会跳过。
"""
import os
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from app.db import database as db  # noqa: E402
from app.engines import get_hashing_engine  # noqa: E402

_KIND_LABEL = {"text": "文本", "audio": "语音", "image": "图像"}


def main():
    engine = get_hashing_engine()
    engine._do_initialize()
    rows = db.query("SELECT * FROM screening_supplements ORDER BY id")
    added = skipped = 0
    for r in rows:
        rid = f"sup-{r['id']}"
        if rid in engine.units:
            skipped += 1
            continue
        kind = r["kind"] or "text"
        text = (r["text"] or "").strip()
        summary = text or f"{_KIND_LABEL.get(kind, kind)}采集 {r['filename'] or ''} {r['description'] or ''}".strip()
        if not summary:
            skipped += 1
            continue
        engine.index_case_sync({
            "id": rid,
            "record_id": rid,
            "user_id": r.get("user_id"),
            "modality": kind,
            "summary": summary,
            "date": str(r.get("created_at") or "")[:10] or None,
            "scope": "reviewing",
            "source": "runtime",
        })
        added += 1
    print(f"补录 {added} 条，跳过 {skipped} 条，索引单元 {len(engine.units)}")
    print("当前 scope 分布:", engine.scope_distribution())


if __name__ == "__main__":
    main()
