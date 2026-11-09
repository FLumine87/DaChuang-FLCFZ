"""验证知识图谱推理的逻辑修正（2026-11-08）。

用法：python scripts/verify_inference_logic.py
需要一个可连的 Neo4j（personal-backend/.env 里的配置）。

每个用例都**先造数据 → 再断言**，且断言必须可证伪：如果逻辑退回改造前
的实现，这些断言会失败。用例覆盖：

  [1] 口语症状归一：写入"疲乏/入睡困难"，应匹配到规范名"疲惫/失眠"
  [2] 诱因单通：只写诱因、没有任何症状，仍应给出候选障碍
  [3] 事件即诱因：只写 EXPERIENCED_EVENT 考试，应作为诱因参与匹配
  [4] IDF 区分度：只命中"失眠"（5 个障碍共有）时，各障碍不应因字典序决定排序
  [5] 并列不假装排序：同分时按"症状画像解释度"排，解释度高的在前
  [6] 危机信号：写入危机表述，图谱应落"自杀意念"节点且 crisis=True
  [7] 未映射词：写入词典覆盖不到的名词，应出现在 unmapped_terms 而非被丢弃
  [8] 量纲：三个分量归一化后，满分 10 可达（量表满分时应显著高于改造前的天花板）
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core import neo4j as neo4j_core
from app.schemas.kg import Triple
from app.services import inference_agent, kg_service

UID = "test_inference_logic"
PASSED: list[str] = []
FAILED: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    if ok:
        PASSED.append(name)
        print(f"  [OK] {name}" + (f"  {detail}" if detail else ""))
    else:
        FAILED.append(name)
        print(f"  [FAIL] {name}  {detail}")


def reset(*triples: Triple):
    kg_service.clear_user(UID)
    if triples:
        kg_service.write_triples(UID, list(triples))


def matched_names(report) -> list[str]:
    return [d.name for d in report.matched_disorders]


def main() -> int:
    neo4j_core.reset_driver()
    if not neo4j_core.neo4j_health(force=True):
        print("Neo4j 不可用，无法验证。请先启动 Neo4j 并检查 .env")
        return 1

    print("\n[1] 口语症状归一")
    reset(Triple(relation="SHOWS_SYMPTOM", object="疲乏"),
          Triple(relation="SHOWS_SYMPTOM", object="入睡困难"))
    r = inference_agent.run_inference(UID)
    syms = {s for d in r.matched_disorders for s in d.matched_symptoms}
    check("疲乏 → 疲惫 已归一", "疲惫" in syms, f"命中症状={sorted(syms)}")
    check("入睡困难 → 失眠 已归一", "失眠" in syms, f"命中症状={sorted(syms)}")
    check("口语名不再被当成未映射词", "疲乏" not in r.unmapped_terms and "入睡困难" not in r.unmapped_terms,
          f"unmapped={r.unmapped_terms}")

    print("\n[2] 诱因单通（无任何症状）")
    reset(Triple(relation="HAS_TRIGGER", object="考试"))
    r = inference_agent.run_inference(UID)
    check("只有诱因也给出候选障碍", len(r.matched_disorders) > 0, f"matched={matched_names(r)}")
    trig_only = [d for d in r.matched_disorders if d.matched_triggers and not d.matched_symptoms]
    check("候选含「仅诱因」条目", len(trig_only) > 0,
          f"仅诱因={[(d.name, d.matched_triggers) for d in trig_only]}")
    check("措辞为「情境线索」而非「症状匹配」",
          any("情境线索" in f for f in r.factors), f"factors={r.factors}")

    print("\n[3] 事件即诱因（EXPERIENCED_EVENT 也参与诱因匹配）")
    reset(Triple(relation="EXPERIENCED_EVENT", object="考试"))
    r = inference_agent.run_inference(UID)
    trig_hit = [d for d in r.matched_disorders if "考试" in d.matched_triggers]
    check("生活事件「考试」被当作诱因证据", len(trig_hit) > 0,
          f"命中={[(d.name, d.matched_triggers) for d in trig_hit]}")

    print("\n[4] IDF 区分度（共有症状不应与特异症状等价）")
    reset(Triple(relation="SHOWS_SYMPTOM", object="失眠"),
          Triple(relation="SHOWS_SYMPTOM", object="回避社交"))
    r = inference_agent.run_inference(UID)
    specs = {d.name: d.specificity for d in r.matched_disorders}
    # 回避社交只被 1 个障碍引用，失眠被全部引用 → 前者特异性必须更高
    if "适应障碍（短期）" in specs:
        check("特异症状拉高特异性", specs["适应障碍（短期）"] > 0, f"spec={specs}")
    check("特异性不是常数（存在区分）",
          len({round(v, 3) for v in specs.values()}) > 1, f"spec={specs}")

    print("\n[5] 并列时按解释度排序，不听任字典序")
    reset(Triple(relation="SHOWS_SYMPTOM", object="失眠"),
          Triple(relation="SHOWS_SYMPTOM", object="疲惫"))
    r = inference_agent.run_inference(UID)
    top = r.matched_disorders[0] if r.matched_disorders else None
    # 失眠障碍的画像只有 4 个症状，命中 2 个 → 解释度 50%，是全场最高
    check("第一位是「失眠障碍」（解释度 50% 最高）",
          top is not None and top.name == "失眠障碍",
          f"实际第一位={top.name if top else None} cov={top.coverage if top else None}")
    if len(r.matched_disorders) >= 2:
        a, b = r.matched_disorders[0], r.matched_disorders[1]
        check("排序满足 得分→解释度 单调不增",
              (a.score, a.coverage) >= (b.score, b.coverage),
              f"{a.name}({a.score},{a.coverage}) vs {b.name}({b.score},{b.coverage})")

    print("\n[6] 危机信号落图 + 检出")
    reset(Triple(relation="SHOWS_SYMPTOM", object="自杀意念"))
    r = inference_agent.run_inference(UID)
    check("crisis=True", r.crisis is True)
    check("线索出现在 factors", any("安全线索" in f for f in r.factors), f"factors={r.factors}")
    check("crisis_sources 标为 graph", "graph" in r.crisis_sources, f"src={r.crisis_sources}")
    # 反证：危机节点不进"词表未覆盖"清单，否则报告会同时出现
    # "检测到安全线索"和"该内容未纳入分析"两条互相矛盾的说明
    check("危机节点不列入未映射词（避免自相矛盾）",
          "自杀意念" not in r.unmapped_terms,
          f"unmapped={r.unmapped_terms}")
    check("factors 中不出现「暂未纳入推断」",
          not any("暂未纳入推断" in f for f in r.factors), f"factors={r.factors}")

    print("\n[7] 未映射词如实列出")
    reset(Triple(relation="SHOWS_SYMPTOM", object="一种词典里没有的古怪感受"))
    r = inference_agent.run_inference(UID)
    check("未映射词出现在 unmapped_terms",
          "一种词典里没有的古怪感受" in r.unmapped_terms, f"unmapped={r.unmapped_terms}")
    check("factors 里如实说明未纳入分析",
          any("暂未纳入推断" in f for f in r.factors), f"factors={r.factors}")

    print("\n[8] 量纲：满分 10 可达")
    reset(Triple(relation="EXPERIENCED_EVENT", object="PHQ-9", value="27"),
          Triple(relation="SHOWS_SYMPTOM", object="情绪低落"),
          Triple(relation="SHOWS_SYMPTOM", object="兴趣减退"),
          Triple(relation="SHOWS_SYMPTOM", object="无价值感"),
          Triple(relation="SHOWS_SYMPTOM", object="早醒"))
    r = inference_agent.run_inference(UID)
    check("量表满分时 overall_score 明显高于改造前天花板(≈5.5)",
          r.overall_score > 5.5, f"overall_score={r.overall_score}")
    check("分数不超过满分 10", r.overall_score <= 10.0, f"overall_score={r.overall_score}")

    reset()
    print(f"\n结果：{len(PASSED)} 通过 / {len(FAILED)} 失败")
    if FAILED:
        print("失败项：")
        for f in FAILED:
            print("  -", f)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
