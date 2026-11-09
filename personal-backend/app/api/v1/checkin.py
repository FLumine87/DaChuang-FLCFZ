"""每日问询 + 兴趣推送 API（阶段 3.5）。

问询**不再定时**，改为「当天第一次打开 AI 陪伴对话页时自动弹出」（2026-11-07 调整）：

- POST /checkin/ensure?user_id=xxx          保证今天有一条问询并返回它
                                            （幂等，一天只生成一次；前端进聊天页时调用）
- GET  /checkin/daily?user_id=xxx           临时预览一条问询（**不落库**，调试/兜底用）
- GET  /checkin/daily/all                   触发一次全量问询（管理员调试用）
- GET  /checkin/pending?user_id=xxx         拉取该用户**待回复**的问询（前端聊天页入口）
- POST /checkin/{checkin_id}/reply          用户回复某条问询（标记已回复并保存原文）
- POST /checkin/{checkin_id}/decline        用户「不想回复」某条问询（pending → declined）
- GET  /checkin/history?user_id=xxx         问询历史（含已回复）
- GET  /recommendations/by_interest?user_id=xxx  纯兴趣驱动的内容推送（不依赖推理报告）

问询的持久化见 `services/checkin_service.py`：进聊天页时生成并落库，
本组接口负责把"待回复"的取出来给前端、把回复/拒绝写回去。
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from ...core.auth import assert_owns, require_admin, require_user
from ...core.neo4j import neo4j_health
from ...config import settings
from ...schemas.checkin import (
    CheckinDeclineRequest,
    CheckinPendingResponse,
    CheckinReplyRequest,
    CheckinReplyResponse,
    DailyCheckinEnsureResponse,
    DailyCheckinOut,
)
from ...schemas.inference import CopingRecommendation
from ...services import checkin_service, daily_checkin_agent, recommendation_agent
from ...services.llm_client import mock_mode

# 整个路由组统一要求登录（第 1 步）。逐个接口另做归属校验（第 3 步）。
router = APIRouter(tags=["daily-checkin"], dependencies=[Depends(require_user)])


@router.post("/checkin/ensure", response_model=DailyCheckinEnsureResponse)
def ensure_daily_checkin(
    user_id: str,
    force: bool = Query(default=False, description="忽略已有记录强制重生成（调试用）"),
    user: dict = Depends(require_user),
) -> DailyCheckinEnsureResponse:
    """登录触发「今日问询」，**一天只问询一次**。

    前端在用户进入个人端工作台时调用一次。语义是幂等的：

    - 今天已经有记录 → 直接返回它（`created=false`），不再调大模型，
      重复登录/刷新页面都不会重复生成，也不会重复消耗额度；
    - 今天还没有 → 生成一条落库（`created=true`），并把往日遗留的 pending
      置为 expired，避免"昨天没答的问题"一直挂在待回复列表里。

    Neo4j 不可用时返回 `checkin=null` + 空 message，前端据此退回静态兜底文案
    （不落库，避免把兜底文案混进真实问询记录）。
    """
    assert_owns(user, user_id, what="该用户的问询")
    if not settings.enable_daily_checkin:
        # 总开关关闭时不生成、不返回，前端静默不弹窗
        return DailyCheckinEnsureResponse(
            user_id=user_id,
            created=False,
            checkin=None,
            message="",
            neo4j_connected=neo4j_health(),
        )

    r = checkin_service.ensure_daily_checkin(user_id, force=force)
    return DailyCheckinEnsureResponse(
        user_id=user_id,
        created=bool(r.get("created")),
        checkin=r.get("checkin"),
        message=r.get("message") or "",
        expired=int(r.get("expired") or 0),
        neo4j_connected=neo4j_health(),
    )


@router.get("/checkin/daily")
def get_daily_checkin(user_id: str, user: dict = Depends(require_user)) -> dict:
    assert_owns(user, user_id, what="该用户的问询")
    """即时生成一条问询并返回（**不落库**，仅用于预览/兜底）。

    正常链路的问询由 `POST /checkin/ensure` 在登录时生成并落库，
    本接口不写库，重复调用会得到不同文案，**不应**被前端当作每日问询入口。
    """
    if not neo4j_health():
        return {"user_id": user_id, "message": "今天过得怎么样？有什么想聊的吗？😊", "neo4j_connected": False}
    interests = daily_checkin_agent.get_user_interests(user_id)
    msg = daily_checkin_agent.generate_checkin_message(user_id, interests)
    return {"user_id": user_id, "message": msg, "neo4j_connected": True}


@router.get("/checkin/daily/all")
def get_all_daily_checkins(user: dict = Depends(require_admin)) -> dict:
    """触发一次全量日常问询（返回所有用户的问询消息，管理员调试用）。

    与登录触发同一条生成链路：算完即落库，返回体额外带上本次新增的问询条数，
    便于确认"算出来的东西确实存下来了"，而不是只打了一行日志。

    这是**跨用户**接口（返回所有人的问询），因此不能只要求登录，
    必须要求 role == admin，否则任何人登录后都能读到全部用户的问询原文。
    """
    if not neo4j_health():
        return {"error": "Neo4j 未连接", "checkins": {}}
    result = daily_checkin_agent.run_daily_checkin()
    saved = checkin_service.save_checkins(result, source="manual")
    return {"count": len(result), "saved": saved, "checkins": result}


@router.post("/checkin/{checkin_id}/decline", response_model=CheckinReplyResponse)
def decline_checkin(checkin_id: int, body: CheckinDeclineRequest, user: dict = Depends(require_user)) -> CheckinReplyResponse:
    """用户明确「不想回复」某条问询：状态流转 pending → declined。

    与 `/reply` 的区别：不写任何回复正文（"不想回复"本身就是完整意思表示，
    不该往 reply 字段塞伪回复污染历史）。流转后：
      · 该条不再出现在待回复列表；
      · 今天的 ensure 复用这条且 status != pending → 前端当天不再弹窗。
    """
    assert_owns(user, body.user_id, what="该用户的问询")
    rows = checkin_service.list_all(user_id=body.user_id, limit=100)
    if not any(row.id == checkin_id for row in rows):
        # 归属校验：不允许改动他人的问询
        raise HTTPException(status_code=404, detail="问询不存在或不属于该用户")

    updated = checkin_service.mark_declined(checkin_id)
    if updated is None:
        raise HTTPException(status_code=409, detail="该问询已回复或已选择不想回复")

    return CheckinReplyResponse(
        checkin=updated,
        extracted=0,
        neo4j_connected=neo4j_health(),
        mock=mock_mode(),
    )


@router.get("/checkin/pending", response_model=CheckinPendingResponse)
def get_pending_checkins(
    user_id: str,
    limit: int = Query(default=5, ge=1, le=20),
    user: dict = Depends(require_user),
) -> CheckinPendingResponse:
    """拉取待回复的问询（前端进入聊天页时调用，也可轮询）。"""
    assert_owns(user, user_id, what="该用户的问询")
    rows = checkin_service.list_pending(user_id, limit=limit)
    return CheckinPendingResponse(
        user_id=user_id,
        pending=rows,
        count=len(rows),
        neo4j_connected=neo4j_health(),
    )


@router.get("/checkin/history", response_model=list[DailyCheckinOut])
def get_checkin_history(
    user_id: str,
    limit: int = Query(default=20, ge=1, le=100),
    user: dict = Depends(require_user),
) -> list[DailyCheckinOut]:
    """问询历史（含已回复），用于前端展示历史关怀记录与调试。"""
    assert_owns(user, user_id, what="该用户的问询")
    return checkin_service.list_all(user_id=user_id, limit=limit)


@router.post("/checkin/{checkin_id}/reply", response_model=CheckinReplyResponse)
def reply_checkin(checkin_id: int, body: CheckinReplyRequest, user: dict = Depends(require_user)) -> CheckinReplyResponse:
    """用户回复某条问询：只做**状态流转**（pending → replied）并保存回复原文。

    这里**不**抽取三元组、不写图谱。理由：前端在用户发出这条消息时本来就会调
    `/kg/extract`，若本接口再抽一次，同一条文本会写两遍图谱、`cnt` 频次翻倍，
    "多聊了几次"的权重就被重复计数污染了。图谱写入统一由 `/kg/extract` 一条
    路径负责 —— 无论回复来自聊天框还是每日问询，进图谱的方式完全一致。

    返回值里的 `extracted` 恒为 0，仅保留字段以兼容调用方。
    """
    assert_owns(user, body.user_id, what="该用户的问询")
    rows = checkin_service.list_all(user_id=body.user_id, limit=100)
    if not any(row.id == checkin_id for row in rows):
        # 归属校验：不允许回复他人的问询
        raise HTTPException(status_code=404, detail="问询不存在或不属于该用户")

    updated = checkin_service.mark_replied(checkin_id, body.reply)
    if updated is None:
        raise HTTPException(status_code=409, detail="该问询已回复")

    return CheckinReplyResponse(
        checkin=updated,
        extracted=0,
        neo4j_connected=neo4j_health(),
        mock=mock_mode(),
    )


@router.get("/recommendations/by_interest", response_model=list[CopingRecommendation])
def get_interest_feed(
    user_id: str,
    response: Response,
    limit: int = 4,
    user: dict = Depends(require_user),
) -> list[CopingRecommendation]:
    """纯兴趣驱动的内容推送（日常问询后、绿级稳定期使用）。

    Neo4j 不可用时：Mock 模式返回仓库内置的通用内容（每条 reason 都写明
    "演示模式"，非个性化），真实模式仍然返回空列表。响应体保持原有的数组结构
    不变，另加 X-Mock-Mode 头，方便调用方在不破坏契约的前提下识别演示模式。
    """
    assert_owns(user, user_id, what="该用户的推送")
    items = recommendation_agent.build_feed_from_interests(user_id, limit)
    response.headers["X-Mock-Mode"] = "true" if mock_mode() else "false"
    return items
