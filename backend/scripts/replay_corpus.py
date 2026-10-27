"""按时间步回放检索语料，模拟数据流的持续到达。

用途有两个：
1. 答辩演示：一步步推进时间，看索引规模、表权重、检索结果如何变化；
2. 评测：`eval_dynamic.py` 用它构造 21 个时间步的增量实验。

回放器与真实写入走同一个 `engine.index_case_sync` 通道，区别只在于数据来源
是离线语料而不是线上用户。这样演示口径和实际运行口径一致。
"""
import argparse
import datetime
import json
import os
import random
import sqlite3
import sys
from typing import Dict, List

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from app.config import settings  # noqa: E402


def load_corpus_records(path: str = "") -> List[Dict]:
    """读取语料库，按记录聚合成可回放的批次单元。

    返回 [{record_id, window, date, themes, label, units: [{unit_id, modality,
    content, media_path, media_kind, feature, meta, dataset}]}]
    """
    path = path or settings.HASHING_CORPUS_DB
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        rows = [dict(r) for r in conn.execute("SELECT * FROM units")]
        recs = {r["record_id"]: dict(r) for r in conn.execute("SELECT * FROM records")}
    finally:
        conn.close()
    grouped: Dict[str, Dict] = {}
    for u in rows:
        rec = grouped.setdefault(u["record_id"], {
            "record_id": u["record_id"],
            "themes": json.loads((recs.get(u["record_id"]) or {}).get("themes") or "[]"),
            "label": (recs.get(u["record_id"]) or {}).get("label") or "",
            "units": [],
        })
        rec["units"].append({
            "unit_id": u["unit_id"],
            "modality": u.get("modality") or "text",
            "content": u.get("content") or "",
            "media_path": u.get("media_path"),
            "media_kind": u.get("media_kind"),
            "feature": json.loads(u["feature"]) if u.get("feature") else None,
            "meta": json.loads(u["meta"]) if u.get("meta") else None,
            "dataset": u.get("dataset"),
            "alert_level": u.get("alert_level") or "green",
        })
    return list(grouped.values())


def split_batches(records: List[Dict], n_steps: int, seed: int = 42) -> List[List[Dict]]:
    """把记录切成 n_steps 批，每批内部保持记录完整（三个模态视图不拆开）。"""
    rng = random.Random(seed)
    pool = list(records)
    rng.shuffle(pool)
    n_steps = max(1, int(n_steps))
    size = max(1, len(pool) // n_steps)
    batches = [pool[i * size:(i + 1) * size] for i in range(n_steps)]
    # 余数并入最后一批，保证不丢数据
    rest = pool[size * n_steps:]
    if rest:
        batches[-1].extend(rest)
    return batches


def step_date(step: int, epoch: str = "", window_days: int = 0) -> str:
    """第 step 个时间步对应的时间窗起点日期。"""
    epoch_d = datetime.date.fromisoformat(epoch or str(getattr(settings, "HASHING_EPOCH", "2025-01-01")))
    days = int(window_days or getattr(settings, "HASHING_WINDOW_DAYS", 30))
    return (epoch_d + datetime.timedelta(days=step * days)).isoformat()


def inject_batch(engine, batch: List[Dict], step: int, scope: str = "public",
                 enqueue: bool = True) -> int:
    """把一个批次写入索引（与线上写入同一条通道）。

    scope=public 表示这批数据已通过审核，直接进公共池与训练池；
    若要模拟"待审数据"，传 scope=reviewing。

    写入按批聚合后一次落盘：逐条 commit 会让回放 5000 个单元耗时数分钟。
    """
    date = step_date(step)
    new_units: Dict[str, Dict] = {}
    n = 0
    for rec in batch:
        for u in rec["units"]:
            engine._add_unit(u["unit_id"], {
                "record_id": rec["record_id"],
                "modality": u["modality"],
                "tags": rec["themes"],
                "alert_level": u.get("alert_level") or "green",
                "date": date,
                "scope": scope,
                "source": "corpus",
                "content": u["content"],
                "media_path": u.get("media_path"),
                "media_kind": u.get("media_kind"),
                "feature": u.get("feature"),
                "media_meta": u.get("meta"),
                "dataset": u.get("dataset"),
            })
            new_units[u["unit_id"]] = engine.units[u["unit_id"]]
            n += 1
        if enqueue and scope == "public":
            engine._store.enqueue(rec["record_id"],
                                  (engine.records.get(rec["record_id"]) or {}).get("window"))
    if new_units:
        engine._store.upsert_units(new_units)
        engine._store.upsert_records({
            rid: engine.records[rid] for rid in
            {m.get("record_id") for m in new_units.values()} if rid in engine.records
        })
        engine._scope_epoch += 1
    return n


def main():
    ap = argparse.ArgumentParser(description="按时间步回放检索语料")
    ap.add_argument("--steps", type=int, default=6, help="时间步数量")
    ap.add_argument("--per-step", type=int, default=0, help="每步最多注入多少条记录，0 表示全量")
    ap.add_argument("--dry-run", action="store_true", help="只打印分批结果，不写入索引")
    args = ap.parse_args()

    from app.engines import get_hashing_engine
    records = load_corpus_records()
    batches = split_batches(records, args.steps)
    print(f"语料 {len(records)} 条记录，切成 {len(batches)} 批")
    for i, b in enumerate(batches):
        print(f"  第 {i} 步 {step_date(i)}：{len(b)} 条")
    if args.dry_run:
        return

    engine = get_hashing_engine()
    engine._do_initialize()
    for i, b in enumerate(batches):
        pick = b[: args.per_step] if args.per_step else b
        n = inject_batch(engine, pick, i)
        r = engine.retrain_pending()
        print(f"第 {i} 步注入 {n} 个单元，重训窗口 {[x['window'] for x in r['retrained']]}")


if __name__ == "__main__":
    main()
