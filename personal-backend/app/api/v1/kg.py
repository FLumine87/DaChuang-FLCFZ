from fastapi import APIRouter, HTTPException

from ...core.neo4j import neo4j_health
from ...schemas.kg import (
    ALLOWED_SCALES,
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
from ...services.llm_client import extract_triples, mock_mode

router = APIRouter(tags=["personal-kg"])


@router.post("/kg/extract", response_model=ExtractResponse)
def kg_extract(body: ExtractRequest) -> ExtractResponse:
    """兴趣采集 Agent 入口：从用户文本抽取三元组并写入个人 KG。

    抽取阶段即使 Neo4j 未连接也会返回三元组（便于先验证抽取效果）；
    写入失败时 written=0 且 neo4j_connected=false。
    """
    try:
        raw = extract_triples(body.text)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    triples = coerce_triples(raw)
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
    )


@router.post("/kg/triples", response_model=ExtractResponse)
def kg_add_triples(body: TriplesRequest) -> ExtractResponse:
    """手动批量写入三元组（前端表单/量表数据回写等场景）。

    Mock 模式（演示/离线，通常也没起 Neo4j）下不再 503：返回 written=0 +
    neo4j_connected=false，让调用方拿到明确结果，而不是一个错误页面。
    真实模式（ENABLE_MOCK_ENGINES=False）仍然 503 —— 那是配置问题，不该被吞掉。
    """
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
def kg_scale_score(body: ScaleScoreRequest) -> ScaleScoreResponse:
    """量表得分回写：Screening 页提交后自动写入个人 KG 供推理 Agent 使用。

    写入 (User)-[EXPERIENCED_EVENT {value: 得分}]->(:LifeEvent {name: 量表名})。
    量表名需在 ALLOWED_SCALES 白名单中；run_inference=True 时写入后立即触发推理。
    Mock 模式下 Neo4j 不可用也照样返回 200（written=0, neo4j_connected=false），
    推理走 Mock 通路出一份带 mock 标记的模板报告。
    """
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
def kg_graph(user_id: str) -> GraphResponse:
    """获取用户个人子图，供前端可视化。

    Neo4j 不可用时**不再 503**：kg_service.get_subgraph 本身就优雅降级
    （返回空图 + neo4j_connected=false），端点原样透传 200。前端据此显示
    "图谱服务未连接，当前显示本地记录"，而不是把 503 的 JSON 糊在页面上。
    """
    graph = kg_service.get_subgraph(user_id)
    return GraphResponse(user_id=user_id, mock=mock_mode(), **graph)


@router.delete("/kg/users/{user_id}")
def kg_clear(user_id: str) -> dict:
    """清空某用户的个人子图（调试用）。"""
    connected = neo4j_health()
    if not connected:
        raise HTTPException(status_code=503, detail="Neo4j 未连接，请先启动 Neo4j 并配置 .env")
    kg_service.clear_user(user_id)
    return {"user_id": user_id, "cleared": True}
