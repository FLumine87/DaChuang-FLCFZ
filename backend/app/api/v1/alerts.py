from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from app.db.session import get_db
from app.core.responses import success_response, paginated_response
from app.schemas.alert import (
    AlertCreate,
    AlertUpdate,
    AlertResponse,
    AlertListResponse,
    AlertRuleCreate,
    AlertRuleUpdate,
    AlertRuleResponse,
    AlertStats,
)
from app.services.alert_service import AlertService

router = APIRouter()


@router.get("/rules")
async def list_alert_rules(db: Session = Depends(get_db)):
    service = AlertService(db)
    rules = service.get_all_rules()
    return success_response(data=[AlertRuleResponse.model_validate(r) for r in rules])


@router.post("/rules")
async def create_alert_rule(
    data: AlertRuleCreate,
    db: Session = Depends(get_db)
):
    service = AlertService(db)
    rule = service.create_rule(data)
    return success_response(data=AlertRuleResponse.model_validate(rule))


@router.put("/rules/{rule_id}")
async def update_alert_rule(
    rule_id: int,
    data: AlertRuleUpdate,
    db: Session = Depends(get_db)
):
    service = AlertService(db)
    rule = service.update_rule(rule_id, data)
    if not rule:
        raise HTTPException(status_code=404, detail="预警规则不存在")
    return success_response(data=AlertRuleResponse.model_validate(rule))


@router.delete("/rules/{rule_id}")
async def delete_alert_rule(
    rule_id: int,
    db: Session = Depends(get_db)
):
    service = AlertService(db)
    success = service.delete_rule(rule_id)
    if not success:
        raise HTTPException(status_code=404, detail="预警规则不存在")
    return success_response(message="删除成功")


@router.get("/stats")
async def get_alert_stats(db: Session = Depends(get_db)):
    service = AlertService(db)
    stats = service.get_stats()
    return success_response(data=stats)


@router.get("")
async def list_alerts(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    level: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db)
):
    service = AlertService(db)
    result = service.get_alerts(
        page=page,
        page_size=page_size,
        level=level,
        status=status,
    )
    return paginated_response(
        items=[AlertListResponse.model_validate(a) for a in result["items"]],
        total=result["total"],
        page=page,
        page_size=page_size,
    )


@router.post("")
async def create_alert(
    data: AlertCreate,
    db: Session = Depends(get_db)
):
    service = AlertService(db)
    alert = service.create_alert(data)
    return success_response(data=AlertResponse.model_validate(alert))


@router.get("/{alert_id}")
async def get_alert(
    alert_id: int,
    db: Session = Depends(get_db)
):
    service = AlertService(db)
    alert = service.get_alert_by_id(alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="预警记录不存在")
    return success_response(data=AlertResponse.model_validate(alert))


@router.put("/{alert_id}")
async def update_alert(
    alert_id: int,
    data: AlertUpdate,
    db: Session = Depends(get_db)
):
    service = AlertService(db)
    alert = service.update_alert(alert_id, data)
    if not alert:
        raise HTTPException(status_code=404, detail="预警记录不存在")
    return success_response(data=AlertResponse.model_validate(alert))


@router.post("/{alert_id}/resolve")
async def resolve_alert(
    alert_id: int,
    notes: str = "",
    db: Session = Depends(get_db)
):
    service = AlertService(db)
    alert = service.resolve_alert(alert_id, notes)
    if not alert:
        raise HTTPException(status_code=404, detail="预警记录不存在")
    return success_response(data=AlertResponse.model_validate(alert))
