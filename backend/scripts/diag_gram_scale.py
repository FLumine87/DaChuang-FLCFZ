"""快速验证 gram_masked 的尺度归一化修复（不用重训整个引擎）。

对比三种 Gram 归一化方式下的「同源对齐」与「跨模态对齐」：
  A 全矩阵 mean_abs（缺失行是 0，会被放大）—— 修复前的实现
  B 有效行子矩阵 mean_abs —— 修复后的实现
  C 完全不归一化（对照）

指标：
  · 同源码距：同记录的文码 vs 音码（越小越好）
  · 音搜文 mAP：跨模态检索精度（主指标）
"""
import json
import os
import random
import sqlite3
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from app.engines.hashing import features as F              # noqa: E402
from app.engines.hashing import linalg                     # noqa: E402
from app.engines.hashing.cmfh import OnlineSupervisedCMFH  # noqa: E402

CORPUS = os.path.join(BACKEND, "data", "hashing", "real_corpus.db")
K = 64
LAMBDA = 0.6
TOP_K = 10


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


def load():
    conn = sqlite3.connect(CORPUS)
    conn.row_factory = sqlite3.Row
    recs = {r["record_id"]: json.loads(r["themes"] or "[]")
            for r in conn.execute("SELECT record_id, themes FROM records")}
    units = [dict(r) for r in conn.execute("SELECT * FROM units")]
    queries = [dict(r) for r in conn.execute("SELECT * FROM queries")]
    conn.close()
    return recs, units, queries


def build(records):
    """构造通道化特征（按维度分通道）+ 缺失视图。"""
    n = len(records)
    by_ch = {}
    for i, r in enumerate(records):
        for m in ("text", "audio"):
            if r.get(m) is None:
                continue
            dim = len(r[m])
            by_ch.setdefault((m, dim), {})[i] = r[m]
    feats = {}
    for (m, dim), rows in by_ch.items():
        vecs = [None] * n
        for i, v in rows.items():
            vecs[i] = v
        feats[f"{m}@{dim}"] = vecs
    return feats


def train_scaled(feats, sim, mode):
    """自建的 fit（可控归一化方式），复用 CMFH 的其余逻辑。"""
    import numpy as np
    m = OnlineSupervisedCMFH(code_length=K, lambda_s=LAMBDA)
    mods = list(feats.keys())
    n = len(sim)
    X = {k: [linalg.normalize_row(r) if r is not None else None
             for r in v] for k, v in feats.items()}
    G = [[0.0] * n for _ in range(n)]
    for k in mods:
        Gm = linalg.gram_masked(X[k])
        valid = [i for i in range(n) if X[k][i] is not None]
        if not valid:
            continue
        if mode == "A":
            gm = linalg.mean_abs(Gm) or 1.0
            for i in range(n):
                for j in range(n):
                    G[i][j] += Gm[i][j] / gm
        elif mode == "B":
            sub = [[Gm[i][j] for j in valid] for i in valid]
            gm = linalg.mean_abs(sub) or 1.0
            for i in valid:
                for j in valid:
                    G[i][j] += Gm[i][j] / gm
        else:  # C 不归一化
            for i in valid:
                for j in valid:
                    G[i][j] += Gm[i][j]
    g_mean = linalg.mean_abs(G) or 1.0
    s_mean = linalg.mean_abs(sim) or 1.0
    for i in range(n):
        for j in range(n):
            G[i][j] = G[i][j] / g_mean * s_mean + LAMBDA * sim[i][j]
    eig, vecs = linalg.symmetric_eig_largest(G, K)
    Uraw = [[vecs[k][i] for k in range(K)] for i in range(n)]
    B = [[1 if Uraw[i][k] >= 0 else -1 for k in range(K)] for i in range(n)]
    for k in mods:
        if X[k] is None:
            continue
        W = linalg.ridge_fit(X[k], B, ridge=0.1)
        if W is not None:
            m.W[k] = W
    m.B = B
    m.continuous = Uraw
    m.trained = True
    m.modalities = mods
    return m


def encode(model, vec, channel):
    u = model.encode_continuous({channel: list(vec)})
    return [1 if x >= 0 else 0 for x in u]


def evaluate(model, records, queries, recs, text_ch, audio_ch):
    """同源码距 + 音搜文 mAP。"""
    idx_of = {r["record_id"]: i for i, r in enumerate(records)}
    tcodes = [encode(model, r["text"], text_ch) if r.get("text") else None
              for r in records]
    acodes = [encode(model, r["audio"], audio_ch) if r.get("audio") else None
              for r in records]
    same = []
    for t, a in zip(tcodes, acodes):
        if t and a:
            same.append(sum(1 for x, y in zip(t, a) if x != y))
    aps = []
    for q in queries:
        if q.get("modality") != "audio":
            continue
        rid = q.get("record_id")
        if rid not in idx_of:
            continue
        i = idx_of[rid]
        if not acodes[i]:
            continue
        u = model.encode_continuous({audio_ch: list(records[i]["audio"])})
        s = [x if x >= 0 else -1 for x in u]
        scored = []
        for j, tc in enumerate(tcodes):
            if not tc:
                continue
            v = [x if x >= 0 else -1 for x in tc]
            scored.append((sum(a * b for a, b in zip(s, v)), j))
        scored.sort(key=lambda x: -x[0])
        ranked = [records[j]["record_id"] for _s, j in scored[:TOP_K]]
        th = _norm(q.get("themes"))

        def rel(x, own=rid, t=th):
            if x == own:
                return False
            return _jac(t, recs.get(x) or []) >= 0.5
        hits = 0
        total = 0.0
        for i2, x in enumerate(ranked, 1):
            if rel(x):
                hits += 1
                total += hits / i2
        n_rel = sum(1 for x in ranked if rel(x))
        aps.append(total / min(n_rel, TOP_K) if n_rel else 0.0)
    return (sum(same) / len(same) if same else 0), \
           (sum(aps) / len(aps) if aps else 0), len(aps)


def main():
    recs, units, queries = load()
    by_rec = {}
    for u in units:
        by_rec.setdefault(u["record_id"], {})[u.get("modality")] = u
    records = []
    for rid, v in by_rec.items():
        tu, au = v.get("text"), v.get("audio")
        if not tu or not au:
            continue
        tf = F.semantic_feature(tu.get("content") or "")
        af = au.get("feature")
        if not af:
            continue
        if isinstance(af, str):
            af = json.loads(af)
        records.append({"record_id": rid, "tags": recs.get(rid) or [],
                        "text": list(tf), "audio": list(af)})
    n = len(records)
    sim = [[_jac(records[i]["tags"], records[j]["tags"]) for j in range(n)]
           for i in range(n)]
    for i in range(n):
        sim[i][i] = 1.0
    feats = build(records)
    print(f"记录 {n} 条，通道：{ {k: sum(1 for v in vs if v is not None) for k, vs in feats.items()} }")
    print(f"（text@531 覆盖 {sum(1 for v in feats['text@531'] if v is not None)}，"
          f"audio@64 覆盖 {sum(1 for v in feats['audio@64'] if v is not None)}）\n")

    print(f"{'归一化方式':<22}{'同源码距':>12}{'音搜文mAP':>12}{'查询数':>10}")
    print("-" * 58)
    for mode, label in (("A", "A 全矩阵mean_abs(旧)"),
                        ("B", "B 有效行子矩阵(新)"),
                        ("C", "C 不归一化")):
        m = train_scaled(feats, sim, mode)
        d, mp, nq = evaluate(m, records, queries, recs, "text@531", "audio@64")
        print(f"{label:<22}{d:>12.2f}{mp:>12.4f}{nq:>10}")
        print(f"    通道尺度: " + ", ".join(
            f"{k}: Gram 均值 {linalg.mean_abs(linalg.gram_masked([linalg.normalize_row(x) if x is not None else None for x in v])):.5f}"
            for k, v in feats.items()))


if __name__ == "__main__":
    main()
