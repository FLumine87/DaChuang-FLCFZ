"""日常问询 + 兴趣推送 API（阶段 3.5）。

- GET  /checkin/daily?user_id=xxx      获取当前用户的个性化日常问询消息
- GET  /checkin/daily/all               触发一次全量问询（管理员调试用）
- GET  /recommendations/by_interest?user_id=xxx  纯兴趣驱动的内容推送（不依赖推理报告）
"""

from fastapi import APIRouter, Response

from ...core.neo4j import neo4j_health
from ...schemas.inference import CopingRecommendation
from ...services import daily_checkin_agent, recommendation_agent
from ...services.llm_client import mock_mode

router = APIRouter(tags=["daily-checkin"])


@router.get("/checkin/daily")
def get_daily_checkin(user_id: str) -> dict:
    """获取指定用户的个性化日常问询消息（不写入图谱，仅返回消息内容）。"""
    if not neo4j_health():
        return {"user_id": user_id, "message": "今天过得怎么样？有什么想聊的吗？😊", "neo4j_connected": False}
    interests = daily_checkin_agent.get_user_interests(user_id)
    msg = daily_checkin_agent.generate_checkin_message(user_id, interests)
    return {"user_id": user_id, "message": msg, "neo4j_connected": True}


@router.get("/checkin/daily/all")
def get_all_daily_checkins() -> dict:
    """触发一次全量日常问询（返回所有用户的问询消息，管理员调试用）。"""
    if not neo4j_health():
        return {"error": "Neo4j 未连接", "checkins": {}}
    result = daily_checkin_agent.run_daily_checkin()
    return {"count": len(result), "checkins": result}


@router.get("/recommendations/by_interest", response_model=list[CopingRecommendation])
def get_interest_feed(user_id: str, response: Response, limit: int = 4) -> list[CopingRecommendation]:
    """纯兴趣驱动的内容推送（日常问询后、绿级稳定期使用）。

    Neo4j 不可用时：Mock 模式返回仓库内置的通用内容（每条 reason 都写明
    "演示模式"，非个性化），真实模式仍然返回空列表。响应体保持原有的数组结构
    不变，另加 X-Mock-Mode 头，方便调用方在不破坏契约的前提下识别演示模式。
    """
    items = recommendation_agent.build_feed_from_interests(user_id, limit)
    response.headers["X-Mock-Mode"] = "true" if mock_mode() else "false"
    return items
