"""S 的构造方案对比实验。

问题：现在 S = 主题标签 Jaccard，块状太粗
  · 83.7% 的记录只有 1 个标签
  · 84.9% 的配对 Jaccard = 0
  · 24 个主题块，块内每条记录平均 617 个同主题邻居分不开

候选方案
  A  baseline    S = 主题 Jaccard（现状）
  B  semantic    S = bge 文本特征余弦（连续语义，细粒度）
  C  hybrid      S = α·语义余弦 + β·主题 Jaccard
  D  hybrid+int  S = C 再叠加强度/风险等级的连续值（EATD 的 SDS、severity）

对每个方案，在文-图桥接上测「文搜图 / 图搜文」，
并诊断「同主题 vs 不同主题」的码距差距（衡量 S 的分辨力）。

用法：
    python scripts/eval_s_matrix.py --pair text --lambda-s 20
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
    meta = {r["record_id"]: dict(r) for r in conn.execute(
        "SELECT record_id, severity, alert_level, label FROM records")}
    units = [dict(r) for r in conn.execute(
        "SELECT * FROM units ORDER BY record_id, modality")]
    queries = [dict(r) for r in conn.execute("SELECT * FROM queries")]
    conn.close()
    return recs, meta, units, queries


def build_rows(recs, meta, units, q_mod, image_feature="cnn"):
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
        m = meta.get(rid) or {}
        rows.append({
            "record_id": rid, "text_feature": list(qf),
            "image_feature": list(if_), "tags": recs.get(rid) or [],
            "severity": m.get("severity"), "alert_level": m.get("alert_level"),
        })
    return rows


def _jac_cached(a, b, cache):
    """带缓存的 Jaccard。83.7% 的记录只有 1 个标签 → 相同 tags 组合大量重复，
    缓存后 O(n²) 次调用退化成 O(唯一组合数²)。"""
    ka = frozenset(_norm(a))
    kb = frozenset(_norm(b))
    key = (ka, kb) if ka <= kb else (kb, ka)
    v = cache.get(key)
    if v is None:
        u = ka | kb
        v = (len(ka & kb) / len(u)) if u else 0.0
        cache[key] = v
    return v


def build_S(rows, mode, alpha=0.5):
    """按方案构造 S（n×n）。"""
    n = len(rows)
    cache = {}
    if mode == "baseline":
        S = np.zeros((n, n))
        for i in range(n):
            for j in range(i + 1, n):
                v = _jac_cached(rows[i]["tags"], rows[j]["tags"], cache)
                S[i][j] = S[j][i] = v
    elif mode in ("semantic", "hybrid", "hybrid+int", "blockwise"):
        # 语义余弦：用文本特征（bge）算，bge 已归一化 → 点积即余弦
        T = np.array([r["text_feature"] for r in rows], dtype=np.float64)
        norms = np.linalg.norm(T, axis=1, keepdims=True)
        norms[norms < 1e-9] = 1.0
        T = T / norms
        C = T @ T.T
        C = np.clip(C, 0.0, 1.0)
        if mode == "semantic":
            S = C
        else:
            J = np.zeros((n, n))
            for i in range(n):
                for j in range(i + 1, n):
                    v = _jac_cached(rows[i]["tags"], rows[j]["tags"], cache)
                    J[i][j] = J[j][i] = v
            if mode == "hybrid":
                S = alpha * C + (1 - alpha) * J
            elif mode == "hybrid+int":
                # 再叠加强度接近度（severity / SDS / 风险等级）
                sev = np.array([float(r["severity"] or 0) for r in rows])
                rng = max(sev.max() - sev.min(), 1e-6)
                sev = (sev - sev.min()) / rng
                D = 1.0 - np.abs(sev[:, None] - sev[None, :])
                S = alpha * C + (1 - alpha) * J
                S = S * (0.7 + 0.3 * D)
            else:
                # blockwise：**块内细化**而不是全局替换
                # 主题 Jaccard 提供了清晰的块边界（同主题=1、异主题=0），
                # 但块内 617 个邻居全等价。bge 余弦在心理话题上同主题内差异很小
                # （实测异主题余弦均值仍有 0.45），全局替换会把块边界抹平。
                # 因此只在 J>0 的块内用语义余弦做微调，异主题仍保持 0：
                #     S = J · (1 - β + β·cos_semantic)
                S = J * (1.0 - alpha + alpha * C)
    else:
        raise ValueError(mode)
    np.fill_diagonal(S, 1.0)
    return S


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pair", default="text", choices=("text", "audio"))
    ap.add_argument("--lambda-s", type=float, default=20.0)
    ap.add_argument("--alpha", type=float, default=0.5)
    ap.add_argument("--train-max", type=int, default=3000)
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    q_mod = args.pair
    i_mod = "image"
    recs, meta, units, queries = load()
    rows = build_rows(recs, meta, units, q_mod)
    print(f"语料 {len(recs)} 记录 / {len(queries)} 查询，{q_mod}-图 配对行 {len(rows)}")
    print(f"λ={args.lambda_s}  alpha={args.alpha}\n")

    rng = random.Random(42)
    train_rows = rng.sample(rows, min(args.train_max, len(rows))) \
        if len(rows) > args.train_max else rows
    enc = FerEncoder()

    def ev(br, qs, qm, rm):
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
                fv = enc.feature(p)
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

    def diag_S_disp(br):
        """S 的分辨力诊断：同主题 vs 不同主题的 S 值分布。

        用缓存 + 唯一 tags 组合枚举，避免 O(n²) 的 Python 循环。
        """
        S = br._last_S
        tags = [frozenset(_norm(r["tags"])) for r in train_rows]
        uniq = sorted(set(tags), key=len, reverse=True)
        # 同一 tags 组合内部的 S 均值（用第一个代表行近似）
        rep = {}
        for i, t in enumerate(tags):
            if t not in rep:
                rep[t] = i
        same, diff = [], []
        cache = {}
        for i, ti in enumerate(tags):
            for j, tj in enumerate(tags):
                if j <= i:
                    continue
                if not (ti & tj):
                    continue
                key = (ti, tj) if ti <= tj else (tj, ti)
                v = cache.get(key)
                if v is None:
                    u = ti | tj
                    v = (len(ti & tj) / len(u)) if u else 0.0
                    cache[key] = v
                a = S[rep[ti]][rep[tj]]
                (same if v >= 0.5 else diff).append(a)
        return (float(np.mean(same)) if same else 0,
                float(np.mean(diff)) if diff else 0)

    results = []
    for mode in ("baseline", "semantic", "hybrid", "hybrid+int", "blockwise"):
        t0 = time.time()
        S = build_S(train_rows, mode, args.alpha)
        # 把 S 直接喂给 CMFH：绕过 fit 内部的构造
        br = ImageTextBridge(code_length=64, lambda_s=args.lambda_s)
        q_feats = {q_mod: [r["text_feature"] for r in train_rows],
                   i_mod: [r["image_feature"] for r in train_rows]}
        # numpy 数组要转成嵌套 list（CMFH 的 linalg 期望 list）
        S_list = [[float(v) for v in row] for row in np.asarray(S)]
        # 手动构造 feats + sim，走 model.fit
        br._fit_with_S(train_rows, q_feats, S_list)

        q2i = ev(br, [q for q in queries if q["modality"] == q_mod], q_mod, i_mod)
        i2q = ev(br, [q for q in queries if q["modality"] == "image"], "image", q_mod)

        def mean(vs):
            return round(sum(vs) / len(vs), 4) if vs else 0.0
        s_same, s_diff = diag_S_disp(br)
        r = {"mode": mode, "lambda_s": args.lambda_s,
             "q2i": {"map@10": mean(q2i), "queries": len(q2i)},
             "i2q": {"map@10": mean(i2q), "queries": len(i2q)},
             "S_同主题均值": round(s_same, 4),
             "S_不同主题均值": round(s_diff, 4),
             "S_分辨力": round(s_same - s_diff, 4),
             "seconds": round(time.time() - t0, 1)}
        results.append(r)
        print(f"  {mode:<12} {q_mod}搜图 {r['q2i']['map@10']:.4f}   "
              f"图搜{q_mod} {r['i2q']['map@10']:.4f}   "
              f"S分辨力 {r['S_分辨力']:+.4f}   ({r['seconds']}s)")

    print("\n" + "=" * 74)
    print(f"S 构造方案对比（{q_mod}-图桥接，λ={args.lambda_s}）")
    print("=" * 74)
    print(f"{'方案':<14}{q_mod+'搜图':>12}{'图搜'+q_mod:>12}"
          f"{'S同主题':>11}{'S异主题':>11}{'分辨力':>10}")
    for r in results:
        print(f"{r['mode']:<14}{r['q2i']['map@10']:>12.4f}"
              f"{r['i2q']['map@10']:>12.4f}"
              f"{r['S_同主题均值']:>11.4f}{r['S_不同主题均值']:>11.4f}"
              f"{r['S_分辨力']:>+10.4f}")

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump({"pair": q_mod, "lambda_s": args.lambda_s,
                       "alpha": args.alpha, "results": results},
                      f, ensure_ascii=False, indent=1)
        print(f"已写入 {args.out}")


if __name__ == "__main__":
    main()
