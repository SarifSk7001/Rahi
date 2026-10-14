import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.tomtom import TomTomError, get_car_route

logger = logging.getLogger(__name__)

router = APIRouter()


class CarRouteRequest(BaseModel):
    start_lat: float = Field(..., ge=-90, le=90)
    start_lng: float = Field(..., ge=-180, le=180)
    end_lat: float = Field(..., ge=-90, le=90)
    end_lng: float = Field(..., ge=-180, le=180)


@router.post("/car-route")
async def car_route(req: CarRouteRequest):
    """Quickest direct car route with live traffic (TomTom)."""
    try:
        return await get_car_route(req.start_lat, req.start_lng, req.end_lat, req.end_lng)
    except TomTomError as exc:
        # Messages in TomTomError never contain the API key.
        logger.warning("Car routing failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from None
    except Exception:
        logger.exception("Unexpected error while planning car route")
        raise HTTPException(
            status_code=500,
            detail="Something went wrong while planning your car route.",
        ) from None
