import asyncio
import logging

from fastapi import APIRouter, HTTPException

from app.models.schemas import NavigationRequest, NavigationResponse
from app.services.osm_service import get_route_features
from app.services.routing_service import RoutingError, get_walking_routes
from app.services.scoring_service import score_routes
from app.services.watsonx_service import explain_recommendation
from app.services.weather_service import get_live_weather

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Navigation"])

# Start and end closer than this (in degrees, roughly 20 m) count as the same place.
SAME_PLACE_DEGREES = 0.0002

# How long to wait for OpenStreetMap data before answering with estimates.
OSM_TIMEOUT_SECONDS = 15

# How long to wait for watsonx.ai before keeping the built-in explanation.
AI_TIMEOUT_SECONDS = 10


async def _measure_routes(routes):
    """
    Real route conditions from OpenStreetMap, or None if unavailable or slow.
    Never raises. If the wait times out, the lookup keeps running in the
    background and caches its data, so repeating the same search is fast.
    """
    task = asyncio.ensure_future(get_route_features(routes))
    try:
        return await asyncio.wait_for(asyncio.shield(task), timeout=OSM_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        logger.warning("OpenStreetMap data too slow; using estimates for this request")
        return None
    except Exception:
        logger.exception("OpenStreetMap lookup failed; using estimates")
        return None


async def _add_ai_explanation(scored_routes, weather, user_type):
    """
    Replace the recommended route's explanation with a watsonx.ai one.
    Silently keeps the built-in text if watsonx is unconfigured, slow or failing.
    """
    try:
        text = await asyncio.wait_for(
            explain_recommendation(scored_routes, weather, user_type),
            timeout=AI_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.warning("watsonx.ai too slow; keeping built-in explanation")
        return
    except Exception:
        logger.exception("watsonx.ai step failed; keeping built-in explanation")
        return

    if text:
        for route in scored_routes:
            if route.is_recommended:
                route.explanation = text
                route.explanation_source = "watsonx"


@router.post("/navigate", response_model=NavigationResponse)
async def navigate(request: NavigationRequest):
    """
    Plan walking routes between two points and score them for heat, shade,
    traffic, water and emergency access.
    """
    if (
        abs(request.start_lat - request.end_lat) < SAME_PLACE_DEGREES
        and abs(request.start_lng - request.end_lng) < SAME_PLACE_DEGREES
    ):
        raise HTTPException(
            status_code=400,
            detail="Start and destination are the same place.",
        )

    # Weather is fetched for the middle of the trip, in parallel with routing.
    mid_lat = (request.start_lat + request.end_lat) / 2
    mid_lng = (request.start_lng + request.end_lng) / 2

    try:
        routes, weather = await asyncio.gather(
            get_walking_routes(
                start_lat=request.start_lat,
                start_lng=request.start_lng,
                end_lat=request.end_lat,
                end_lng=request.end_lng,
                night_walk=request.night_walk,
                user_profile=request.user_type,
            ),
            get_live_weather(mid_lat, mid_lng),
        )

        measured = await _measure_routes(routes)
        scored_routes = score_routes(routes, weather, request, measured)
        await _add_ai_explanation(scored_routes, weather, request.user_type)

    except RoutingError as error:
        logger.warning("Routing failed: %s", error)
        raise HTTPException(status_code=502, detail=str(error))

    except Exception:
        logger.exception("Unexpected error while planning route")
        raise HTTPException(
            status_code=500,
            detail="Something went wrong while planning your route.",
        )

    if not scored_routes:
        raise HTTPException(status_code=502, detail="No walking route found.")

    return NavigationResponse(
        city_weather={
            "temperature_c": weather["temp"],
            "apparent_temp_c": weather["apparent_temp"],
            "humidity_percent": weather["humidity"],
            "source": weather.get("source", "live"),  # live / cache / fallback
        },
        routes=scored_routes,
        conditions_source="openstreetmap" if measured else "estimated",
    )
