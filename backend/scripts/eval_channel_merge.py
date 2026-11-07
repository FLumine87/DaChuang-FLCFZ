"""① 通道合并实验：文搜图 / 音搜图 能否超过单通道。

现状
----
  文搜图  主引擎 0.4316   桥接 0.30（桥接更差，不能直接替换）
  音搜图  主引擎 0.3192   桥接 0.18（桥接更差）

思路：两个通道看到的是**不同的相关性**（主引擎靠弱语义图像特征 + 文-音锚点，
桥接靠 CNN 判别特征 + 大 λ 的主题结构），合并可能互补。

策略对比
--------
  main        只用主引擎
  bridge      只用桥接
  rrf         Reciprocal Rank Fusion（排名融合，与分数尺度无关）
  weighted    分数线性加权（w·main + (1−w)·bridge）
  max         取两通道分数的最大值
  interleave  按排名交错取

每种策略都跑一遍，与单通道对比。
"""
import argparse
import json
import os
import random
import sys
import time

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from app.engines.hashing import features as F              # noqa: E402
from app.engines.hashing import real_features as RF         # noqa: E402
from app.engines.hashing.fer_encoder import FerEncoder      # noqa: E402
from app.engines.hashing.image_bridge import ImageTextBridge  # noqa: E402
import numpy as np  # noqa: E402
import sqlite3  # noqa: E402

CORPUS = os.path.join(BACKEND, "data", "hashing", "real_corpus.db")
TOP_K = 10
CANDIDATES = 30
JACCARD_MIN = 0.5


def _norm(x):
    if isinstance(x, str):
        try:
            x = json.loads(x)
        except Exception:
            x = [x]
    return x or []


def _jac(a, b):
    a, b = set(_norm(a)), set(_norm(b))
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


def build_rows(recs, units, q_mod):
    by = {}
    for u in units:
        by.setdefault(u.get("record_id"), {})[u.get("modality")] = u
    enc = FerEncoder()
    rows = []
    for rid, v in by.items():
        q_u, i_u = v.get(q_mod), v.get("image")
        if not q_u or not i_u:
            continue
        ip = i_u.get("media_path")
        if not ip or not os.path.exists(ip):
            continue
        if_ = enc.feature(ip) if enc.available else RF.image_feature(ip)
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
        rows.append({"record_id": rid, "text_feature": list(qf),
                     "image_feature": list(if_), "tags": recs.get(rid) or []})
    return rows


def rrf(rankings, k=60):
    """Reciprocal Rank Fusion：多个排名列表按 1/(k+rank) 加权融合。"""
    scores = {}
    for ranked in rankings:
        for i, rid in enumerate(ranked, 1):
            scores[rid] = scores.get(rid, 0.0) + 1.0 / (k + i)
    return [rid for rid, _ in sorted(scores.items(), key=lambda x: -x[1])]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pair", default="text", choices=("text", "audio"))
    ap.add_argument("--lambda-s", type=float, default=20.0)
    ap.add_argument("--train-max", type=int, default=3000)
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    q_mod = args.pair
    r_mod = "image"
    recs, units, queries = load()
    rows = build_rows(recs, units, q_mod)
    rng = random.Random(42)
    train_rows = rng.sample(rows, min(args.train_max, len(rows))) \
        if len(rows) > args.train_max else rows
    br = ImageTextBridge(code_length=64, lambda_s=args.lambda_s)
    br.fit(train_rows, feature_spec={"image": "cnn"}, pair=(q_mod, "image"))
    enc = FerEncoder()

    # 主引擎的索引与模型
    from app.engines import get_hashing_engine
    import asyncio
    engine = get_hashing_engine()
    engine._do_initialize()

    async def collect():
        """对每条查询，取主引擎与桥接的 top-N 排名列表。"""
        out = []
        for q in queries:
            if q["modality"] != q_mod:
                continue
            if q_mod == "text":
                text = (q.get("text") or "").strip()
                if not text:
                    continue
                fv = list(F.semantic_feature(text))
                mpath = None
            else:
                mpath = q.get("media_path")
                if not mpath or not os.path.exists(mpath):
                    continue
                fv = RF.audio_feature(mpath)
                if fv is None:
                    continue
            # 主引擎（混合检索，按结果模态过滤）
            hits, _ = await engine.search_with_info(
                query=q.get("text") or "", modality=q_mod,
                top_k=CANDIDATES * 3, viewer=None, media_path=mpath,
            )
            main_ranked, main_score = [], {}
            for h in hits:
                if h.get("modality") != r_mod:
                    continue
                rid = h.get("record_id") or h.get("id")
                if rid in main_score:
                    continue
                main_ranked.append(rid)
                main_score[rid] = h.get("score") or h.get("similarity") or 0.0
            # 桥接
            bh = br.search(fv, q_mod, top_k=CANDIDATES * 3, result_modality=r_mod)
            bridge_ranked, bridge_score = [], {}
            for h in bh:
                rid = h["record_id"]
                if rid in bridge_score:
                    continue
                bridge_ranked.append(rid)
                bridge_score[rid] = h.get("sim") or 0.0
            out.append({
                "q": q, "main": main_ranked, "bridge": bridge_ranked,
                "ms": main_score, "bs": bridge_score,
            })
        return out

    data = asyncio.run(collect())
    print(f"查询 {len(data)} 条（{q_mod} → {r_mod}）\n")

    def score_of(strategy, d):
        m, b = d["main"], d["bridge"]
        ms, bs = d["ms"], d["bs"]
        if strategy == "main":
            return m
        if strategy == "bridge":
            return b
        if strategy == "rrf":
            return rrf([m, b])
        if strategy == "max":
            keys = set(m) | set(b)
            return sorted(keys, key=lambda r: -max(ms.get(r, 0.0), bs.get(r, 0.0)))
        if strategy == "interleave":
            out, i, j = [], 0, 0
            while i < len(m) or j < len(b):
                if i < len(m):
                    out.append(m[i]); i += 1
                if j < len(b):
                    out.append(b[j]); j += 1
            return out
        if strategy.startswith("w"):
            w = float(strategy[1:])
            keys = set(m) | set(b)
            return sorted(keys, key=lambda r: -(w * ms.get(r, 0.0)
                                                + (1 - w) * bs.get(r, 0.0)))
        raise ValueError(strategy)

    strategies = ["main", "bridge", "rrf", "max", "interleave",
                  "w0.2", "w0.5", "w0.8"]
    print(f"{'策略':<14}{q_mod+'搜'+r_mod:>12}")
    print("-" * 30)
    results = {}
    for st in strategies:
        aps = []
        for d in data:
            ranked = score_of(st, d)
            q = d["q"]
            th = _norm(q.get("themes"))

            def rel(rid, own=q.get("record_id"), t=th):
                if rid == own:
                    return False
                return _jac(t, recs.get(rid) or []) >= JACCARD_MIN
            aps.append(_ap(ranked, rel, TOP_K))
        m = sum(aps) / len(aps) if aps else 0
        results[st] = round(m, 4)
        mark = ""
        if st == "main":
            mark = "  ← 现状"
        print(f"{st:<14}{m:>12.4f}{mark}")

    best = max(results, key=lambda k: results[k])
    print("-" * 30)
    print(f"最佳策略: {best}  mAP@10 = {results[best]:.4f}"
          f"  （现状 main = {results['main']:.4f}，"
          f"{results[best]-results['main']:+.4f}）")

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump({"pair": f"{q_mod}-{r_mod}", "lambda_s": args.lambda_s,
                       "results": results, "best": best},
                      f, ensure_ascii=False, indent=1)
        print(f"已写入 {args.out}")


if __name__ == "__main__":
    main()
