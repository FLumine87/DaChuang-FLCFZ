"""验证「图像退出配对训练」为什么让图像查询发生模态混淆。

三个观测：
1. 图像查询实际命中的是哪些模态的单元（模态混淆的直接证据）
2. 不同图像查询产生的查询向量是否几乎相同（区分度检查）
3. 图像单元的码与同记录文本码的相同比例（已知 100%，作为对照）

对照跑两组：
  D 组：HASHING_TRAIN_MODALITIES="text,audio"  （图像退出配对）
  A 组：HASHING_TRAIN_MODALITIES="text,image,audio"（队长原行为）
"""
import asyncio
import os
import sys
from collections import Counter

BACKEND = r"D:\zwz\second\Dachuang\DaChuang-FLCFZ\backend"
sys.path.insert(0, BACKEND)

from app.config import settings  # noqa: E402
from app.engines import get_hashing_engine  # noqa: E402

# 直接覆盖配置（不依赖 config.py 里是否有这两个开关，两个分支都能跑）
_mods = os.environ.get("HASHING_TRAIN_MODALITIES", "text,audio")
_feat = os.environ.get("HASHING_IMAGE_FEATURE", "hand")
settings.HASHING_TRAIN_MODALITIES = tuple(m.strip() for m in _mods.split(",") if m.strip())
settings.HASHING_IMAGE_FEATURE = _feat

engine = get_hashing_engine()
engine._do_initialize()

print(f"配置 HASHING_TRAIN_MODALITIES = {settings.HASHING_TRAIN_MODALITIES}")
print(f"模型 W 的模态 = {sorted((engine.model.W or {}).keys())}")
print()

# 取图像查询
import sqlite3  # noqa: E402
conn = sqlite3.connect(os.path.join(BACKEND, "data", "hashing", "real_corpus.db"))
conn.row_factory = sqlite3.Row
qs = [dict(r) for r in conn.execute(
    "SELECT * FROM queries WHERE modality='image' LIMIT 12")]
conn.close()
print(f"取 {len(qs)} 条图像查询\n")


async def main():
    hit_mod = Counter()
    top1_mod = Counter()
    qvecs = []

    for q in qs:
        path = q.get("media_path")
        if not path or not os.path.exists(path):
            continue
        feat = engine._extract_query_features("", "image", path)
        qv = engine.model.encode_continuous(feat)
        qvecs.append(list(qv))
        hits, _info = await engine.search_with_info(
            query="", modality="image", top_k=10,
            media_path=path, viewer=None,
        )
        for h in hits:
            hit_mod[h.get("modality")] += 1
        if hits:
            top1_mod[hits[0].get("modality")] += 1

    print("【观测 1】图像查询的命中单元模态分布")
    print(f"  top-10 全部命中: {dict(hit_mod)}")
    print(f"  top-1 命中模态: {dict(top1_mod)}")
    total = sum(hit_mod.values())
    if total:
        print(f"  文本单元占比: {hit_mod.get('text',0)/total*100:.1f}%")

    print("\n【观测 2】不同图像查询的查询向量区分度")
    if len(qvecs) >= 2:
        import numpy as np
        M = np.array(qvecs)
        norms = np.linalg.norm(M, axis=1)
        print(f"  查询向量范数: 均值 {norms.mean():.4f}  标准差 {norms.std():.4f}")
        # 两两余弦
        cos = []
        for i in range(min(len(M), 8)):
            for j in range(i + 1, min(len(M), 8)):
                a, b = M[i], M[j]
                den = np.linalg.norm(a) * np.linalg.norm(b)
                if den > 1e-9:
                    cos.append(float(a @ b / den))
        if cos:
            print(f"  图像查询之间两两余弦: 均值 {sum(cos)/len(cos):.4f}")
            print(f"  （越接近 1 说明查询向量越相似、区分度越低）")
        print(f"  向量维度: {M.shape}")

    print("\n【观测 3】图像单元码 vs 同记录文本码")
    by_rec = {}
    for uid, m in engine.units.items():
        if m.get("code"):
            by_rec.setdefault(m["record_id"], {})[m["modality"]] = list(m["code"])
    same = tot = 0
    for v in by_rec.values():
        if "image" in v and "text" in v:
            tot += 1
            if v["image"] == v["text"]:
                same += 1
    print(f"  相同: {same}/{tot} = {same/max(tot,1)*100:.1f}%")


asyncio.run(main())
