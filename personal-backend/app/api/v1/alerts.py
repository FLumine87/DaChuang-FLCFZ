from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ...schemas.alerts import AlertCreate, AlertOut, AlertStatusUpdate
from ...services import alert_service

router = APIRouter(tags=["alerts"])


@router.get("/alerts", response_model=list[AlertOut])
def alerts_list(
    user_id: Optional[str] = None,
    level: Optional[str] = Query(default=None, pattern="^(orange|red)$"),
    status: Optional[str] = Query(default=None, pattern="^(pending|confirmed|processing|closed)$"),
) -> list[AlertOut]:
    return alert_service.list_alerts(user_id=user_id, level=level, status=status)


@router.get("/alerts/{alert_id}", response_model=AlertOut)
def alerts_get(alert_id: int) -> AlertOut:
    alert = alert_service.get_alert(alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail="预警不存在")
    return alert


@router.post("/alerts", response_model=AlertOut, status_code=201)
def alerts_create(body: AlertCreate) -> AlertOut:
    return alert_service.create_manual(body.user_id, body.level, body.title, body.reason)


@router.post("/alerts/{alert_id}/status", response_model=AlertOut)
def alerts_update_status(alert_id: int, body: AlertStatusUpdate) -> AlertOut:
    try:
        alert = alert_service.transition_status(alert_id, body.status)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if alert is None:
        raise HTTPException(status_code=404, detail="预警不存在")
    return alert
