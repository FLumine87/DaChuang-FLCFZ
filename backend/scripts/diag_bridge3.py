"""诊断桥接码空间是否真的学到了文-图对齐。

对比三个距离：
1. 同主题记录对（文码 vs 图码）—— 应该小
2. 不同主题记录对（文码 vs 图码）—— 应该大
3. 同记录内 文码 vs 文码 —— 作为参照

如果 1 和 2 差不多，说明桥接没学到跨模态对齐（只是各自聚类）。
"""
import json
import os
import random
import sys

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
conn.close()

by = {}
for u in units:
    by.setdefault(u.get("record_id"), {})[u.get("modality")] = u

rows = []
for rid, v in by.items():
    tu, iu = v.get("text"), v.get("image")
    if not tu or not iu:
        continue
    ip = iu.get("media_path")
    if not ip or not os.path.exists(ip):
        continue
    _enc = FerEncoder()
    if_ = _enc.feature(ip) if _enc.available else RF.image_feature(ip)
    if if_ is None:
        continue
    rows.append({"record_id": rid,
                 "text_feature": list(F.semantic_feature(tu.get("content") or "")),
                 "image_feature": list(if_), "tags": recs.get(rid) or []})

rng = random.Random(42)
train_rows = rng.sample(rows, 3000)

br = ImageTextBridge(code_length=64, lambda_s=0.6)
br.fit(train_rows)
print(f"训练完成，{len(br.units)} 单元\n")

# 收集训练集内的码
codes = {}
for uid, m in br.units.items():
    codes[uid] = m["code"]
tags_of = {rid: r["tags"] for rid, r in
           ((x["record_id"], x) for x in train_rows)}


def jac(a, b):
    a, b = set(a or []), set(b or [])
    u = a | b
    return len(a & b) / len(u) if u else 0.0


def ham(a, b):
    return sum(1 for x, y in zip(a, b) if x != y)


rids = [r["record_id"] for r in train_rows]
print("【码距离诊断】（越接近 32 说明两码越不相似）")
print("  同记录 文码 vs 图码（应该小）")
same_rec = []
for rid in rids[:800]:
    t, i = codes.get(f"{rid}-text"), codes.get(f"{rid}-image")
    if t and i:
        same_rec.append(ham(t, i))
if same_rec:
    print(f"    均值 {sum(same_rec)/len(same_rec):.2f}")

print("  同主题 不同记录 文码 vs 图码（应该比上面略大）")
same_theme = []
pairs = 0
for a in range(min(len(rids), 400)):
    for b in range(a + 1, min(len(rids), 400)):
        ra, rb = rids[a], rids[b]
        ta, tb = tags_of.get(ra), tags_of.get(rb)
        if jac(ta, tb) >= 0.5:
            t, i = codes.get(f"{ra}-text"), codes.get(f"{rb}-image")
            if t and i:
                same_theme.append(ham(t, i))
                pairs += 1
        if pairs >= 800:
            break
if same_theme:
    print(f"    均值 {sum(same_theme)/len(same_theme):.2f}  （{len(same_theme)} 对）")

print("  不同主题 文码 vs 图码（应该大）")
diff_theme = []
pairs = 0
for a in range(min(len(rids), 400)):
    for b in range(a + 1, min(len(rids), 400)):
        ra, rb = rids[a], rids[b]
        if jac(tags_of.get(ra), tags_of.get(rb)) == 0:
            t, i = codes.get(f"{ra}-text"), codes.get(f"{rb}-image")
            if t and i:
                diff_theme.append(ham(t, i))
                pairs += 1
        if pairs >= 800:
            break
if diff_theme:
    print(f"    均值 {sum(diff_theme)/len(diff_theme):.2f}  （{len(diff_theme)} 对）")

print("\n【对照】同模态距离")
print("  同主题 文码 vs 文码")
st = []
pairs = 0
for a in range(min(len(rids), 400)):
    for b in range(a + 1, min(len(rids), 400)):
        ra, rb = rids[a], rids[b]
        if jac(tags_of.get(ra), tags_of.get(rb)) >= 0.5:
            t1, t2 = codes.get(f"{ra}-text"), codes.get(f"{rb}-text")
            if t1 and t2:
                st.append(ham(t1, t2))
                pairs += 1
        if pairs >= 800:
            break
if st:
    print(f"    均值 {sum(st)/len(st):.2f}")
