"""预警服务：推理 Agent 的橙/红级结果自动落库，并提供机构端处理接口。"""

import json
from typing import Optional

from ..db.database import SessionLocal
from ..db.models import Alert
from ..schemas.alerts import AlertOut
from ..schemas.inference import RiskReport

_STATUS_FLOW = {
    "pending": {"confirmed", "closed"},
    "confirmed": {"processing", "closed"},
    "processing": {"closed"},
    "closed": set(),
}


def create_from_report(report: RiskReport) -> Alert:
    alert = Alert(
        user_id=report.user_id,
        level=report.risk_level,
        title=f"用户 {report.user_id} 心理风险预警（{report.risk_label}）",
        reason="；".join(report.factors),
        evidence=report.model_dump_json(exclude={"summary"}),
        summary=report.summary,
    )
    with SessionLocal.begin() as session:
        session.add(alert)
        session.flush()
        session.refresh(alert)
        return alert


def create_manual(user_id: str, level: str, title: str, reason: str) -> Alert:
    alert = Alert(user_id=user_id, level=level, title=title, reason=reason)
    with SessionLocal.begin() as session:
        session.add(alert)
        session.flush()
        session.refresh(alert)
        return alert


def list_alerts(
    user_id: Optional[str] = None,
    level: Optional[str] = None,
    status: Optional[str] = None,
) -> list[AlertOut]:
    with SessionLocal() as session:
        q = session.query(Alert)
        if user_id:
            q = q.filter(Alert.user_id == user_id)
        if level:
            q = q.filter(Alert.level == level)
        if status:
            q = q.filter(Alert.status == status)
        rows = q.order_by(Alert.id.desc()).all()
        return [AlertOut.model_validate(r, from_attributes=True) for r in rows]


def get_alert(alert_id: int) -> Optional[AlertOut]:
    with SessionLocal() as session:
        row = session.get(Alert, alert_id)
        return AlertOut.model_validate(row, from_attributes=True) if row else None


def transition_status(alert_id: int, new_status: str) -> Optional[AlertOut]:
    with SessionLocal.begin() as session:
        row = session.get(Alert, alert_id)
        if row is None:
            return None
        allowed = _STATUS_FLOW.get(row.status, set())
        if new_status not in allowed and new_status != row.status:
            raise ValueError(f"状态不允许从 {row.status} 流转到 {new_status}")
        row.status = new_status
        session.flush()
        session.refresh(row)
        return AlertOut.model_validate(row, from_attributes=True)
