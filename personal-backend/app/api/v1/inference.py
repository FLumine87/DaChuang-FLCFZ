from fastapi import APIRouter, HTTPException

from ...schemas.inference import InferenceRequest, InferenceRunResponse
from ...services import alert_service, recommendation_agent
from ...services.inference_agent import run_inference

router = APIRouter(tags=["inference"])


@router.post("/inference/run", response_model=InferenceRunResponse)
def inference_run(body: InferenceRequest) -> InferenceRunResponse:
    """心理状况推理 + 缓解推荐（阶段 3）。

    推理 Agent：聚合个人 KG + 对照领域 KG，输出结构化风险报告。
    橙/红级结果自动写入预警库（对接机构端预警管理）。
    轻中度（绿/黄/橙）时附带缓解推荐 Agent 生成的个性化内容推送。
    Neo4j 不可用时：Mock 模式走本地记录 + 模板通路（report.mock=True），
    其余情况仍然 503。
    """
    try:
        report = run_inference(body.user_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    # Mock 报告是模板产物，不能写进真实预警库（会把演示结果污染成待处理的预警）
    if report.risk_level in ("orange", "red") and not report.mock:
        alert_service.create_from_report(report)
        report.alert_created = True

    feed = recommendation_agent.build_recommendation_feed(report)
    return InferenceRunResponse(report=report, content_feed=feed)
