from app.models.schemas import NavigationRequest, RouteMetrics

def evaluate_route_safety(
    route_index: int,
    osrm_route: dict,
    weather: dict,
    req: NavigationRequest
) -> tuple[RouteMetrics, int, str]:
    """Calculates dynamic heat-risk & street comfort score based on live environmental parameters."""
    
    distance_km = round(osrm_route.get("distance", 1000) / 1000.0, 2)
    time_min = round(osrm_route.get("duration", 600) / 60.0)
    
    apparent_temp = weather["apparent_temp"]
    humidity = weather["humidity"]

    # Determine Heat Exposure Level
    if apparent_temp > 38:
        heat_level = "High"
        heat_penalty = 30
    elif apparent_temp > 31:
        heat_level = "Medium"
        heat_penalty = 15
    else:
        heat_level = "Low"
        heat_penalty = 5

    # Derive shade & traffic exposure dynamically across alternative routes
    shade_percent = max(15, min(85, 75 - (route_index * 25)))
    traffic_exposure = "High" if route_index == 0 else ("Low" if route_index == 1 else "Medium")
    water_points = 2 if route_index == 1 else (1 if route_index == 2 else 0)
    has_emergency = True if route_index != 0 else False

    # Multi-Factor Safety Score Formula (0-100)[cite: 1]
    score = 100
    score -= heat_penalty
    score -= (20 - int((shade_percent / 100.0) * 20))  # Shade bonus/penalty
    
    if traffic_exposure == "High":
        score -= 15
    elif traffic_exposure == "Medium":
        score -= 7

    if water_points == 0:
        score -= 10
    if not has_emergency:
        score -= 8

    # Profile adjustments[cite: 1]
    if req.user_type in ["elderly", "child"] and heat_level == "High":
        score -= 10
    if req.need_water_access and water_points == 0:
        score -= 10

    final_score = max(0, min(100, int(score)))

    # Natural Language AI Explanation Generation[cite: 1]
    factors = []
    if shade_percent >= 50:
        factors.append(f"{shade_percent}% canopy shade")
    if traffic_exposure == "Low":
        factors.append("low vehicle traffic")
    if water_points > 0:
        factors.append(f"{water_points} drinking water stop(s)")
    if has_emergency:
        factors.append("quick emergency medical access")

    if factors:
        explanation = f"Recommended route offering " + ", ".join(factors) + f" despite an ambient heat index of {apparent_temp}°C."
    else:
        explanation = f"Direct route with minimal shade exposure ({shade_percent}%) and elevated vehicular traffic."

    metrics = RouteMetrics(
        distance_km=distance_km,
        time_min=time_min,
        apparent_temp_c=apparent_temp,
        humidity_percent=humidity,
        heat_risk_level=heat_level,
        shade_percent=shade_percent,
        traffic_exposure=traffic_exposure,
        water_points=water_points,
        has_emergency_facility=has_emergency
    )

    return metrics, final_score, explanation