"""定位「文搜图召回低」的根因：位带 LSH 的召回机制。

假设：查询码 u 是连续向量，符号化后与库端码有偏差；
而 bge 文本特征被压到 64 位后，文本码的位分布与图像码差异大，
导致位带探针命中率低（召回差），而非打分排序差。

验证方法：
1. 对比两种检索方式的候选数：
   - 位带 LSH（index.search，带 query_vec）
   - 暴力全扫描 + u·s 打分（不依赖位带）
2. 若暴力扫描的文搜图 mAP 明显高于 LSH → 根因是召回机制
"""
import json
import os
import random
import sys

BACKEND = r"D:\zwz\second\Dachuang\DaChuang-FLCFZ\backend"
sys.path.insert(0, BACKEND)

from app.engines.hashing import features as F              # noqa: E402
from app.engines.hashing.fer_encoder import FerEncoder      # noqa: E402
from app.engines.hashing.image_bridge import ImageTextBridge  # noqa: E402
import numpy as np  # noqa: E402
import sqlite3  # noqa: E402

CORPUS = os.path.join(BACKEND, "data", "hashing", "real_corpus.db")
conn = sqlite3.connect(CORPUS)
conn.row_factory = sqlite3.Row
recs = {r["record_id"]: json.loads(r["themes"] or "[]")
        for r in conn.execute("SELECT record_id, themes FROM records")}
units = [dict(r) for r in conn.execute(
    "SELECT * FROM units ORDER BY record_id, modality")]
queries = [dict(r) for r in conn.execute("SELECT * FROM queries")]
conn.close()

by = {}
for u in units:
    by.setdefault(u.get("record_id"), {})[u.get("modality")] = u

enc = FerEncoder()
rows = []
for rid, v in by.items():
    tu, iu = v.get("text"), v.get("image")
    if not tu or not iu:
        continue
    ip = iu.get("media_path")
    if not ip or not os.path.exists(ip):
        continue
    if_ = enc.feature(ip)
    if if_ is None:
        continue
    rows.append({"record_id": rid,
                 "text_feature": list(F.semantic_feature(tu.get("content") or "")),
                 "image_feature": list(if_), "tags": recs.get(rid) or []})

rng = random.Random(42)
train_rows = rng.sample(rows, 3000)
br = ImageTextBridge(code_length=64, lambda_s=0.6)
br.fit(train_rows)
print(f"桥接索引 {len(br.units)} 单元\n")


def jac(a, b):
    a, b = set(a or []), set(b or [])
    u = a | b
    return len(a & b) / len(u) if u else 0.0


def ap_at_k(ranked, rel, k=10):
    hits = 0
    total = 0.0
    for i, rid in enumerate(ranked[:k], 1):
        if rel(rid):
            hits += 1
            total += hits / i
    n_rel = sum(1 for rid in ranked if rel(rid))
    return total / min(n_rel, k) if n_rel else 0.0


# 预计算库端码（±1 约定）
lib = []
for uid, m in br.units.items():
    s = np.array([1.0 if c else -1.0 for c in m["code"]], dtype=np.float64)
    lib.append((uid, m["record_id"], m["modality"], s))
S = np.array([x[3] for x in lib])
print(f"库端 {len(lib)} 单元\n")


def brute_search(fv, qmod, rmod, top_k=30):
    """暴力全扫描 + u·s 打分（不依赖位带探针）。"""
    u = np.array(br.encode_query(fv, qmod), dtype=np.float64)
    scores = (S @ u) / len(u)
    idx = np.argsort(-scores)
    out = []
    for i in idx:
        uid, rid, mod, _ = lib[i]
        if mod != rmod:
            continue
        out.append({"record_id": rid, "score": float(scores[i])})
        if len(out) >= top_k:
            break
    return out


def lsh_search(fv, qmod, rmod, top_k=30):
    hits = br.search(fv, qmod, top_k=top_k, result_modality=rmod)
    return [{"record_id": h["record_id"], "score": h["sim"]} for h in hits]


for qmod, rmod in (("text", "image"), ("image", "text")):
    qs = [q for q in queries if q["modality"] == qmod]
    for name, fn in (("位带 LSH", lsh_search), ("暴力全扫描", brute_search)):
        aps = []
        for q in qs:
            if qmod == "text":
                fv = list(F.semantic_feature(q.get("text") or ""))
            else:
                p = q.get("media_path")
                if not p or not os.path.exists(p):
                    continue
                fv = enc.feature(p)
            hits = fn(fv, qmod, rmod)
            ranked, seen = [], set()
            for h in hits:
                rid = h["record_id"]
                if rid in seen:
                    continue
                seen.add(rid)
                ranked.append(rid)
            th = q.get("themes")
            if isinstance(th, str):
                th = json.loads(th)

            def rel(rid, own=q.get("record_id"), t=th):
                if rid == own:
                    return False
                return jac(t, recs.get(rid) or []) >= 0.5
            aps.append(ap_at_k(ranked, rel))
        m = sum(aps) / len(aps) if aps else 0
        print(f"  {qmod}→{rmod}  {name:<12} mAP@10 = {m:.4f}")
    print()

# 顺带看看：查询码符号化后的位分布 vs 库端码
print("【查询码符号化后的位分布对比】")
for qmod in ("text", "image"):
    qs = [q for q in queries if q["modality"] == qmod][:40]
    ones_q = []
    for q in qs:
        if qmod == "text":
            fv = list(F.semantic_feature(q.get("text") or ""))
        else:
            p = q.get("media_path")
            if not p or not os.path.exists(p):
                continue
            fv = enc.feature(p)
        u = br.encode_query(fv, qmod)
        bits = [1 if x >= 0 else 0 for x in u]
        ones_q.append(sum(bits))
    lib_ones = []
    for uid, m in br.units.items():
        if m["modality"] == qmod:
            lib_ones.append(sum(m["code"]))
    print(f"  {qmod}: 查询码 1 的个数均值 {sum(ones_q)/len(ones_q):.1f}/64　"
          f"库端码 1 的个数均值 {sum(lib_ones)/len(lib_ones):.1f}/64")
