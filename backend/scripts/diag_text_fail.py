"""定位「结果模态为 text」的格子全崩的原因。

现象：文搜文 0.0101 / 音搜文 0.0184 / 图搜文 0.0403，其余格子正常。

查三件事：
  1. text 单元的码是否正常（不是全 0、不是全相同）
  2. 查询码与 text 单元码的汉明距离分布（检索是否根本没匹配上）
  3. text 通道的 W 是否正常（维度、是否全 0）
"""
import os
import sys

BACKEND = r"D:\zwz\second\Dachuang\DaChuang-FLCFZ\backend"
sys.path.insert(0, BACKEND)

from app.engines import get_hashing_engine      # noqa: E402
from app.engines.hashing import features as F   # noqa: E402
from collections import Counter                # noqa: E402

e = get_hashing_engine()
e._do_initialize()

print("=== 1) 各通道的 W ===")
for k, v in (e.model.W or {}).items():
    flat = [x for row in v for x in row]
    zero = sum(1 for x in flat if x == 0)
    print(f"  {k:<14} {len(v)}×{len(v[0])}  全零比例 {zero / len(flat):.1%}")

print()
print("=== 2) 库端各模态单元的码 ===")
for mod in ("text", "image", "audio"):
    codes = []
    for uid, m in e.units.items():
        if m.get("modality") == mod:
            codes.append(tuple(m.get("code") or []))
    if not codes:
        print(f"  {mod}: 无单元")
        continue
    uniq = len(set(codes))
    allz = sum(1 for c in codes if not any(c))
    allone = sum(1 for c in codes if all(x == 1 for x in c))
    ones = sum(sum(c) for c in codes) / max(len(codes), 1)
    print(f"  {mod:<6} {len(codes):>5} 个单元  唯一码 {uniq:>5}  "
          f"全0 {allz}  全1 {allone}  平均1的个数 {ones:.1f}/64")

print()
print("=== 3) 查询码 vs 库端 text 单元的汉明距离 ===")
from app.engines.hashing import real_features as RF  # noqa: E402
import sqlite3  # noqa: E402

conn = sqlite3.connect(os.path.join(BACKEND, "data", "hashing", "real_corpus.db"))
conn.row_factory = sqlite3.Row
qs = [dict(r) for r in conn.execute(
    "SELECT * FROM queries WHERE modality='text' LIMIT 20")]
conn.close()

text_codes = [tuple(m.get("code") or []) for m in e.units.values()
              if m.get("modality") == "text"]
for q in qs[:3]:
    feat = e._to_primary_channel(
        {"text": list(F.semantic_feature(q.get("text") or ""))})
    ch = list(feat.keys())[0]
    code = e.model.encode(feat)
    dists = sorted(sum(1 for a, b in zip(code, tc) if a != b) for tc in text_codes)
    print(f"  查询 {q['query_id']} 通道={ch}  "
          f"最近汉明 {dists[0]} 中位 {dists[len(dists)//2]} 最远 {dists[-1]}")

print()
print("=== 4) 走接口实测（文本查询，范围=文本）===")
import asyncio  # noqa: E402


async def go():
    for q in qs[:2]:
        hits, info = await e.search_with_info(
            q.get("text") or "", modality="text", top_k=5,
            modality_filter="text")
        print(f"  查询 {q['query_id']}: {len(hits)} 条  "
              f"route_candidates={info.get('candidates')}  "
              f"balanced={info.get('balanced')}")
        for h in hits[:3]:
            print(f"      {h.get('record_id')}  sim={h.get('score')}  "
                  f"mod={h.get('modality')}")
        print(f"      info keys: {sorted(info.keys())[:8]}")


asyncio.run(go())
