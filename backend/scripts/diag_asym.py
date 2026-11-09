"""诊断桥接里「文搜图 vs 图搜文」的不对称。

要回答三件事：
1. 索引覆盖率：桥接索引只有训练行的单元，未训练记录的相关记录召不回
   → 用「相关记录在索引内的比例」量化
2. 召回阶段 vs 排序阶段：候选没召回，还是召回了但排不上
3. 查询向量质量：查询码与同主题库码的距离分布
"""
import json
import os
import random
import sys
from collections import Counter

BACKEND = r"D:\zwz\second\Dachuang\DaChuang-FLCFZ\backend"
sys.path.insert(0, BACKEND)

from app.engines.hashing import features as F              # noqa: E402
from app.engines.hashing import real_features as RF         # noqa: E402
from app.engines.hashing.fer_encoder import FerEncoder      # noqa: E402
from app.engines.hashing.image_bridge import ImageTextBridge  # noqa: E402
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
indexed = set(br.records.keys())
print(f"桥接索引：{len(br.units)} 单元 / {len(br.records)} 记录")
print(f"全库记录：{len(recs)}\n")


def jac(a, b):
    a, b = set(a or []), set(b or [])
    u = a | b
    return len(a & b) / len(u) if u else 0.0


def relevant(rec_themes, exclude):
    """该主题在全库里的相关记录集合。"""
    return [rid for rid, t in recs.items()
            if rid != exclude and jac(rec_themes, t) >= 0.5]


print("【观测 1】索引覆盖率 —— 相关记录有多少在桥接索引里")
for qmod in ("text", "image"):
    qs = [q for q in queries if q["modality"] == qmod]
    tot_rel = cov_rel = 0
    for q in qs[:120]:
        th = q.get("themes")
        if isinstance(th, str):
            th = json.loads(th)
        rel = relevant(th, q.get("record_id"))
        tot_rel += len(rel)
        cov_rel += sum(1 for r in rel if r in indexed)
    print(f"  {qmod} 查询：相关记录共 {tot_rel}，其中在索引内 {cov_rel} "
          f"({cov_rel/max(tot_rel,1)*100:.1f}%)")

print("\n【观测 2】召回阶段 vs 排序阶段")
for qmod, rmod in (("text", "image"), ("image", "text")):
    qs = [q for q in queries if q["modality"] == qmod][:120]
    n_cand = n_rel_in_cand = n_hit = 0
    for q in qs:
        if qmod == "text":
            fv = list(F.semantic_feature(q.get("text") or ""))
        else:
            p = q.get("media_path")
            if not p or not os.path.exists(p):
                continue
            fv = enc.feature(p)
        hits = br.search(fv, qmod, top_k=30, result_modality=rmod,
                         exclude_record=q.get("record_id"))
        th = q.get("themes")
        if isinstance(th, str):
            th = json.loads(th)
        rel = set(relevant(th, q.get("record_id")))
        n_cand += len(hits)
        n_rel_in_cand += sum(1 for h in hits if h["record_id"] in rel)
        n_hit += sum(1 for h in hits[:10] if h["record_id"] in rel)
    print(f"  {qmod}→{rmod}：候选 {n_cand} 条中相关 {n_rel_in_cand} "
          f"({n_rel_in_cand/max(n_cand,1)*100:.1f}%)；top10 命中 {n_hit}")
    print(f"      若召回率低 → 索引覆盖问题；召回高但命中低 → 排序问题")

print("\n【观测 3】查询向量与同主题库码的距离（连续向量层面）")
import numpy as np  # noqa: E402
for qmod, rmod in (("text", "image"), ("image", "text")):
    qs = [q for q in queries if q["modality"] == qmod][:60]
    same, diff = [], []
    for q in qs:
        if qmod == "text":
            fv = list(F.semantic_feature(q.get("text") or ""))
        else:
            p = q.get("media_path")
            if not p or not os.path.exists(p):
                continue
            fv = enc.feature(p)
        u = np.array(br.encode_query(fv, qmod))
        th = q.get("themes")
        if isinstance(th, str):
            th = json.loads(th)
        for rid, meta in br.units.items():
            if meta.get("modality") != rmod:
                continue
            code = np.array(meta["code"])
            # u·s：库端 0/1 码转 ±1
            s = np.array([1.0 if c else -1.0 for c in code])
            score = float(u @ s) / len(u)
            if jac(th, recs.get(rid) or []) >= 0.5:
                same.append(score)
            elif jac(th, recs.get(rid) or []) == 0:
                diff.append(score)
    if same and diff:
        print(f"  {qmod}→{rmod}：同主题得分均值 {sum(same)/len(same):.4f} "
              f"(n={len(same)})")
        print(f"      不同主题得分均值 {sum(diff)/len(diff):.4f} (n={len(diff)})")
        print(f"      区分度（差值）: {sum(same)/len(same) - sum(diff)/len(diff):+.4f}")
