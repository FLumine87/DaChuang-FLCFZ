"""动态跨模态哈希检索：一键演示脚本。

覆盖四件事：
  1. 索引概览：来源、单元数、码长、时间窗哈希表质量（ρ 语义一致性 / σ 信息量 / 是否活跃）
  2. 文本 → 全模态检索（跨模态命中图像 / 语音单元）
  3. 文本 → 指定模态检索（只看图像线索 / 只看语音线索）
  4. 动态增量：新记录写入后立即可被检索，无需全量重训

用法（在 backend 目录下）：
    python scripts/demo_hashing.py
"""
import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.engines.hashing.engine import DynamicCrossModalHashingEngine  # noqa: E402

QUERIES = [
    ("抑郁", "最近提不起劲，什么都不想做，晚上躺很久都睡不着", None),
    ("焦虑", "心里发慌，总担心会出事，坐都坐不住", "image"),
    ("睡眠", "半夜老是醒，天没亮就醒了，白天一直犯困", "audio"),
]

NEW_CASE = {
    "id": "NEW-0001",
    "summary": "近两周情绪一直很低落，对以前喜欢的事完全没兴趣，总在自责。",
    "alert_level": "orange",
    "date": "2026-09-21",
    "modality": "text",
}


def show(hits, title):
    print(f"\n  【{title}】")
    if not hits:
        print("    （无结果）")
        return
    for h in hits:
        shared = ",".join(h["explain"]["shared_themes"]) or "-"
        print(f"    相似度 {h['similarity']:.3f} | {h['modality_label']:<2} | "
              f"{h['date']} | 主题[{shared}] 风险[{h['alert_level']}]")
        print(f"      {h['summary'][:52]}")


async def main():
    engine = DynamicCrossModalHashingEngine()

    t0 = time.time()
    await engine.initialize()
    print(f"索引初始化耗时 {time.time() - t0:.2f}s")

    st = engine.stats()
    print(f"\n=== 索引概览 ===")
    print(f"  数据来源 : {st['source']}")
    print(f"  记录/单元: {st['records']} 条记录 / {st['units']} 个模态单元")
    print(f"  码长     : {st['code_length']} 位，已训练模态 {st['trained_modalities']}")
    print(f"  模态分布 : {st['modalities']}")
    print(f"  时间窗   : {st['windows']}")
    print(f"  位带表   : {st['num_bands']} 张/窗口，保证汉明半径 {st['guaranteed_radius']} "
          f"（相似度 ≥ {st['guaranteed_similarity']}）内不漏召回")
    print("  时间窗表质量：")
    for t in st["tables"]:
        flag = "活跃" if t["active"] else "已淘汰"
        print(f"    窗口 {t['window']}: {t['size']:>4} 单元 | σ={t['sigma']:.3f} "
              f"| ρ={t['rho']:.3f} | {flag}")

    for name, q, mf in QUERIES:
        label = "全模态" if not mf else f"仅{'文本' if mf == 'text' else '图像' if mf == 'image' else '语音'}"
        t0 = time.time()
        hits, info = await engine.search_with_info(q, modality="text", top_k=5, modality_filter=mf)
        cost = (time.time() - t0) * 1000
        print(f"\n=== 查询[{name}] 检索范围[{label}] {cost:.0f}ms ===")
        print(f"  查询: {q}")
        print(f"  查询码 {info['query_code_hex']} | 命中主题 {info['query_themes']} "
              f"| 候选 {info['candidates']}/{info['index_size']} "
              f"| 探测桶 {info['keys_probed']} | 全量回退 {info['scanned_all']}")
        show(hits, "Top-5")

    print("\n=== 动态增量：新记录写入后立即可检索 ===")
    ok = engine.index_case_sync(NEW_CASE)
    hits, info = await engine.search_with_info(NEW_CASE["summary"], top_k=3)
    print(f"  写入结果: {ok} | 索引规模: {info['index_size']}")
    show(hits, "用新记录自己的文本反查")


if __name__ == "__main__":
    asyncio.run(main())