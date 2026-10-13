"""个人知识图谱写入与查询服务。

图模型：每个用户是一个以 (:User {user_id}) 为根的子图。
兴趣/症状等实体节点全局共享（同名同节点），用户通过带属性的边表达个人事实。
"""

import time

from ..core.neo4j import get_driver, neo4j_health
from ..schemas.kg import Triple

# 关系 -> (实体节点标签, 边属性字段)
RELATION_SCHEMA: dict[str, tuple[str, tuple[str, ...]]] = {
    "LIKES": ("Interest", ("category",)),
    "FOLLOWS": ("Interest", ("category",)),
    "EXPERIENCED_EMOTION": ("Emotion", ("value",)),
    "SHOWS_SYMPTOM": ("Symptom", ()),
    "EXPERIENCED_EVENT": ("LifeEvent", ("value",)),
    "HAS_TRIGGER": ("Trigger", ()),
    "RESPONDS_TO": ("Coping", ("value",)),
}

_MERGE_CYPHER = """
MERGE (u:User {user_id: $user_id})
ON CREATE SET u.created_at = $now
MERGE (n:__LABEL__ {name: $name})
MERGE (u)-[r:__RELATION__]->(n)
SET r.updated_at = $now
__SET_PROPS__
RETURN n.name AS name
"""

_CLEAR_CYPHER = """
MATCH (u:User {user_id: $user_id})-[r]-(n)
DELETE r
WITH u
DETACH DELETE u
"""

_SUBGRAPH_CYPHER = """
MATCH (u:User {user_id: $user_id})
OPTIONAL MATCH (u)-[r]-(n)
RETURN n.name AS name,
       labels(n) AS labels,
       n.category AS category,
       type(r) AS rel_type,
       r.value AS rel_value
"""


def _build_merge(relation: str) -> str:
    label, prop_keys = RELATION_SCHEMA[relation]
    set_lines = "\n".join(f"SET r.{k} = ${k}" for k in prop_keys)
    if "category" in prop_keys:
        # category 同时写到节点上，推理 Agent 按节点属性做兴趣匹配
        set_lines += "\nSET n.category = $category"
    return (
        _MERGE_CYPHER.replace("__LABEL__", label)
        .replace("__RELATION__", relation)
        .replace("__SET_PROPS__", set_lines)
    )


_MERGE_STATEMENTS = {rel: _build_merge(rel) for rel in RELATION_SCHEMA}


def write_triples(user_id: str, triples: list[Triple]) -> int:
    """将三元组写入个人 KG，返回写入数量。Neo4j 不可用时抛 RuntimeError。"""
    if not neo4j_health():
        raise RuntimeError("Neo4j 未连接，请先启动 Neo4j 并配置 .env")
    now = time.strftime("%Y-%m-%dT%H:%M:%S")
    driver = get_driver()
    written = 0
    with driver.session() as session:
        for t in triples:
            if t.relation not in RELATION_SCHEMA:
                continue
            params: dict = {
                "user_id": user_id,
                "name": t.object,
                "now": now,
            }
            label, prop_keys = RELATION_SCHEMA[t.relation]
            for k in prop_keys:
                params[k] = t.category if k == "category" else t.value
            session.run(_MERGE_STATEMENTS[t.relation], **params)
            written += 1
    return written


def get_subgraph(user_id: str) -> dict:
    """返回个人子图（节点+边），供前端图谱可视化。Neo4j 不可用时返回空图。

    Cypher 中显式 RETURN labels(n)/type(r)/r.value，不依赖驱动对节点对象的封装，
    兼容不同版本的 neo4j-python 驱动。
    """
    empty = {"nodes": [], "links": [], "neo4j_connected": False}
    if not neo4j_health():
        return empty
    driver = get_driver()
    with driver.session() as session:
        records = session.run(_SUBGRAPH_CYPHER, user_id=user_id).data()

    nodes: dict[str, dict] = {user_id: {"id": user_id, "name": user_id, "label": "User"}}
    links: list[dict] = []
    for rec in records:
        name = rec.get("name")
        rel_type = rec.get("rel_type")
        if not name or not rel_type:
            continue
        labels = rec.get("labels") or []
        label = labels[0] if labels else "Unknown"
        node_id = f"{label}:{name}"
        nodes[node_id] = {"id": node_id, "name": name, "label": label, "category": rec.get("category")}
        links.append({
            "source": user_id,
            "target": node_id,
            "relation": rel_type,
            "category": rec.get("rel_value"),
        })
    return {"nodes": list(nodes.values()), "links": links, "neo4j_connected": True}


def clear_user(user_id: str) -> None:
    if not neo4j_health():
        raise RuntimeError("Neo4j 未连接，请先启动 Neo4j 并配置 .env")
    with get_driver().session() as session:
        session.run(_CLEAR_CYPHER, user_id=user_id)
