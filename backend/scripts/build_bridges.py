"""构建并落库桥接模型（线上与评测共用同一份码）。

用法：
    python scripts/build_bridges.py --pair text --lambda-s 20
    python scripts/build_bridges.py --pair audio --lambda-s 50

产物（写到 HASHING_DATA_DIR）：
    bridge_text-image_state.json   模型参数（W / B / 单元码）
    bridge_audio-image_state.json
"""
import argparse
import json
import os
import random
import sys
import time
from pathlib import Path

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from app.config import settings  # noqa: E402
from app.engines.hashing import features as F              # noqa: E402
from app.engines.hashing import real_features as RF         # noqa: E402
from app.engines.hashing.fer_encoder import FerEncoder      # noqa: E402
from app.engines.hashing.image_bridge import ImageTextBridge  # noqa: E402
from app.engines.hashing.bridge_store import BridgeStore    # noqa: E402
import sqlite3  # noqa: E402

CORPUS = os.path.join(BACKEND, "data", "hashing", "real_corpus.db")


def _norm(x):
    if isinstance(x, str):
        try:
            x = json.loads(x)
        except Exception:
            x = [x]
    return x or []


def build(pair, lambda_s, train_max, code_length, data_dir, corpus=CORPUS, model_path=""):
    q_mod, i_mod = pair
    conn = sqlite3.connect(Path(corpus).resolve().as_uri() + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    recs = {r["record_id"]: json.loads(r["themes"] or "[]")
            for r in conn.execute("SELECT record_id, themes FROM records")}
    units = [dict(r) for r in conn.execute(
        "SELECT * FROM units ORDER BY record_id, modality")]
    conn.close()

    by = {}
    for u in units:
        by.setdefault(u.get("record_id"), {})[u.get("modality")] = u

    enc = FerEncoder(model_path)
    if not enc.available:
        print("  CNN 编码器不可用 —— 桥接需要 CNN 特征（手工特征学不到对齐）")
        return None

    candidates = list(by.items())
    random.Random(42).shuffle(candidates)
    rows = []
    for rid, v in candidates:
        if len(rows) >= train_max:
            break
        q_u, i_u = v.get(q_mod), v.get(i_mod)
        if not q_u or not i_u:
            continue
        ip = i_u.get("media_path")
        if not ip or not os.path.exists(ip):
            continue
        if_ = enc.feature(ip)
        if if_ is None:
            continue
        if q_mod == "text":
            qf = F.semantic_feature(q_u.get("content") or "")
        else:
            af = q_u.get("feature")
            if isinstance(af, str):
                af = json.loads(af)
            if not af:
                ap_ = q_u.get("media_path")
                if not ap_ or not os.path.exists(ap_):
                    continue
                af = RF.audio_feature(ap_)
            if af is None:
                continue
            qf = af
        for unit in (q_u, i_u):
            details = json.loads(unit.get("meta") or "{}") if isinstance(unit.get("meta"), str) else unit.get("meta") or {}
            unit.update(details)
            unit["tags"] = _norm(unit.get("themes"))
            unit["media_meta"] = details
        rows.append({"record_id": rid, "text_feature": list(qf),
                     "image_feature": list(if_), "tags": recs.get(rid) or [],
                     "unit_ids": {q_mod: q_u["unit_id"], i_mod: i_u["unit_id"]},
                     "unit_meta": {q_mod: q_u, i_mod: i_u}})

    print(f"  {q_mod}-{i_mod} 配对行 {len(rows)}")
    if len(rows) < 50:
        print("  行数不足，退出")
        return None

    rng = random.Random(42)
    train_rows = rng.sample(rows, min(train_max, len(rows))) \
        if len(rows) > train_max else rows

    br = ImageTextBridge(code_length=code_length, lambda_s=lambda_s)
    t0 = time.time()
    ok = br.fit(train_rows, feature_spec={"image": "cnn"},
                pair=(q_mod, i_mod))
    if not ok:
        print("  训练失败")
        return None
    print(f"  训练完成，{len(br.units)} 单元，耗时 {time.time()-t0:.1f}s")

    store = BridgeStore(data_dir, pair)
    store.save_model(br)
    store.save_units(br.units)
    print(f"  已落库 → {store.state_path}")
    print(f"         → {store.units_path}")
    return br


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pair", default="text", choices=("text", "audio"))
    ap.add_argument("--lambda-s", type=float, default=0.0,
                    help="0 表示按该模态对的推荐值（text=20, audio=50）")
    ap.add_argument("--train-max", type=int, default=3000)
    ap.add_argument("--code-length", type=int, default=64)
    ap.add_argument("--data-dir", default="")
    ap.add_argument("--corpus", default=CORPUS)
    ap.add_argument("--image-model", default="")
    args = ap.parse_args()

    data_dir = args.data_dir or settings.HASHING_DATA_DIR
    pair = (args.pair, "image")
    lam = args.lambda_s or (20.0 if args.pair == "text" else 50.0)

    print("=" * 60)
    print(f"构建桥接 {args.pair}-image  λ={lam}  K={args.code_length}")
    print("=" * 60)
    if args.train_max < 50:
        ap.error("--train-max 必须至少为 50")
    if build(pair, lam, args.train_max, args.code_length, data_dir,
             args.corpus, args.image_model) is None:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
