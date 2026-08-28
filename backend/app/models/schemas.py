from pydantic import BaseModel
from typing import List, Optional

class NavigationRequest(BaseModel):
    start_lat: float
    start_lng: float
    end_lat: float
    end_lng: float
    user_type: str = "normal"  # normal, elderly, child, accessibility, fitness
    prefer_shade: bool = True
    need_water_access: bool = False
    need_emergency_proximity: bool = False

class RouteMetrics(BaseModel):
    distance_km: float
    time_min: int
    apparent_temp_c: float
    humidity_percent: int
    heat_risk_level: str
    shade_percent: int
    traffic_exposure: str
    water_points: int
    has_emergency_facility: bool

class ScoredRoute(BaseModel):
    route_id: str
    name: str
    coordinates: List[List[float]]  # GeoJSON [[lat, lng], ...]
    metrics: RouteMetrics
    safety_score: int
    explanation: str
    is_recommended: bool

class NavigationResponse(BaseModel):
    city_weather: dict
    routes: List[ScoredRoute]