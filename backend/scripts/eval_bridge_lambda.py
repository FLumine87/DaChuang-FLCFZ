"""桥接的 λ（S 监督权重）扫描 —— 验证「码长不是瓶颈，监督信号强度才是」。

为什么怀疑 λ：
CMFH 的 G = Σ Gram(X_m)/gm + λ·S，两部分被归一化到同一量级。
K 增大时，前 K 个特征向量里 Gram 主导的向量变多、S 主导的（块状主题结构）
被稀释 → 跨模态对齐变弱。实测 K=64/128/256 确实没提升，印证了这点。

反过来，若 λ 太小，图像码会被「图像自己的 Gram 结构」主导
（CNN 特征判别力强），与文本码不重合 → 文搜图差；
主引擎里图像码之所以贴近文本码，是因为它投影到的是**文-音建立的**语义空间。

→ 提高 λ 应能把图像码拉向文本码。

用法：
    python scripts/eval_bridge_lambda.py --pair text
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


def build_rows(recs, units, q_mod, image_feature="cnn"):
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
        if image_feature == "cnn" and enc.available:
            if_ = enc.feature(ip)
        else:
            if_ = RF.image_feature(ip)
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pair", default="text", choices=("text", "audio"))
    ap.add_argument("--lambdas", default="0.6,2,5,10,20")
    ap.add_argument("--K", type=int, default=64)
    ap.add_argument("--image-feature", default="cnn", choices=("cnn","hand"))
    ap.add_argument("--train-max", type=int, default=3000)
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    q_mod = args.pair
    i_mod = "image"
    recs, units, queries = load()
    rows = build_rows(recs, units, q_mod, args.image_feature)
    print(f"语料 {len(recs)} 记录 / {len(queries)} 查询，{q_mod}-图 配对行 {len(rows)}")
    print(f"K={args.K}  训练行上限 {args.train_max}\n")

    enc = FerEncoder()
    rng = random.Random(42)
    train_rows = rng.sample(rows, min(args.train_max, len(rows))) \
        if len(rows) > args.train_max else rows

    results = []
    for lam in [float(x) for x in args.lambdas.split(",")]:
        t0 = time.time()
        br = ImageTextBridge(code_length=args.K, lambda_s=lam)
        br.fit(train_rows, feature_spec={"image": args.image_feature},
               pair=(q_mod, i_mod))

        def ev(qs, qm, rm):
            aps = []
            for q in qs:
                if qm == "text":
                    fv = list(F.semantic_feature(q.get("text") or ""))
                elif qm == "audio":
                    p = q.get("media_path")
                    if not p or not os.path.exists(p):
                        continue
                    fv = RF.audio_feature(p)
                    if fv is None:
                        continue
                else:
                    p = q.get("media_path")
                    if not p or not os.path.exists(p):
                        continue
                    fv = (enc.feature(p) if args.image_feature == "cnn" else RF.image_feature(p))
                    if fv is None:
                        continue
                hits = br.search(fv, qm, top_k=CANDIDATES, result_modality=rm,
                                 exclude_record=q.get("record_id"))
                ranked, seen = [], set()
                for h in hits:
                    rid = h["record_id"]
                    if rid in seen:
                        continue
                    seen.add(rid)
                    ranked.append(rid)
                th = _norm(q.get("themes"))

                def rel(rid, own=q.get("record_id"), t=th):
                    if rid == own:
                        return False
                    return _jac(t, recs.get(rid) or []) >= JACCARD_MIN
                aps.append(_ap(ranked, rel, TOP_K))
            return aps

        q2i = ev([q for q in queries if q["modality"] == q_mod], q_mod, i_mod)
        i2q = ev([q for q in queries if q["modality"] == "image"], "image", q_mod)

        def mean(vs):
            return round(sum(vs) / len(vs), 4) if vs else 0.0
        r = {"lambda_s": lam, "K": args.K,
             "q2i": {"map@10": mean(q2i), "queries": len(q2i)},
             "i2q": {"map@10": mean(i2q), "queries": len(i2q)},
             "seconds": round(time.time() - t0, 1)}
        results.append(r)
        print(f"  λ={lam:<6} {q_mod}搜图 {r['q2i']['map@10']:.4f}   "
              f"图搜{q_mod} {r['i2q']['map@10']:.4f}   ({r['seconds']}s)")

    print("\n" + "=" * 62)
    print(f"λ 扫描汇总（{q_mod}-图桥接，K={args.K}）")
    print("=" * 62)
    base = {"text": (0.4404, 0.2231), "audio": (0.2566, 0.2439)}[q_mod]
    print(f"  主引擎基线：{q_mod}搜图 {base[0]:.4f}   图搜{q_mod} {base[1]:.4f}")
    for r in results:
        star = "  ★" if (r["q2i"]["map@10"] > base[0]
                          or r["i2q"]["map@10"] > base[1]) else ""
        print(f"  λ={r['lambda_s']:<6} {q_mod}搜图 {r['q2i']['map@10']:.4f}   "
              f"图搜{q_mod} {r['i2q']['map@10']:.4f}{star}")

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump({"pair": q_mod, "K": args.K, "results": results},
                      f, ensure_ascii=False, indent=1)
        print(f"已写入 {args.out}")


if __name__ == "__main__":
    main()
