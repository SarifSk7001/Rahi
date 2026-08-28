from app.models.schemas import NavigationRequest, RouteMetrics

def evaluate_route_safety(
    route_index: int,
    osrm_route: dict,
    weather: dict,
    req: NavigationRequest
) -> tuple[RouteMetrics, int, str]:
    distance_km = round(osrm_route.get("distance", 1000) / 1000.0, 2)
    time_min = round(osrm_route.get("duration", 600) / 60.0)
    
    apparent_temp = weather["apparent_temp"]
    humidity = weather["humidity"]

    # 1. Assign distinct characteristics to each calculated route path
    if route_index == 0:
        # Direct main road path
        shade_percent = 20
        traffic_exposure = "High"
        water_points = 0
        has_emergency = False
    elif route_index == 1:
        # Shaded tree canopy detour
        shade_percent = 85
        traffic_exposure = "Low"
        water_points = 3
        has_emergency = True
    else:
        # Secondary street detour
        shade_percent = 50
        traffic_exposure = "Medium"
        water_points = 1
        has_emergency = True

    score = 70.0

    # 2. Dynamic scoring algorithm based on user safety profile
    if req.user_type == "fitness":
        # Fitness profile prioritizes speed & direct distance; minimizes shade weighting
        score += (30 - (distance_km * 10))
        if traffic_exposure != "High":
            score += 15
        if shade_percent < 40:
            score += 10  # Previews clear open-air route

    elif req.user_type in ["elderly", "child"]:
        # High-vulnerability profile heavily prioritizes shade, hydration, and low traffic
        score += (shade_percent * 0.4)
        score += (water_points * 8)
        if traffic_exposure == "High":
            score -= 35
        elif traffic_exposure == "Medium":
            score -= 15
        if not has_emergency:
            score -= 25
        if apparent_temp > 32:
            score -= (apparent_temp - 32) * 2

    else:
        # Standard balanced walking profile
        score += (shade_percent * 0.3)
        score += (water_points * 4)
        if traffic_exposure == "High":
            score -= 20
        elif traffic_exposure == "Medium":
            score -= 8

    final_score = max(0, min(100, int(score)))

    # 3. Dynamic Natural Language Explanation
    factors = []
    if req.user_type == "fitness":
        explanation = f"Fastest direct route ({distance_km} km, {time_min} mins) optimized for continuous fitness stride."
    elif req.user_type in ["elderly", "child"]:
        if shade_percent >= 50:
            factors.append(f"dense canopy shade ({shade_percent}%)")
        if water_points > 0:
            factors.append(f"{water_points} drinking water stops")
        if has_emergency:
            factors.append("emergency medical proximity")
        explanation = f"Vulnerable walker protection active: prioritized " + ", ".join(factors) + "."
    else:
        if shade_percent >= 50:
            factors.append(f"{shade_percent}% tree shade cover")
        if traffic_exposure == "Low":
            factors.append("low vehicle traffic")
        explanation = f"Balanced urban route providing " + ", ".join(factors) + f" at {apparent_temp}°C index."

    metrics = RouteMetrics(
        distance_km=distance_km,
        time_min=time_min,
        apparent_temp_c=apparent_temp,
        humidity_percent=humidity,
        heat_risk_level="High" if apparent_temp > 35 else ("Medium" if apparent_temp > 30 else "Low"),
        shade_percent=shade_percent,
        traffic_exposure=traffic_exposure,
        water_points=water_points,
        has_emergency_facility=has_emergency
    )

    return metrics, final_score, explanation