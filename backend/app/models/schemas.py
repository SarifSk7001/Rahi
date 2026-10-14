from typing import Dict, List, Optional

from pydantic import BaseModel, Field

# Profiles the scoring engine understands.
# Anything else (for example the old "general" default) is treated as "normal".
VALID_USER_TYPES = ("normal", "elderly", "child", "accessibility", "fitness")


class NavigationRequest(BaseModel):
    """Single request model used by the /navigate endpoint (do not redefine it elsewhere)."""

    start_lat: float = Field(..., ge=-90, le=90)
    start_lng: float = Field(..., ge=-180, le=180)
    end_lat: float = Field(..., ge=-90, le=90)
    end_lng: float = Field(..., ge=-180, le=180)

    # normal, elderly, child, accessibility, fitness
    user_type: str = "normal"

    prefer_shade: bool = True
    need_water_access: bool = False
    need_emergency_proximity: bool = False

    # Night-safe walk mode — when True the scoring heavily weights
    # street lighting, active open places, and police proximity.
    night_walk: bool = False


class RouteMetrics(BaseModel):
    distance_km: float
    time_min: int
    apparent_temp_c: float
    humidity_percent: int
    heat_risk_level: str          # Low / Medium / High
    shade_percent: int
    traffic_exposure: str         # Low / Medium / High
    water_points: int
    has_emergency_facility: bool

    # Night-safety metrics (None when OSM has insufficient data)
    lit_percent: Optional[int] = None   # % of route under street lighting
    open_places: Optional[int] = None   # active shops/cafes/pharmacies nearby
    has_police_nearby: bool = False
    cctv_count: Optional[int] = None    # surveillance cameras within 40 m of route
    humidity_percent: int = 0           # already stored; exposed here for UI display


class ScoredRoute(BaseModel):
    route_id: str
    name: str
    coordinates: List[List[float]]  # [[lat, lng], ...] (Leaflet order)
    elevation: List[Optional[float]] = Field(default_factory=list)  # metres above sea level
    metrics: RouteMetrics
    safety_score: int  # 0-100
    explanation: str
    is_recommended: bool
    # "template" for the built-in text, "watsonx" when written by watsonx.ai.
    explanation_source: str = "template"
    # Per-factor scores (0-100) so the UI can show why a route scored the way it did.
    score_breakdown: Dict[str, int] = Field(default_factory=dict)


class NavigationResponse(BaseModel):
    city_weather: dict
    routes: List[ScoredRoute]
    # "openstreetmap" when real map data was used for route conditions,
    # otherwise "estimated".
    conditions_source: str = "estimated"
