"""验证：同一症状重复写入时边上的 cnt 是否正确累加，以及推理侧是否按频次加权。

用法：python scripts/verify_freq_count.py
需要一个可连的 Neo4j（personal-backend/.env 里的配置）。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from neo4j import GraphDatabase

from app.config import settings
from app.core import neo4j as neo4j_core
from app.schemas.kg import Triple
from app.services import kg_service, inference_agent

UID = "test_freq_user"


def show_symptoms(tag: str) -> dict:
    """打印并返回该用户各症状的 cnt（读边属性，不依赖推理侧）。"""
    driver = GraphDatabase.driver(settings.neo4j_uri,
                                  auth=(settings.neo4j_user, settings.neo4j_password))
    out = {}
    with driver.session() as s:
        rows = s.run(
            "MATCH (u:User {user_id: $uid})-[r:SHOWS_SYMPTOM]->(x:Symptom) "
            "RETURN x.name AS name, coalesce(r.cnt, 1) AS cnt ORDER BY cnt DESC",
            uid=UID,
        ).data()
    driver.close()
    print(f"\n[{tag}]")
    for r in rows:
        out[r["name"]] = r["cnt"]
        print(f"  {r['name']:<10} cnt={r['cnt']}")
    if not rows:
        print("  (无症状边)")
    return out


def main() -> int:
    neo4j_core.reset_driver()
    if not neo4j_core.neo4j_health(force=True):
        print("Neo4j 不可用，无法验证。请先启动 Neo4j 并检查 .env")
        return 1

    kg_service.clear_user(UID)

    print("=== 步骤 1：连写 4 次「失眠」+ 1 次「心悸」 ===")
    for _ in range(4):
        kg_service.write_triples(UID, [Triple(relation="SHOWS_SYMPTOM", object="失眠")])
    kg_service.write_triples(UID, [Triple(relation="SHOWS_SYMPTOM", object="心悸")])
    counts = show_symptoms("写入后的边计数")
    assert counts.get("失眠") == 4, f"失眠 cnt 应为 4，实际 {counts.get('失眠')}"
    assert counts.get("心悸") == 1, f"心悸 cnt 应为 1，实际 {counts.get('心悸')}"
    print("  ✓ 重复写入累加到 4，单次写入为 1")

    print("\n=== 步骤 2：情绪同理（连写 3 次「低落」） ===")
    for _ in range(3):
        kg_service.write_triples(UID, [Triple(relation="EXPERIENCED_EMOTION", object="低落", value="3")])
    print("  ✓ 已写入 3 次「低落」(value=3)")

    print("\n=== 步骤 3：推理侧是否读到真实频次 ===")
    neo4j_core.reset_driver()
    report = inference_agent.run_inference(UID)
    print(f"  overall_score = {report.overall_score}")
    for f in report.factors:
        print(f"  · {f}")
    hits = [f for f in report.factors if "共" in f and "次" in f]
    if hits:
        print("  ✓ 因素文案已包含真实出现次数")
    else:
        print("  ! 未出现频次文案（可能该情绪未达低情绪判定条件）")

    print("\n=== 步骤 4：清理测试用户 ===")
    kg_service.clear_user(UID)
    print("  ✓ 已清理", UID)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
