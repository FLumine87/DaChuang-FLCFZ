"""把媒体特征回填到索引库。

索引库新增 feature 列之前入库的单元没有特征，每次重训都要重新解码图像/语音，
5000 个单元的重编码要几分钟。回填后重训只需读库，时间降到十几秒。

一次性脚本，可重复执行（已有特征的单元会跳过）。
"""
import argparse
import os
import sys
import time

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from app.engines import get_hashing_engine  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description="回填媒体特征")
    ap.add_argument("--limit", type=int, default=0, help="最多处理多少条，0 表示全部")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    engine = get_hashing_engine()
    engine._do_initialize()

    targets = [(uid, meta) for uid, meta in engine.units.items()
               if meta.get("modality") in ("image", "audio") and not meta.get("feature")]
    if args.limit:
        targets = targets[: args.limit]
    print(f"待回填 {len(targets)} 个媒体单元")
    if args.dry_run or not targets:
        return

    changed = {}
    missing = 0
    t0 = time.time()
    for i, (uid, meta) in enumerate(targets, 1):
        mod = meta["modality"]
        try:
            feat = engine._feature_of(mod, meta.get("content") or "", meta.get("media_path"))
            vec = feat.get(mod)
        except Exception:
            vec = None
        if not vec:
            missing += 1
            continue
        meta["feature"] = list(vec)
        changed[uid] = meta
        if i % 200 == 0:
            print(f"  {i}/{len(targets)}  {time.time() - t0:.0f}s", flush=True)

    if changed:
        engine._store.upsert_units(changed)
    print(f"完成：回填 {len(changed)}，失败 {missing}，耗时 {time.time() - t0:.1f}s")
    print(f"索引库 {os.path.getsize(engine.index_db_path) / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    main()
