"""
SOS alert endpoints — replaces the localStorage-only prototype.
Alerts are stored in memory for this process lifetime. For production,
swap _alerts for a database (SQLite, PostgreSQL, etc.).
"""

import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(tags=["SOS"])

# In-memory store: { alert_id: dict }
_alerts: dict = {}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class SOSAlertCreate(BaseModel):
    station_id: str
    station_name: str
    station_state: str = "Unknown State"
    distance_km: float = Field(..., ge=0)
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    source: str = "device GPS"


class SOSAlertUpdate(BaseModel):
    status: str  # new | acknowledged | resolved


class SOSAlert(SOSAlertCreate):
    id: str
    status: str = "new"
    created_at: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/sos/alert", response_model=SOSAlert, status_code=201)
def create_alert(body: SOSAlertCreate):
    """Citizen app: fire a new SOS alert at the nearest station."""
    alert_id = f"sos-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f')}"
    alert = SOSAlert(
        **body.model_dump(),
        id=alert_id,
        status="new",
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    _alerts[alert_id] = alert.model_dump()
    logger.info("SOS alert %s created for station %s", alert_id, body.station_id)
    return alert


@router.get("/sos/alerts/{station_id}", response_model=List[SOSAlert])
def get_alerts(station_id: str):
    """Police dashboard: fetch all alerts for a given station, newest first."""
    station_alerts = [
        a for a in _alerts.values() if a["station_id"] == station_id
    ]
    station_alerts.sort(key=lambda a: a["created_at"], reverse=True)
    return station_alerts


@router.patch("/sos/alert/{alert_id}", response_model=SOSAlert)
def update_alert(alert_id: str, body: SOSAlertUpdate):
    """Police dashboard: acknowledge or resolve an alert."""
    alert = _alerts.get(alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found.")
    valid_statuses = ("new", "acknowledged", "resolved")
    if body.status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"status must be one of {valid_statuses}",
        )
    alert["status"] = body.status
    logger.info("SOS alert %s → %s", alert_id, body.status)
    return alert
