"""题库/预警的本地副本接口（**非权威源**）。

分工说明（重要）
----------------
心理预警的权威数据在**主服务端**（8000），由统一筛查规则判定后写入并在
管理端处置；本服务的图谱推理只输出参考（RiskReport.reference_only=True），
`run_inference` 里 risk_level 固定为 "unknown"，因此**不会**产生预警记录。

实测结果：本库 alerts 表恒为 0 条。前端「预警」页与「个性化推送」页的预警
数据均已改为读取 8000 的 `GET /api/personal/warnings`。

保留这组接口是为了：
  1. 兼容手工调试与手工建预警（POST /alerts 仍可用）；
  2. 给未来的"个人端本地草稿预警"留位置。

新增前端调用前请确认你要的是服务端权威预警还是本地记录，不要两者混用——
此前 FeedPage 读本地（恒空）、Alerts 页读服务端，导致同一概念两个数据源、
条数互相矛盾。
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from ...core.auth import assert_owns, require_user
from ...core.security import token_identities
from ...schemas.alerts import AlertCreate, AlertOut, AlertStatusUpdate
from ...services import alert_service

router = APIRouter(tags=["alerts"], dependencies=[Depends(require_user)])


@router.get("/alerts", response_model=list[AlertOut])
def alerts_list(
    user_id: Optional[str] = None,
    level: Optional[str] = Query(default=None, pattern="^(orange|red)$"),
    status: Optional[str] = Query(default=None, pattern="^(pending|confirmed|processing|closed)$"),
    user: dict = Depends(require_user),
) -> list[AlertOut]:
    """查预警列表。

    加鉴权前 `user_id` 可以不传 —— 不传就返回**所有用户**的预警。
    现在规则收紧：必须指定 user_id 且必须是本人的；只有管理员才能不传
    （看全部）。这样"忘传参数"不会再变成一次全量数据泄露。
    """
    if not user_id or not user_id.strip():
        if str(user.get("role") or "").lower() != "admin":
            raise HTTPException(status_code=403, detail="请指定用户；跨用户查询需要管理员权限")
        return alert_service.list_alerts(user_id=None, level=level, status=status)
    assert_owns(user, user_id, what="该用户的预警")
    return alert_service.list_alerts(user_id=user_id, level=level, status=status)


@router.get("/alerts/{alert_id}", response_model=AlertOut)
def alerts_get(alert_id: int, user: dict = Depends(require_user)) -> AlertOut:
    alert = alert_service.get_alert(alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail="预警不存在")
    # 单条预警靠 id 直取，没有 user_id 可以比对归属 —— 只能取出记录后
    # 拿它自己的 user_id 回比令牌身份。返回 404（而非 403）以免泄露
    # "这条 id 确实存在"这一信息。
    if str(user.get("role") or "").lower() != "admin" and alert.user_id not in token_identities(user):
        raise HTTPException(status_code=404, detail="预警不存在")
    return alert


@router.post("/alerts", response_model=AlertOut, status_code=201)
def alerts_create(body: AlertCreate, user: dict = Depends(require_user)) -> AlertOut:
    assert_owns(user, body.user_id, what="该用户的预警")
    return alert_service.create_manual(body.user_id, body.level, body.title, body.reason)


@router.post("/alerts/{alert_id}/status", response_model=AlertOut)
def alerts_update_status(alert_id: int, body: AlertStatusUpdate, user: dict = Depends(require_user)) -> AlertOut:
    """流转预警处置状态（pending → confirmed/processing/closed）。

    这是**管理端**动作：处置的是别人的预警，因此先判管理员、再查记录。
    顺序很关键：若先查存在性再判角色，普通用户就能靠 404/403 的差异
    枚举出「哪些预警 id 存在」，等于泄露了预警总量与他人的预警编号。
    现在非管理员一律 403，不泄露任何存在性信息。
    """
    if str(user.get("role") or "").lower() != "admin":
        raise HTTPException(status_code=403, detail="处置预警需要管理员权限")
    try:
        alert = alert_service.transition_status(alert_id, body.status)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if alert is None:
        raise HTTPException(status_code=404, detail="预警不存在")
    return alert
