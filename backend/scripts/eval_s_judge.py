"""用更细的相关性判据重测 S 方案 —— 检验「baseline 最好」是否只是刷指标。

发现：baseline（主题 Jaccard）的检索指标最好，但 blockwise 的 S 分辨力最高。
两者矛盾。原因可能是：
  评测的相关性判据本身就是「主题 Jaccard >= 0.5」，
  而 S 也用主题 Jaccard → 模型学出来的排序天然最符合这个判据。
  → 这可能是「刷指标」而不是真的更好。

验证：换用更细的判据重测，看排序是否反转。
  判据 A（现状）  主题 Jaccard >= 0.5
  判据 B（语义）   bge 文本余弦 >= 阈值（阈值取使相关比例相当的 0.55）
  判据 C（情绪）   情绪主题一致（愤怒/悲伤/快乐… 映射到 FER 7 类后相同）

如果换判据后 baseline 掉下来、blockwise 上来 → 之前是刷指标。
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
from app.engines.hashing.fer_encoder import FerEncoder      # noqa: E402
from app.engines.hashing.image_bridge import ImageTextBridge  # noqa: E402
import numpy as np  # noqa: E402
import sqlite3  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eval_s_matrix import build_S, build_rows, load, _norm  # noqa: E402

TOP_K = 10
CANDIDATES = 30


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


# FER 7 类 ← CSEMOTIONS 情绪主题 的映射（用于情绪判据）
EMOTION_MAP = {
    "情绪-愤怒": "angry", "情绪-厌恶": "disgust", "情绪-恐惧": "fear",
    "情绪-悲伤": "sad", "情绪-高兴": "happy", "情绪-惊讶": "surprise",
    "情绪-中性": "neutral", "情绪-调皮": "happy",
    "情绪-积极": "happy", "情绪-消极": "sad",
}


def emotion_of(tags):
    for t in _norm(tags):
        if t in EMOTION_MAP:
            return EMOTION_MAP[t]
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lambda-s", type=float, default=20.0)
    ap.add_argument("--alpha", type=float, default=0.5)
    ap.add_argument("--train-max", type=int, default=3000)
    ap.add_argument("--sem-threshold", type=float, default=0.55)
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    q_mod, i_mod = "text", "image"
    recs, meta, units, queries = load()
    rows = build_rows(recs, meta, units, q_mod)
    print(f"配对行 {len(rows)}，λ={args.lambda_s}，语义阈值={args.sem_threshold}\n")

    # 语义相似度矩阵（bge 文本余弦），用于判据 B
    T = np.array([r["text_feature"] for r in rows], dtype=np.float64)
    nrm = np.linalg.norm(T, axis=1, keepdims=True)
    nrm[nrm < 1e-9] = 1.0
    T = T / nrm
    COS_ALL = np.clip(T @ T.T, 0.0, 1.0)
    rid_index = {r["record_id"]: i for i, r in enumerate(rows)}

    # 查询侧的语义向量
    q_vecs = {}
    for q in queries:
        t = (q.get("text") or "").strip()
        if t:
            q_vecs[q["query_id"]] = F.semantic_feature(t)

    rng = random.Random(42)
    train_rows = rng.sample(rows, min(args.train_max, len(rows))) \
        if len(rows) > args.train_max else rows
    enc = FerEncoder()

    modes = ("baseline", "blockwise")
    results = {m: {} for m in modes}

    for mode in modes:
        t0 = time.time()
        S = build_S(train_rows, mode, args.alpha)
        S_list = [[float(v) for v in row] for row in np.asarray(S)]
        br = ImageTextBridge(code_length=64, lambda_s=args.lambda_s)
        q_feats = {q_mod: [r["text_feature"] for r in train_rows],
                   i_mod: [r["image_feature"] for r in train_rows]}
        br._fit_with_S(train_rows, q_feats, S_list)

        def ev(qs, judge):
            aps = []
            for q in qs:
                if q_mod == "text":
                    fv = list(F.semantic_feature(q.get("text") or ""))
                else:
                    p = q.get("media_path")
                    if not p or not os.path.exists(p):
                        continue
                    fv = enc.feature(p)
                    if fv is None:
                        continue
                hits = br.search(fv, q_mod, top_k=CANDIDATES, result_modality=i_mod,
                                 exclude_record=q.get("record_id"))
                ranked, seen = [], set()
                for h in hits:
                    rid = h["record_id"]
                    if rid in seen:
                        continue
                    seen.add(rid)
                    ranked.append(rid)
                aps.append(_ap(ranked, judge(q), TOP_K))
            return aps

        def judge_theme(q):
            th = _norm(q.get("themes"))

            def rel(rid, own=q.get("record_id"), t=th):
                if rid == own:
                    return False
                return _jac(t, recs.get(rid) or []) >= 0.5
            return rel

        def judge_semantic(q):
            qv = q_vecs.get(q["query_id"])
            if qv is None:
                return lambda rid: False
            qn = float(np.linalg.norm(qv)) or 1.0
            qn = qn / qn

            def rel(rid, own=q.get("record_id"), qv=qv, qn=qn):
                if rid == own:
                    return False
                i = rid_index.get(rid)
                if i is None:
                    return False
                return float(COS_ALL[rid_index[q["record_id"]]][i]) >= args.sem_threshold
            return rel

        def judge_emotion(q):
            e = emotion_of(q.get("themes"))

            def rel(rid, own=q.get("record_id"), e=e):
                if rid == own:
                    return False
                e2 = emotion_of(recs.get(rid) or [])
                return e is not None and e == e2
            return rel

        tq = [q for q in queries if q["modality"] == "text"]
        iq = [q for q in queries if q["modality"] == "image"]
        for jname, judge in (("A_主题判据", judge_theme),
                             ("B_语义判据", judge_semantic),
                             ("C_情绪判据", judge_emotion)):
            a = ev(tq, judge)
            b = ev(iq, judge)
            results[mode][jname] = {
                "文搜图": round(sum(a) / len(a), 4) if a else 0,
                "图搜文": round(sum(b) / len(b), 4) if b else 0,
            }
        print(f"  {mode} 完成（{time.time()-t0:.1f}s）")

    print("\n" + "=" * 76)
    print("换判据重测：如果 baseline 只在「主题判据」下赢，说明是刷指标")
    print("=" * 76)
    for jname in ("A_主题判据", "B_语义判据", "C_情绪判据"):
        print(f"\n  {jname}")
        print(f"    {'':<14}{'文搜图':>12}{'图搜文':>12}")
        for mode in modes:
            r = results[mode][jname]
            print(f"    {mode:<14}{r['文搜图']:>12.4f}{r['图搜文']:>12.4f}")
        w1 = results["baseline"][jname]["文搜图"] - results["blockwise"][jname]["文搜图"]
        w2 = results["baseline"][jname]["图搜文"] - results["blockwise"][jname]["图搜文"]
        print(f"    → baseline 领先：文搜图 {w1:+.4f}  图搜文 {w2:+.4f}")

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=1)
        print(f"已写入 {args.out}")


if __name__ == "__main__":
    main()
