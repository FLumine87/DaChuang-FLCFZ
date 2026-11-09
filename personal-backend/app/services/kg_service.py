"""个人知识图谱写入与查询服务。

图模型：每个用户是一个以 (:User {user_id}) 为根的子图。
兴趣/症状等实体节点全局共享（同名同节点），用户通过带属性的边表达个人事实。

边上的 r.cnt 表示"该用户提及该对象的累计次数"：同一 (用户, 对象, 关系)
再次写入时不再新建边（MERGE 语义），而是把 cnt 加一。推理 Agent 的
"症状频次""情绪出现次数"都读这个计数——没有它，count(*) 恒为 1，
频次类权重会退化成"种类数"。

边上的 r.category 表示"该用户把这个兴趣归到哪个类别"。**类别只存边、不存节点**：
节点跨用户共享，写节点属性会被后写入的用户覆盖。读取侧统一用
`coalesce(r.category, n.category)`——优先取本用户的边，节点属性仅作
改造前历史数据的兜底。
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
ON CREATE SET r.cnt = 1
ON MATCH SET r.cnt = coalesce(r.cnt, 1) + 1
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
       coalesce(r.category, n.category) AS category,
       type(r) AS rel_type,
       r.value AS rel_value
"""


def _build_merge(relation: str) -> str:
    """按关系类型拼装写入语句。

    注意：category **只写边、不写节点**。叶子节点（Interest 等）是按名字全局
    MERGE 的（同名同节点、跨用户共享），若把 category 写到节点上，后写入的用户
    会覆盖前者的类别 —— 比如 A 把「周杰伦」标成「音乐」、B 标成「流行音乐」，
    节点属性只剩最后一次写入的值，A 的兴趣画像就被 B 的类别串改了。
    边是 per-user 的，把 category 放在边上才是"该用户对这个对象的归类"。
    """
    label, prop_keys = RELATION_SCHEMA[relation]
    set_lines = "\n".join(f"SET r.{k} = ${k}" for k in prop_keys)
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


def delete_node(user_id: str, name: str, label: str | None = None) -> int:
    """删除「该用户 → 该节点」的边，返回删除的边数。Neo4j 不可用时抛 RuntimeError。

    为什么只删边、不删节点：叶子节点是按 name 全局 MERGE 的、跨用户共享
    （见模块顶部注释）。A 删掉「失眠」，不能把 B 的失眠记录一起带走。
    用户要的是"这条记录从我的图谱里消失"，删边就是这个语义。

    为什么允许不传 label：图谱返回的节点 id 形如 `Interest:民谣`，但前端也可能
    只拿到名字（比如本机合并进来的节点）。不传 label 时按本体里所有标签逐个试，
    命中即删；这样名字相同的节点（理论上同名跨标签才会冲突）会被一并清理，
    对"删掉我图谱上的这个点"来说这正是期望行为。

    `DETACH DELETE` 不用在这里：边是 (u)-[r]->(n)，只删 r 即可，节点留着给其他用户。
    """
    if not neo4j_health():
        raise RuntimeError("Neo4j 未连接，请先启动 Neo4j 并配置 .env")

    labels = [label] if label else [lbl for lbl, _ in RELATION_SCHEMA.values()]
    labels = list(dict.fromkeys(labels))  # 去重且保序（Interest 出现两次，只留一个）
    driver = get_driver()
    deleted = 0
    with driver.session() as session:
        for lbl in labels:
            # 标签不能用参数（Cypher 不支持），这里的 lbl 只来自上面的白名单常量，
            # 不含用户输入，拼接是安全的（name 仍走参数，不受注入影响）。
            result = session.run(
                f"MATCH (u:User {{user_id: $user_id}})-[r]->(n:`{lbl}` {{name: $name}}) "
                "DELETE r RETURN count(r) AS c",
                user_id=user_id,
                name=name,
            )
            record = result.single()
            if record:
                deleted += int(record["c"] or 0)
    return deleted
