from typing import Literal, Optional

from pydantic import BaseModel, Field

# 允许的关系类型（与本体设计一一对应）
Relation = Literal[
    "LIKES",               # 喜欢某兴趣（音乐/歌手/运动/影视/游戏等）
    "FOLLOWS",             # 关注某赛事/资讯话题
    "EXPERIENCED_EMOTION", # 经历某情绪（value 为 1-10 强度）
    "SHOWS_SYMPTOM",       # 表现出某症状
    "EXPERIENCED_EVENT",   # 经历某生活事件
    "HAS_TRIGGER",         # 某诱因会触发负面情绪
    "RESPONDS_TO",         # 尝试过某应对方式（value 为 有效/无效/未知）
]


class Triple(BaseModel):
    relation: Relation
    object: str = Field(min_length=1, description="对象名，如 民谣 / NBA / 失眠")
    value: Optional[str] = Field(default=None, description="强度分值或有效性标记")
    category: Optional[str] = Field(default=None, description="兴趣类别，如 音乐/体育/影视")


class ExtractRequest(BaseModel):
    user_id: str = Field(min_length=1)
    text: str = Field(min_length=1, description="用户对话/动态文本")


class ExtractResponse(BaseModel):
    user_id: str
    triples: list[Triple]
    written: int = Field(description="成功写入 Neo4j 的三元组数量")
    neo4j_connected: bool
    mock: bool = Field(default=False, description="是否处于 Mock（演示）模式，前端据此如实标注")


class TriplesRequest(BaseModel):
    user_id: str
    triples: list[Triple]


# 允许写入的量表名（与推理 Agent 的 scale_scores 查询对应）
ALLOWED_SCALES = ("PHQ-9", "GAD-7", "SCL-90", "ISI", "PSS-10")


class ScaleScoreRequest(BaseModel):
    user_id: str = Field(min_length=1)
    scale: str = Field(min_length=1, description="量表名，如 PHQ-9 / GAD-7 / SCL-90")
    score: float = Field(ge=0, description="量表原始总分")
    max_score: Optional[float] = Field(default=None, description="量表满分，用于归一化；缺省按 27")
    run_inference: bool = Field(default=False, description="写入后是否自动触发推理")


class ScaleScoreResponse(BaseModel):
    user_id: str
    scale: str
    score: float
    written: int
    neo4j_connected: bool
    inference_triggered: bool
    report: Optional[dict] = Field(default=None, description="若触发推理则返回报告概览")
    mock: bool = Field(default=False, description="是否处于 Mock（演示）模式，前端据此如实标注")


class GraphNode(BaseModel):
    id: str
    name: str
    label: str  # User / Interest / Emotion / Symptom / LifeEvent / Trigger / Coping
    category: Optional[str] = None  # Interest 的类别（音乐/体育赛事等）


class GraphLink(BaseModel):
    source: str
    target: str
    relation: str
    category: Optional[str] = None  # 边上的属性（如 EXPERIENCED_EMOTION 的强度）


class GraphResponse(BaseModel):
    user_id: str
    nodes: list[GraphNode]
    links: list[GraphLink]
    neo4j_connected: bool
    mock: bool = Field(default=False, description="是否处于 Mock（演示）模式，前端据此如实标注")


def coerce_triples(raw: list[dict]) -> list["Triple"]:
    """容错解析：跳过字段缺失或 relation 非法的元素。"""
    triples = []
    for item in raw:
        try:
            triples.append(Triple(**{k: v for k, v in item.items() if v is not None}))
        except Exception:
            continue
    return triples
