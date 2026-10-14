import zlib
from typing import Any, Dict, List, Optional, Tuple

from app.models.schemas import (
    VALID_USER_TYPES,
    NavigationRequest,
    RouteMetrics,
    ScoredRoute,
)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
# Day weights (sum to 100). Night mode replaces these with NIGHT_WEIGHTS.
BASE_WEIGHTS: Dict[str, float] = {
    "heat": 30,
    "shade": 20,
    "traffic": 15,
    "walking_condition": 15,
    "water": 10,
    "emergency": 10,
}

# Night-safe weights — lighting, active people, and police matter most.
# Heat/shade are irrelevant at night; traffic is still a hazard.
NIGHT_WEIGHTS: Dict[str, float] = {
    "lighting": 35,
    "active_places": 20,
    "traffic": 15,
    "walking_condition": 10,
    "police": 10,
    "emergency": 10,
}

# Each profile scales the base weights.
PROFILE_MULTIPLIERS: Dict[str, Dict[str, float]] = {
    "normal":        {"heat": 1.0, "shade": 1.0, "traffic": 1.0, "walking_condition": 1.0, "water": 1.0, "emergency": 1.0},
    "elderly":       {"heat": 1.3, "shade": 1.2, "traffic": 1.2, "walking_condition": 1.5, "water": 1.3, "emergency": 1.6},
    "child":         {"heat": 1.3, "shade": 1.2, "traffic": 1.6, "walking_condition": 1.0, "water": 1.2, "emergency": 1.2},
    "accessibility": {"heat": 1.0, "shade": 1.0, "traffic": 1.2, "walking_condition": 2.0, "water": 1.0, "emergency": 1.3},
    "fitness":       {"heat": 1.0, "shade": 0.6, "traffic": 1.0, "walking_condition": 0.5, "water": 1.0, "emergency": 0.6},
}

# Night profile multipliers (only factors that exist in NIGHT_WEIGHTS)
NIGHT_PROFILE_MULTIPLIERS: Dict[str, Dict[str, float]] = {
    "normal":        {"lighting": 1.0, "active_places": 1.0, "traffic": 1.0, "walking_condition": 1.0, "police": 1.0, "emergency": 1.0},
    "elderly":       {"lighting": 1.3, "active_places": 1.2, "traffic": 1.2, "walking_condition": 1.5, "police": 1.5, "emergency": 1.6},
    "child":         {"lighting": 1.5, "active_places": 1.3, "traffic": 1.6, "walking_condition": 1.0, "police": 1.5, "emergency": 1.2},
    "accessibility": {"lighting": 1.2, "active_places": 1.0, "traffic": 1.2, "walking_condition": 2.0, "police": 1.2, "emergency": 1.3},
    "fitness":       {"lighting": 1.0, "active_places": 0.8, "traffic": 1.0, "walking_condition": 0.5, "police": 0.8, "emergency": 0.6},
}

PROFILE_LABELS: Dict[str, str] = {
    "normal":        "walkers",
    "elderly":       "elderly walkers",
    "child":         "children",
    "accessibility": "accessibility-focused walkers",
    "fitness":       "fitness walkers",
}

TRAFFIC_SCORES = {"Low": 100, "Medium": 55, "High": 15}

SHADE_COOLING_C = 3.0   # max perceived cooling from full shade
HEAT_HIGH_C    = 38.0   # apparent temperature at/above which risk is "High"
HEAT_MEDIUM_C  = 31.0   # ... and "Medium"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _jitter(route: Dict[str, Any]) -> float:
    """Stable pseudo-random value in [-1, 1] derived from the route geometry."""
    coords = route["coordinates"]
    mid = coords[len(coords) // 2]
    key = f"{route['kind']}:{mid[0]:.3f},{mid[1]:.3f}"
    return (zlib.crc32(key.encode()) % 2001) / 1000 - 1


def estimate_route_features(route: Dict[str, Any], shortest_km: float) -> Dict[str, Any]:
    """
    Estimate shade, traffic, water and emergency access for a route.

    NOTE: this is a SIMULATED fallback, used only for fields that real
    OpenStreetMap data (osm_service) could not provide.

    The previous version gave *better* shade and *lower* traffic to longer
    routes, which caused the scorer to prefer a highway detour over shorter
    nearby lanes (the longer highway got rewarded with "Low traffic / 75% shade"
    while the shorter lane got "High traffic / 15% shade").

    Corrected model: all routes start from the same neutral baseline. The
    jitter still gives slight variation between candidates so they are not
    all identical, but length alone no longer buys shade or traffic bonuses.
    Water points and emergency facilities are kept as a mild length bonus
    because genuinely longer routes do pass more amenities on average.
    """
    ratio  = route["distance_km"] / shortest_km if shortest_km > 0 else 1.0
    # Small stable variation (±8 pts) so routes are not all identical,
    # but NOT correlated with length.
    jitter = _jitter(route) * 0.08

    # Shade: neutral 40% baseline ± jitter. No length bonus.
    shade = int(round(_clamp(40 + jitter * 100, 5, 75)))

    # Traffic: all routes default to Medium unless the jitter tips them.
    # A short route is not assumed to be busier than a longer one.
    traffic_val = 0.5 + jitter          # ~0.42 – 0.58
    if traffic_val >= 0.65:
        traffic = "Low"
    elif traffic_val <= 0.35:
        traffic = "High"
    else:
        traffic = "Medium"

    # Water / emergency: slight increase for longer routes (they pass more).
    extra = _clamp((ratio - 1) / 0.35, 0, 1)
    water  = int(round(extra * 2))
    has_em = extra >= 0.5

    return {
        "shade_percent":          shade,
        "traffic_exposure":       traffic,
        "water_points":           water,
        "has_emergency_facility": has_em,
        # Night-safety estimates: unknown without OSM data
        "lit_percent":            None,
        "open_places":            None,
        "has_police_nearby":      False,
    }


def _resolve_profile(req: NavigationRequest) -> str:
    profile = (req.user_type or "normal").strip().lower()
    return profile if profile in VALID_USER_TYPES else "normal"


def _build_weights(req: NavigationRequest) -> Tuple[Dict[str, float], str]:
    profile = _resolve_profile(req)

    if req.night_walk:
        mults = NIGHT_PROFILE_MULTIPLIERS[profile]
        weights = {key: NIGHT_WEIGHTS[key] * mults[key] for key in NIGHT_WEIGHTS}
        # Extra boost if user explicitly needs emergency proximity
        if req.need_emergency_proximity:
            weights["emergency"] *= 2
        if req.need_water_access:
            # water not in night weights but honour the request anyway
            weights["emergency"] *= 1.2
    else:
        mults = PROFILE_MULTIPLIERS[profile]
        weights = {key: BASE_WEIGHTS[key] * mults[key] for key in BASE_WEIGHTS}
        weights["shade"] *= 1.25 if req.prefer_shade else 0.5
        if req.need_water_access:
            weights["water"] *= 2
        if req.need_emergency_proximity:
            weights["emergency"] *= 2

    return weights, profile


def _heat_level(apparent_temp: float) -> str:
    if apparent_temp >= HEAT_HIGH_C:
        return "High"
    if apparent_temp >= HEAT_MEDIUM_C:
        return "Medium"
    return "Low"


def _factor_scores_day(
    features: Dict[str, Any], route_apparent: float, ratio: float, distance_km: float
) -> Dict[str, int]:
    """Score each daytime factor 0 (worst) → 100 (best).

    walking_condition uses a steeper penalty (×250) than before (×150) so a
    route that is even 20% longer scores noticeably worse on this factor,
    preventing the scorer from choosing a highway detour over a nearby lane
    just because the detour earns a slightly higher shade or traffic score.
    The extra distance penalty (per km beyond 1.5 km) is also raised from
    10 → 20 to further discourage long walks in hot conditions.
    """
    heat    = _clamp(100 - (route_apparent - 28) / 16 * 100, 0, 100)
    walking = _clamp(100 - (ratio - 1) * 250 - max(0.0, distance_km - 1.5) * 20, 0, 100)
    return {
        "heat":             int(round(heat)),
        "shade":            int(features["shade_percent"]),
        "traffic":          TRAFFIC_SCORES[features["traffic_exposure"]],
        "walking_condition": int(round(walking)),
        "water":            int(min(100, features["water_points"] * 40)),
        "emergency":        100 if features["has_emergency_facility"] else 25,
    }


def _factor_scores_night(
    features: Dict[str, Any], ratio: float, distance_km: float
) -> Dict[str, int]:
    """Score each night-safety factor 0 (worst) → 100 (best)."""
    # Same steeper penalty as day — a long dark route is worse, not better.
    walking = _clamp(100 - (ratio - 1) * 250 - max(0.0, distance_km - 1.5) * 20, 0, 100)

    # Lighting: use OSM lit_percent if available, else penalise (unknown = risky at night)
    lit = features.get("lit_percent")
    lighting_score = int(lit) if lit is not None else 20   # unknown → assume poorly lit

    # Active open places: each nearby open place adds safety (up to 5 = 100)
    places = features.get("open_places") or 0
    active_score = int(min(100, places * 20))

    return {
        "lighting":          lighting_score,
        "active_places":     active_score,
        "traffic":           TRAFFIC_SCORES[features["traffic_exposure"]],
        "walking_condition": int(round(walking)),
        "police":            100 if features.get("has_police_nearby") else 20,
        "emergency":         100 if features["has_emergency_facility"] else 25,
    }


def _weighted_score(factors: Dict[str, int], weights: Dict[str, float]) -> int:
    total = sum(weights.values())
    return int(round(sum(weights[k] * factors[k] for k in weights) / total))


def _capitalise(text: str) -> str:
    return text[:1].upper() + text[1:]


def _strengths_and_concerns_day(
    features: Dict[str, Any], heat_level: str
) -> Tuple[List[str], List[str]]:
    strengths: List[str] = []
    concerns:  List[str] = []

    if features["shade_percent"] >= 50:
        strengths.append(f"{features['shade_percent']}% shade cover")
    elif features["shade_percent"] < 30:
        concerns.append(f"little shade ({features['shade_percent']}%)")

    if features["traffic_exposure"] == "Low":
        strengths.append("low vehicle traffic")
    elif features["traffic_exposure"] == "High":
        concerns.append("heavy traffic")

    if features["water_points"] > 0:
        strengths.append(f"{features['water_points']} drinking-water stop(s)")
    else:
        concerns.append("no drinking-water stops")

    if features["has_emergency_facility"]:
        strengths.append("a medical facility nearby")
    else:
        concerns.append("no emergency facility nearby")

    if heat_level == "Low":
        strengths.append("lower heat exposure")
    elif heat_level == "High":
        concerns.append("high heat exposure")

    return strengths, concerns


def _strengths_and_concerns_night(
    features: Dict[str, Any]
) -> Tuple[List[str], List[str]]:
    strengths: List[str] = []
    concerns:  List[str] = []

    lit = features.get("lit_percent")
    if lit is not None:
        if lit >= 60:
            strengths.append(f"{lit}% of route is street-lit")
        elif lit < 30:
            concerns.append(f"poorly lit ({lit}% street lighting)")
    else:
        concerns.append("street lighting data unavailable")

    places = features.get("open_places") or 0
    if places >= 3:
        strengths.append(f"{places} open shops/cafes keep the street active")
    elif places == 0:
        concerns.append("no open places along this route at night")

    if features.get("has_police_nearby"):
        strengths.append("police station nearby")
    else:
        concerns.append("no police station within 800 m")

    if features["traffic_exposure"] == "Low":
        strengths.append("low vehicle traffic")
    elif features["traffic_exposure"] == "High":
        concerns.append("heavy traffic")

    if features["has_emergency_facility"]:
        strengths.append("medical facility nearby")

    return strengths, concerns


def _explain(
    strengths:     List[str],
    concerns:      List[str],
    is_best:       bool,
    label:         str,
    extra_km:      float,
    extra_min:     int,
    route_apparent: float,
    night_walk:    bool = False,
) -> str:
    context = "at night" if night_walk else f"about {route_apparent:.0f}°C on this route"

    if is_best:
        if strengths:
            text = f"Best match for {label}: {', '.join(strengths)}."
        else:
            text = f"Best available option for {label}, though conditions are tough."
        if concerns:
            text += f" Watch out for {', '.join(concerns)}."
        if extra_km > 0.05:
            text += f" Only +{extra_km:.1f} km / +{extra_min} min compared with the shortest route."
        if not night_walk:
            text += f" Feels like about {route_apparent:.0f}°C on this route."
        return text

    if strengths and concerns:
        return f"{_capitalise(', '.join(strengths))}, but {', '.join(concerns)}."
    if strengths:
        return f"{_capitalise(', '.join(strengths))}."
    if concerns:
        return f"Less safe {context}: {', '.join(concerns)}."
    return "Comparable conditions to the other routes."


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _merge_features(
    estimated: Dict[str, Any], measured: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    """Prefer measured OSM values field by field; keep estimates where measured is None."""
    if not measured:
        return estimated
    merged = dict(estimated)
    for key, value in measured.items():
        if value is not None:
            merged[key] = value
    return merged


def score_routes(
    routes:            List[Dict[str, Any]],
    weather:           Dict[str, Any],
    req:               NavigationRequest,
    measured_features: Optional[List[Dict[str, Any]]] = None,
) -> List[ScoredRoute]:
    """
    Score candidate routes and return ScoredRoute objects, exactly one recommended.

    In night_walk mode the scoring ignores heat/shade and instead weights
    street lighting, active open places and police proximity.
    """
    if not routes:
        return []

    if measured_features is not None and len(measured_features) != len(routes):
        measured_features = None

    weights, profile = _build_weights(req)
    label = PROFILE_LABELS[profile]
    night = req.night_walk

    shortest_km   = min(r["distance_km"] for r in routes) or 0.01
    shortest_time = min(r["time_min"]    for r in routes)
    apparent      = float(weather["apparent_temp"])
    humidity      = int(weather["humidity"])

    items: List[Dict[str, Any]] = []
    for index, route in enumerate(routes):
        features = _merge_features(
            estimate_route_features(route, shortest_km),
            measured_features[index] if measured_features else None,
        )

        route_apparent = apparent - features["shade_percent"] / 100 * SHADE_COOLING_C
        heat_level     = _heat_level(route_apparent)
        ratio          = route["distance_km"] / shortest_km

        factors = (
            _factor_scores_night(features, ratio, route["distance_km"])
            if night
            else _factor_scores_day(features, route_apparent, ratio, route["distance_km"])
        )

        items.append({
            "route":         route,
            "features":      features,
            "route_apparent": route_apparent,
            "heat_level":    heat_level,
            "factors":       factors,
            "score":         _weighted_score(factors, weights),
        })

    # Highest score wins; on a tie prefer the shorter route.
    best = max(
        range(len(items)),
        key=lambda i: (items[i]["score"], -items[i]["route"]["distance_km"]),
    )

    shortest_idx = min(range(len(items)), key=lambda i: items[i]["route"]["distance_km"])
    others = [i for i in range(len(items)) if i != shortest_idx]

    # Both are initialised unconditionally so the loop below can reference either
    # without risking an UnboundLocalError when switching between day and night mode.
    best_lit_idx = None
    shaded_idx = None

    if night:
        # In night mode the "best lit" route gets its own label instead of "Shaded".
        best_lit_idx = (
            max(others, key=lambda i: (items[i]["features"].get("lit_percent") or 0))
            if others else None
        )
    else:
        shaded_idx = (
            max(others, key=lambda i: items[i]["features"]["shade_percent"])
            if others else None
        )

    results: List[ScoredRoute] = []
    for idx, item in enumerate(items):
        route    = item["route"]
        features = item["features"]

        if idx == shortest_idx and idx == best:
            name = "Shortest & Safest Route" if not night else "Shortest & Safest Night Route"
        elif idx == shortest_idx:
            name = "Shortest Route"
        elif idx == best:
            name = "Safest Night Route" if night else "Safest Route"
        elif night and best_lit_idx is not None and idx == best_lit_idx and (features.get("lit_percent") or 0) >= 40:
            name = "Best Lit Route"
        elif not night and shaded_idx is not None and idx == shaded_idx and features["shade_percent"] >= 50:
            name = "Shaded Route"
        else:
            name = "Balanced Route"

        strengths, concerns = (
            _strengths_and_concerns_night(features)
            if night
            else _strengths_and_concerns_day(features, item["heat_level"])
        )

        explanation = _explain(
            strengths,
            concerns,
            is_best       = (idx == best),
            label         = label,
            extra_km      = route["distance_km"] - shortest_km,
            extra_min     = route["time_min"] - shortest_time,
            route_apparent = item["route_apparent"],
            night_walk    = night,
        )

        lit_pct  = features.get("lit_percent")
        cctv_cnt = features.get("cctv_count")
        metrics = RouteMetrics(
            distance_km            = route["distance_km"],
            time_min               = int(route["time_min"]),
            apparent_temp_c        = round(item["route_apparent"], 1),
            humidity_percent       = humidity,
            heat_risk_level        = item["heat_level"],
            shade_percent          = features["shade_percent"],
            traffic_exposure       = features["traffic_exposure"],
            water_points           = features["water_points"],
            has_emergency_facility = features["has_emergency_facility"],
            # Night fields
            lit_percent            = int(lit_pct) if lit_pct is not None else None,
            open_places            = features.get("open_places"),
            has_police_nearby      = bool(features.get("has_police_nearby", False)),
            cctv_count             = int(cctv_cnt) if cctv_cnt is not None else None,
        )

        results.append(ScoredRoute(
            route_id          = chr(ord("A") + idx),
            name              = name,
            coordinates       = route["coordinates"],
            elevation         = route.get("elevation", []),
            metrics           = metrics,
            safety_score      = item["score"],
            explanation       = explanation,
            is_recommended    = (idx == best),
            score_breakdown   = item["factors"],
        ))

    return results
