"""音-图弱监督桥接 + 码长 K 的影响。

两个实验：
1. 音-图桥接（audio + image，只喂这两个模态）
2. 码长 K 的影响（64 / 128 / 256）—— 验证「64 位对双模态联合信息量太紧」的假设

音-图的动机：文-图两侧信息密度差两个数量级
（bge 531 维语义 vs CNN 1280 维判别），压到 64 位后弱的一方先失效；
音-图两侧更接近（MFCC 64 维 vs CNN 1280 维），
但语音的判别力也弱 —— 到底哪种更对齐，需要实测。
"""
import argparse
import json
import os
import random
import sys
import time
from collections import Counter

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


def build_rows(recs, units, pair, image_feature):
    """pair: ("text","image") 或 ("audio","image")"""
    q_mod, i_mod = pair
    by = {}
    for u in units:
        by.setdefault(u.get("record_id"), {})[u.get("modality")] = u
    enc = FerEncoder()
    use_cnn = enc.available
    rows = []
    for rid, v in by.items():
        q_u, i_u = v.get(q_mod), v.get(i_mod)
        if not q_u or not i_u:
            continue
        ip = i_u.get("media_path")
        if not ip or not os.path.exists(ip):
            continue
        if use_cnn and image_feature == "cnn":
            if_ = enc.feature(ip)
        else:
            if_ = RF.image_feature(ip)
        if if_ is None:
            continue
        # 文本侧：bge + 主题桥；音频侧：MFCC + 韵律（语料预抽取）
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
    return rows, ("cnn" if (use_cnn and image_feature == "cnn") else "hand")


def run_bridge(rows, recs, queries, pair, K, lambda_s, train_max, feat):
    q_mod, i_mod = pair
    rng = random.Random(42)
    train_rows = rng.sample(rows, min(train_max, len(rows))) \
        if len(rows) > train_max else rows
    br = ImageTextBridge(code_length=K, lambda_s=lambda_s)
    br.fit(train_rows, feature_spec={"image": feat, q_mod: "bge/mfcc"},
           pair=(q_mod, i_mod))
    enc = FerEncoder()

    def ev(qs, qmod, rmod):
        aps = []
        for q in qs:
            if qmod == "text":
                fv = list(F.semantic_feature(q.get("text") or ""))
            elif qmod == "audio":
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
                fv = enc.feature(p) if feat == "cnn" else RF.image_feature(p)
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
            th = _norm_themes(q.get("themes"))

            def rel(rid, own=q.get("record_id"), t=th):
                if rid == own:
                    return False
                return _jaccard(t, recs.get(rid) or []) >= JACCARD_MIN
            aps.append(_ap(ranked, rel, TOP_K))
        return aps

    q2i = ev([q for q in queries if q["modality"] == q_mod], q_mod, i_mod)
    i2q = ev([q for q in queries if q["modality"] == "image"], "image", q_mod)

    def mean(vs):
        return round(sum(vs) / len(vs), 4) if vs else 0.0
    return {
        "pair": f"{q_mod}-{i_mod}", "K": K, "lambda_s": lambda_s,
        "image_feature": feat, "train_rows": len(train_rows),
        "q2i": {"map@10": mean(q2i), "queries": len(q2i)},
        "i2q": {"map@10": mean(i2q), "queries": len(i2q)},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="")
    ap.add_argument("--train-max", type=int, default=3000)
    args = ap.parse_args()

    recs, units, queries = load()
    print(f"语料 {len(recs)} 记录 / {len(units)} 单元 / {len(queries)} 查询")
    print(f"  查询模态 {dict(Counter(q['modality'] for q in queries))}\n")

    results = []

    print("=" * 68)
    print("实验 1　音-图桥接（K=64）")
    print("=" * 68)
    arows, afeat = build_rows(recs, units, ("audio", "image"), "cnn")
    print(f"  音-图配对行 {len(arows)}，图像特征={afeat}")
    r = run_bridge(arows, recs, queries, ("audio", "image"), 64, 0.6,
                   args.train_max, afeat)
    results.append(r)
    print(f"  音搜图 mAP@10 = {r['q2i']['map@10']:.4f} ({r['q2i']['queries']})")
    print(f"  图搜音 mAP@10 = {r['i2q']['map@10']:.4f} ({r['i2q']['queries']})")

    print("\n" + "=" * 68)
    print("实验 2　文-图桥接的码长影响（K=64/128/256）")
    print("=" * 68)
    trows, tfeat = build_rows(recs, units, ("text", "image"), "cnn")
    print(f"  文-图配对行 {len(trows)}，图像特征={tfeat}")
    for K in (64, 128, 256):
        t0 = time.time()
        r = run_bridge(trows, recs, queries, ("text", "image"), K, 0.6,
                       args.train_max, tfeat)
        r["seconds"] = round(time.time() - t0, 1)
        results.append(r)
        print(f"  K={K:<4} 文搜图 {r['q2i']['map@10']:.4f}   "
              f"图搜文 {r['i2q']['map@10']:.4f}   ({r['seconds']}s)")

    print("\n" + "=" * 68)
    print("汇总")
    print("=" * 68)
    print(f"{'配置':<20}{'文搜图/音搜图':>16}{'图搜文/图搜音':>16}")
    for r in results:
        print(f"{r['pair']+' K='+str(r['K']):<20}"
              f"{r['q2i']['map@10']:>16.4f}{r['i2q']['map@10']:>16.4f}")

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=1)
        print(f"已写入 {args.out}")


if __name__ == "__main__":
    main()
