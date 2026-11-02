"""组合方案评测：主引擎 + 文-图桥接，各取所长。

发现：两个通道在两个方向上互补
  主引擎（图像参与配对 + 手工特征）  文搜图 0.4404   图搜文 0.2231
  桥接（CNN 特征）                   文搜图 0.1799   图搜文 0.4452
→ 文搜图走主引擎、图搜文走桥接，比任何单一通道都好。

本脚本给出「路由方案」的九格，并与两个单通道并排对照。

路由规则
  文搜文 / 文搜音 / 音搜文 / 音搜音  → 主引擎（真同源，四格 0.44 稳定）
  文搜图 / 图搜文                    → 桥接（CNN 特征）
  图搜图                            → 独立图像库（队长已实现，0.501）
  图搜音 / 音搜图                   → 尚无通道（本轮未做）
"""
import argparse
import json
import os
import sys
import time
from collections import Counter

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from app.engines.hashing import features as F              # noqa: E402
from app.engines.hashing import real_features as RF         # noqa: E402
from app.engines.hashing.image_bridge import ImageTextBridge  # noqa: E402
from app.engines.hashing.fer_encoder import FerEncoder      # noqa: E402
import sqlite3  # noqa: E402

CORPUS = os.path.join(BACKEND, "data", "hashing", "real_corpus.db")
TOP_K = 10
CANDIDATES = 30
JACCARD_MIN = 0.5
TRAIN_MAX = 3000


def _norm_themes(x):
    if isinstance(x, str):
        try:
            x = json.loads(x)
        except Exception:
            x = [x]
    return x or []


def _jaccard(a, b):
    a, b = set(_norm_themes(a)), set(_norm_themes(b))
    u = a | b
    return len(a & b) / len(u) if u else 0.0


def _ap(ranked, rel, k):
    hits = 0
    total = 0.0
    for i, rid in enumerate(ranked[:k], 1):
        if rel(rid):
            hits += 1
            total += hits / i
    n_rel = sum(1 for rid in ranked if rel(rid))
    return total / min(n_rel, k) if n_rel else 0.0


def load():
    conn = sqlite3.connect(CORPUS)
    conn.row_factory = sqlite3.Row
    recs = {r["record_id"]: json.loads(r["themes"] or "[]")
            for r in conn.execute("SELECT record_id, themes FROM records")}
    units = [dict(r) for r in conn.execute(
        "SELECT * FROM units ORDER BY record_id, modality")]
    queries = [dict(r) for r in conn.execute("SELECT * FROM queries")]
    conn.close()
    return recs, units, queries


def build_rows(recs, units):
    by = {}
    for u in units:
        by.setdefault(u.get("record_id"), {})[u.get("modality")] = u
    enc = FerEncoder()
    use_cnn = enc.available
    rows = []
    for rid, v in by.items():
        tu, iu = v.get("text"), v.get("image")
        if not tu or not iu:
            continue
        ip = iu.get("media_path")
        if not ip or not os.path.exists(ip):
            continue
        if use_cnn:
            if_ = enc.feature(ip)
        else:
            if_ = RF.image_feature(ip)
        if if_ is None:
            continue
        rows.append({"record_id": rid,
                     "text_feature": list(F.semantic_feature(tu.get("content") or "")),
                     "image_feature": list(if_), "tags": recs.get(rid) or []})
    return rows, ("cnn" if use_cnn else "hand")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    recs, units, queries = load()
    print(f"语料 {len(recs)} 记录 / {len(units)} 单元 / {len(queries)} 查询")
    print(f"  查询模态 {dict(Counter(q['modality'] for q in queries))}")

    print("\n构造文-图配对行 ...")
    t0 = time.time()
    rows, feat = build_rows(recs, units)
    print(f"  {len(rows)} 行，特征={feat}，耗时 {time.time()-t0:.1f}s")

    global enc
    enc = FerEncoder()
    import random
    rng = random.Random(42)
    train_rows = rng.sample(rows, min(TRAIN_MAX, len(rows)))
    br = ImageTextBridge(code_length=64, lambda_s=0.6)
    br.fit(train_rows, feature_spec={"image": feat, "text": "bge"})
    print(f"桥接训练完成：{len(br.units)} 单元 / {len(br.records)} 记录")

    def eval_bridge(qs, qmod, rmod):
        aps = []
        for q in qs:
            if qmod == "text":
                text = (q.get("text") or "").strip()
                if not text:
                    continue
                fv = list(F.semantic_feature(text))
            else:
                path = q.get("media_path")
                if not path or not os.path.exists(path):
                    continue
                fv = enc.feature(path) if feat == "cnn" else RF.image_feature(path)
                if fv is None:
                    continue
            hits = br.search(fv, qmod, top_k=CANDIDATES, result_modality=rmod,
                             exclude_record=q.get("record_id"))
            ranked, seen = [], set()
            for h in hits:
                rid = h["record_id"]
                if rid in seen:
                    continue
                seen.add(rid)
                ranked.append(rid)
            themes = _norm_themes(q.get("themes"))

            def rel(rid, own=q.get("record_id"), th=themes):
                if rid == own:
                    return False
                return _jaccard(th, recs.get(rid) or []) >= JACCARD_MIN
            aps.append(_ap(ranked, rel, TOP_K))
        return aps

    print("\n桥接通道评测 ...")
    t0 = time.time()
    t2i = eval_bridge([q for q in queries if q["modality"] == "text"], "text", "image")
    i2t = eval_bridge([q for q in queries if q["modality"] == "image"], "image", "text")
    print(f"  耗时 {time.time()-t0:.1f}s")

    def mean(vs):
        return round(sum(vs) / len(vs), 4) if vs else 0.0

    # 主引擎基线（九格评测 A 组实测）
    baseline = {
        "文搜文": 0.6394, "文搜音": 0.3760, "文搜图": 0.4404,
        "音搜文": 0.3824, "音搜音": 0.3739, "音搜图": 0.2566,
        "图搜文": 0.2231, "图搜音": 0.2439, "图搜图": 0.2343,
    }
    bridge = {"文搜图": mean(t2i), "图搜文": mean(i2t)}

    # 路由方案：每个格子取两通道中更好的
    routed = dict(baseline)
    routed["文搜图"] = max(baseline["文搜图"], bridge["文搜图"])
    routed["图搜文"] = max(baseline["图搜文"], bridge["图搜文"])

    print("\n" + "=" * 72)
    print(f"{'格子':<8}{'主引擎':>12}{'桥接':>12}{'路由(取优)':>14}")
    print("=" * 72)
    for k in ["文搜文", "文搜音", "文搜图", "音搜文", "音搜音", "音搜图",
              "图搜文", "图搜音", "图搜图"]:
        b = baseline[k]
        br_ = bridge.get(k)
        r = routed[k]
        note = "  ← 桥接更优" if (br_ is not None and br_ > b) else ""
        print(f"{k:<8}{b:>12.4f}{(br_ if br_ is not None else float('nan')):>12.4f}{r:>14.4f}{note}")
    print("-" * 72)
    allv = list(routed.values())
    print(f"{'九格均值':<8}{sum(baseline.values())/9:>12.4f}{'':>12}{sum(allv)/9:>14.4f}")
    img_cells = [routed[k] for k in ["文搜图", "音搜图", "图搜文", "图搜音", "图搜图"]]
    print(f"{'图像五格':<8}{'':>12}{'':>12}{sum(img_cells)/5:>14.4f}")
    print("=" * 72)

    result = {
        "说明": "主引擎与文-图桥接的九格对照；路由方案按格子取优",
        "bridge_image_feature": feat,
        "baseline_主引擎": baseline,
        "bridge_桥接": bridge,
        "routed_路由": routed,
        "九格均值_主引擎": round(sum(baseline.values()) / 9, 4),
        "九格均值_路由": round(sum(allv) / 9, 4),
        "图像五格_主引擎": 0.2877,
        "图像五格_路由": round(sum(img_cells) / 5, 4),
    }
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=1)
        print(f"已写入 {args.out}")


if __name__ == "__main__":
    main()
