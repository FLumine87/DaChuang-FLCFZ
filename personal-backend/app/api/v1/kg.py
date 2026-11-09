from fastapi import APIRouter, Depends, HTTPException

from ...core.auth import assert_owns, require_user
from ...core.neo4j import neo4j_health
from ...schemas.kg import (
    ALLOWED_SCALES,
    DeleteNodeRequest,
    DeleteNodeResponse,
    ExtractRequest,
    ExtractResponse,
    GraphResponse,
    ScaleScoreRequest,
    ScaleScoreResponse,
    Triple,
    TriplesRequest,
    coerce_triples,
)
from ...services import kg_service
from ...services.clinical_lexicon import CRISIS_CANONICAL, scan_crisis
from ...services.llm_client import extract_triples, mock_mode

# 整个路由组统一要求登录（第 1 步）。逐个接口另做归属校验（第 3 步）。
router = APIRouter(tags=["personal-kg"], dependencies=[Depends(require_user)])


@router.post("/kg/extract", response_model=ExtractResponse)
def kg_extract(body: ExtractRequest, user: dict = Depends(require_user)) -> ExtractResponse:
    """兴趣采集 Agent 入口：从用户文本抽取三元组并写入个人 KG。

    抽取阶段即使 Neo4j 未连接也会返回三元组（便于先验证抽取效果）；
    写入失败时 written=0 且 neo4j_connected=false。
    """
    assert_owns(user, body.user_id, what="该用户的图谱")
    try:
        raw = extract_triples(body.text)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    triples = coerce_triples(raw)
    # 安全兜底：在**原始文本**上直检危机信号。
    # 为什么不能只靠抽取结果：抽三元组是一次语义归一，"活着没意思"可能被
    # 归一成"无意义感"（不含任何危机关键词），下游 CRISIS_KEYWORDS 就永远漏检。
    # 实测（2026-11-08）真实 LLM 对"有时候觉得活着没意思"正是产出"无意义感"。
    # 安全信号不允许被一次可能失真的转换吃掉，所以在入口再直检一次。
    crisis_hits = scan_crisis(body.text)
    if crisis_hits and not any(t.object == CRISIS_CANONICAL for t in triples):
        triples.append(Triple(relation="SHOWS_SYMPTOM", object=CRISIS_CANONICAL))
    connected = neo4j_health()
    written = 0
    if connected and triples:
        try:
            written = kg_service.write_triples(body.user_id, triples)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc))
    return ExtractResponse(
        user_id=body.user_id,
        triples=triples,
        written=written,
        neo4j_connected=connected,
        mock=mock_mode(),
        crisis_hits=crisis_hits,
    )


@router.post("/kg/triples", response_model=ExtractResponse)
def kg_add_triples(body: TriplesRequest, user: dict = Depends(require_user)) -> ExtractResponse:
    """手动批量写入三元组（前端表单/量表数据回写等场景）。

    Mock 模式（演示/离线，通常也没起 Neo4j）下不再 503：返回 written=0 +
    neo4j_connected=false，让调用方拿到明确结果，而不是一个错误页面。
    真实模式（ENABLE_MOCK_ENGINES=False）仍然 503 —— 那是配置问题，不该被吞掉。
    """
    assert_owns(user, body.user_id, what="该用户的图谱")
    connected = neo4j_health()
    if not connected and not mock_mode():
        raise HTTPException(status_code=503, detail="Neo4j 未连接，请先启动 Neo4j 并配置 .env")
    written = kg_service.write_triples(body.user_id, body.triples) if connected else 0
    return ExtractResponse(
        user_id=body.user_id,
        triples=body.triples,
        written=written,
        neo4j_connected=connected,
        mock=mock_mode(),
    )


@router.post("/kg/scale", response_model=ScaleScoreResponse)
def kg_scale_score(body: ScaleScoreRequest, user: dict = Depends(require_user)) -> ScaleScoreResponse:
    """量表得分回写：Screening 页提交后自动写入个人 KG 供推理 Agent 使用。

    写入 (User)-[EXPERIENCED_EVENT {value: 得分}]->(:LifeEvent {name: 量表名})。
    量表名需在 ALLOWED_SCALES 白名单中；run_inference=True 时写入后立即触发推理。
    Mock 模式下 Neo4j 不可用也照样返回 200（written=0, neo4j_connected=false），
    推理走 Mock 通路出一份带 mock 标记的模板报告。
    """
    assert_owns(user, body.user_id, what="该用户的图谱")
    connected = neo4j_health()
    if not connected and not mock_mode():
        raise HTTPException(status_code=503, detail="Neo4j 未连接，请先启动 Neo4j 并配置 .env")
    if body.scale not in ALLOWED_SCALES:
        raise HTTPException(status_code=400, detail=f"量表「{body.scale}」不在支持列表 {list(ALLOWED_SCALES)}")

    written = 0
    if connected:
        triple = Triple(relation="EXPERIENCED_EVENT", object=body.scale, value=str(body.score))
        written = kg_service.write_triples(body.user_id, [triple])

    report = None
    inference_triggered = False
    if body.run_inference:
        from ...services.inference_agent import run_inference
        try:
            r = run_inference(body.user_id)
            report = {
                "risk_level": r.risk_level,
                "risk_label": r.risk_label,
                "overall_score": r.overall_score,
                "crisis": r.crisis,
                "mock": r.mock,
                "reference_only": r.reference_only,
                "source": r.source,
            }
            inference_triggered = True
        except RuntimeError:
            pass  # 推理失败不阻断写入响应

    return ScaleScoreResponse(
        user_id=body.user_id,
        scale=body.scale,
        score=body.score,
        written=written,
        neo4j_connected=connected,
        inference_triggered=inference_triggered,
        report=report,
        mock=mock_mode(),
    )


@router.get("/kg/graph/{user_id}", response_model=GraphResponse)
def kg_graph(user_id: str, user: dict = Depends(require_user)) -> GraphResponse:
    """获取用户个人子图，供前端可视化。

    Neo4j 不可用时**不再 503**：kg_service.get_subgraph 本身就优雅降级
    （返回空图 + neo4j_connected=false），端点原样透传 200。前端据此显示
    "图谱服务未连接，当前显示本地记录"，而不是把 503 的 JSON 糊在页面上。
    """
    assert_owns(user, user_id, what="该用户的图谱")
    graph = kg_service.get_subgraph(user_id)
    return GraphResponse(user_id=user_id, mock=mock_mode(), **graph)


@router.delete("/kg/users/{user_id}")
def kg_clear(user_id: str, user: dict = Depends(require_user)) -> dict:
    """清空某用户的个人子图（调试用）。"""
    assert_owns(user, user_id, what="该用户的图谱")
    connected = neo4j_health()
    if not connected:
        raise HTTPException(status_code=503, detail="Neo4j 未连接，请先启动 Neo4j 并配置 .env")
    kg_service.clear_user(user_id)
    return {"user_id": user_id, "cleared": True}


@router.post("/kg/node/delete", response_model=DeleteNodeResponse)
def kg_delete_node(body: DeleteNodeRequest, user: dict = Depends(require_user)) -> DeleteNodeResponse:
    """删除个人子图里的一个节点（实为"删这个用户到该节点的边"）。

    为什么用 POST 而不是 DELETE：node_id 形如 `Interest:民谣`，中文与冒号放进
    路径段需要额外编码，而且"按名字删"时前端可能只给名字。放 body 里最稳。

    语义（重要，见 schemas/DeleteNodeRequest 的注释）：叶子节点跨用户共享，
    这里**只删自己的边**，不会影响别的用户。本机（localStorage）里的那条三元组
    由前端自己删；服务端删成功与否都会如实回报 deleted 条数。

    Neo4j 未连接时不再 503：个人端当下是"本机记录为主"的降级态，
    前端仍要允许用户删掉本机的记录，这里回 deleted=0 + neo4j_connected=false
    让前端知道"服务端那条没删到"，而不是弹一个错误页。
    """
    assert_owns(user, body.user_id, what="该用户的图谱")
    connected = neo4j_health()
    name = body.node_id
    label = body.label
    # 支持 "Label:name" 形式：拆出标签，名字里本身可能带冒号，所以只按第一个冒号切
    if label is None and ":" in body.node_id:
        head, _, tail = body.node_id.partition(":")
        if tail:
            label, name = head, tail

    deleted = 0
    if connected:
        try:
            deleted = kg_service.delete_node(body.user_id, name, label)
        except RuntimeError:
            # 健康检查通过但写入瞬间掉线：当作未删除，如实回报
            connected = False

    return DeleteNodeResponse(
        user_id=body.user_id,
        node_id=body.node_id,
        deleted=deleted,
        neo4j_connected=connected,
        mock=mock_mode(),
    )
