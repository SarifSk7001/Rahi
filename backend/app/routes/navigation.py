from fastapi import APIRouter, HTTPException
from app.models.schemas import NavigationRequest, NavigationResponse, ScoredRoute
from app.services.weather_service import get_live_weather
from app.services.routing_service import fetch_osrm_routes
from app.services.scoring_engine import evaluate_route_safety

router = APIRouter()

@router.post("/navigate", response_model=NavigationResponse)
async def get_safe_navigation(req: NavigationRequest):
    weather = await get_live_weather(req.start_lat, req.start_lng)
    osrm_routes = await fetch_osrm_routes(req.start_lat, req.start_lng, req.end_lat, req.end_lng)

    if not osrm_routes:
        raise HTTPException(status_code=400, detail="Could not calculate walking routes between coordinates.")

    scored_routes = []
    for idx, r in enumerate(osrm_routes):
        # OSRM returns coordinates as [lng, lat]; flip to [lat, lng] for frontend maps
        coords = [[pt[1], pt[0]] for pt in r["geometry"]["coordinates"]]
        
        metrics, score, explanation = evaluate_route_safety(idx, r, weather, req)
        
        route_name = "Green Canopy Walk" if idx == 1 else ("Standard Direct Way" if idx == 0 else "Parkside detour")
        
        scored_routes.append(ScoredRoute(
            route_id=chr(65 + idx),  # Route A, B, C...
            name=route_name,
            coordinates=coords,
            metrics=metrics,
            safety_score=score,
            explanation=explanation,
            is_recommended=False
        ))

    # Sort routes by safety score descending
    scored_routes.sort(key=lambda x: x.safety_score, reverse=True)
    if scored_routes:
        scored_routes[0].is_recommended = True

    return NavigationResponse(city_weather=weather, routes=scored_routes)