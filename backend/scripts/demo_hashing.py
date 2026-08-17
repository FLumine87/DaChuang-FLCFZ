"""
动态跨模态哈希引擎 · 运行验证脚本（无需 pytest / numpy）。

用法：
    cd backend
    python scripts/demo_hashing.py

会：① 初始化引擎（首次自动用合成演示集训练并持久化）；
     ② 用几条文本查询做跨模态检索并打印结果；
     ③ 校验编码产物为 K 位二值码；
     ④ 演示「增量写入新案例」后能否被检索到（动态哈希特性）。
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.engines.hashing.engine import DynamicCrossModalHashingEngine


async def main():
    eng = DynamicCrossModalHashingEngine()
    await eng.initialize()
    print(f"[init] 索引案例数 = {len(eng.index)}  码长 K = {eng.code_length}")

    queries = [
        ("我最近总是失眠早醒，白天没精神，对什么都提不起兴趣。", "text"),
        ("一想到要考试就心慌、坐立不安，总担心会出事。", "text"),
        ("觉得孤独，不愿见人，总是回避同学。", "text"),
        ("童年被欺负的经历总在噩梦里闪回，遇到冲突就害怕。", "text"),
    ]
    for q, mod in queries:
        res = await eng.search(q, mod, top_k=5)
        print(f"\nQUERY: {q}")
        for r in res:
            print(f"  {r['id']}  sim={r['similarity']:<4} "
                  f"[{r['alert_level']:<6}] {r['modality']:<11} "
                  f"{r['tags']} :: {r['summary'][:24]}")

    # 断言 1：语义相关检索可用（抑郁主题查询应召回含「抑郁」标签案例）
    r0 = await eng.search("兴趣缺失 绝望 自责 没有动力", "text", top_k=3)
    assert any("抑郁" in r["tags"] for r in r0), "语义/跨模态检索失败"
    print("\n[OK] 检索能返回语义相关案例")

    # 断言 2：编码产物为 K 位 0/1 码
    code = await eng.encode("失眠 早醒 情绪低落", "text")
    assert len(code) == eng.code_length and all(c in (0, 1) for c in code)
    print(f"[OK] encode 返回 {eng.code_length} 位二值码: {code[:16]}...")

    # 断言 3：增量写入（动态哈希）— 新案例无需重训即可被检索到
    await eng.index_case({
        "id": "CASE-NEW-001",
        "summary": "考研失利后持续兴趣缺失、自责绝望，夜里失眠早醒。",
        "tags": ["抑郁", "睡眠"],
        "alert_level": "red",
        "modality": "text",
        "date": "2026-02-01",
    })
    after = await eng.search("兴趣缺失 失眠 绝望", "text", top_k=5)
    assert any(c["id"] == "CASE-NEW-001" for c in after), "增量写入后无法检索到新案例"
    print("[OK] 增量写入的新案例可被立即检索（动态 / 无需重训）")

    print("\n全部校验通过 ✅")


if __name__ == "__main__":
    asyncio.run(main())
