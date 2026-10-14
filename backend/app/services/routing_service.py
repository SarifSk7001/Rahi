import asyncio
import logging
import math
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

VALHALLA_URL = "https://valhalla1.openstreetmap.de/route"
REQUEST_TIMEOUT = 20.0
HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "X-Client-Id": "nagar-ai-coolwalk",
}

Point = Tuple[float, float]  # (lat, lng)

# Drop candidate routes longer than this multiple of the shortest one.
# 1.35 means a route can be at most 35% longer than the true shortest path.
# Previously 1.6 (60% longer) — that allowed ~900 m of extra walking on a
# 1.5 km trip, letting the scorer pick the highway over nearby lanes.
MAX_DETOUR_RATIO = 1.35

# Sideways push of the detour waypoint, as a fraction of the trip length.
DETOUR_RATIOS = (0.15, 0.3)

# Neutral pedestrian costing for the "pure shortest" request: no extra penalty
# for alleys, driveways, living streets or tracks. This always produces the
# true geometric shortest path regardless of day/night mode.
SHORTEST_OPTIONS = {
    "alley_factor": 1.0,
    "driveway_factor": 1.0,
    "use_living_streets": 1.0,
    "use_tracks": 1.0,
    "use_roads": 0.5,  # keep Valhalla's default road-carriageway preference
}

# Day-mode costing for the main + alternate requests.
# Explicitly unlocks all pedestrian surface types so Valhalla can use nearby
# lanes and living streets freely — without this, Valhalla's default 0.5
# penalty on living streets pushes it onto the nearest highway instead of
# the shorter lane network.
DAY_OPTIONS = {
    "alley_factor": 1.0,
    "driveway_factor": 1.0,
    "use_living_streets": 1.0,
    "use_tracks": 0.75,   # allow tracks but still mildly prefer proper paths
    "use_roads": 0.5,     # Valhalla default: prefer pavement over carriageway
}

# Walking speed (km/h) per user profile.
# Valhalla's pedestrian costing accepts walking_speed (default ~5.1 km/h).
PROFILE_WALKING_SPEED: Dict[str, float] = {
    "normal":        5.1,
    "elderly":       3.5,
    "child":         4.0,
    "accessibility": 3.0,
    "fitness":       6.5,
}

# Night-walk costing — strongly steer Valhalla away from quiet back-alleys,
# driveways and unmapped tracks; instead keep the walker on main/arterial roads
# that are better lit and have more passing traffic.
# use_roads=1.0 tells Valhalla to treat walking along a road carriageway as
# fully acceptable (default is 0.5 which prefers pavements/paths).
# alley_factor/driveway_factor > 1 make those surface types expensive.
# use_living_streets/use_tracks = 0 blocks unmapped back-streets entirely.
NIGHT_OPTIONS = {
    "alley_factor": 8.0,        # strongly avoid alleys
    "driveway_factor": 5.0,     # avoid driveways
    "use_living_streets": 0.1,  # near-avoid quiet residential lanes
    "use_tracks": 0.0,          # block unmapped tracks
    "use_roads": 1.0,           # fully accept walking along main road carriageways
    "sidewalk_factor": 1.0,     # keep sidewalks attractive
}


class RoutingError(Exception):
    """Raised when the routing service cannot produce a usable route."""


# ---------------------------------------------------------------------------
# Polyline decoding (Valhalla uses precision 6)
# ---------------------------------------------------------------------------

def decode_polyline6(encoded: str) -> List[List[float]]:
    """Decode a polyline6 string into [[lat, lng], ...]."""
    coordinates: List[List[float]] = []
    index = 0
    latitude = 0
    longitude = 0

    while index < len(encoded):
        # Latitude
        result = 0
        shift = 0
        while True:
            byte = ord(encoded[index]) - 63
            index += 1
            result |= (byte & 0x1F) << shift
            shift += 5
            if byte < 0x20:
                break
        latitude += -(result >> 1) if result & 1 else result >> 1

        # Longitude
        result = 0
        shift = 0
        while True:
            byte = ord(encoded[index]) - 63
            index += 1
            result |= (byte & 0x1F) << shift
            shift += 5
            if byte < 0x20:
                break
        longitude += -(result >> 1) if result & 1 else result >> 1

        coordinates.append([latitude / 1_000_000, longitude / 1_000_000])

    return coordinates


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _haversine_m(a: List[float], b: List[float]) -> float:
    """Distance in metres between two [lat, lng] points."""
    r = 6_371_000
    lat1, lng1 = math.radians(a[0]), math.radians(a[1])
    lat2, lng2 = math.radians(b[0]), math.radians(b[1])
    d_lat = lat2 - lat1
    d_lng = lng2 - lng1
    h = (
        math.sin(d_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(d_lng / 2) ** 2
    )
    return 2 * r * math.asin(math.sqrt(h))


def _sample(coords: List[List[float]], n: int) -> List[List[float]]:
    step = max(1, len(coords) // n)
    return coords[::step]


def _overlap_ratio(candidate: List[List[float]], existing: List[List[float]]) -> float:
    """Fraction of the candidate's points that lie within ~60 m of the existing route."""
    sample_a = _sample(candidate, 25)
    sample_b = _sample(existing, 150)
    close = sum(
        1
        for p in sample_a
        if any(_haversine_m(p, q) <= 60 for q in sample_b)
    )
    return close / len(sample_a)


def _via_point(
    start: Point, end: Point, side: int, ratio: float = 0.25
) -> Optional[Point]:
    """
    A waypoint beside the midpoint of the straight line start->end, pushed
    sideways (side = +1 left, -1 right) by `ratio` of the trip length.
    Forcing the route through it produces a genuinely different path.
    """
    mid_lat = (start[0] + end[0]) / 2
    mid_lng = (start[1] + end[1]) / 2
    cos_lat = math.cos(math.radians(mid_lat)) or 1e-6

    # Flat coordinates where one unit is roughly one degree of latitude.
    dx = (end[1] - start[1]) * cos_lat
    dy = end[0] - start[0]
    length = math.hypot(dx, dy)
    if length == 0:
        return None

    px, py = -dy / length, dx / length  # unit vector perpendicular to the trip
    offset = length * ratio * side

    return (mid_lat + py * offset, mid_lng + (px * offset) / cos_lat)


# ---------------------------------------------------------------------------
# Valhalla calls
# ---------------------------------------------------------------------------

def _payload(
    points: List[Point],
    alternates: int = 0,
    costing_options: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    locations = []
    last = len(points) - 1
    for i, (lat, lng) in enumerate(points):
        location: Dict[str, Any] = {"lat": lat, "lon": lng}
        if 0 < i < last:
            location["type"] = "through"  # pass through, don't stop/turn around
        locations.append(location)

    payload: Dict[str, Any] = {
        "locations": locations,
        "costing": "pedestrian",
        "units": "kilometers",
        "shape_format": "polyline6",
        "elevation_interval": 0,  # request elevation samples every ~30 m from Valhalla
    }
    if alternates > 0:
        payload["alternates"] = alternates
    if costing_options:
        payload["costing_options"] = {"pedestrian": costing_options}
    return payload


async def _post(client: httpx.AsyncClient, payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        response = await client.post(VALHALLA_URL, json=payload, headers=HEADERS)
        response.raise_for_status()
        return response.json()
    except httpx.TimeoutException as error:
        raise RoutingError(f"Routing service timeout: {error}")
    except httpx.HTTPStatusError as error:
        raise RoutingError(
            f"Routing service HTTP error: {error.response.status_code} - "
            f"{error.response.text[:200]}"
        )
    except httpx.RequestError as error:
        raise RoutingError(f"Could not connect to routing service: {error}")
    except ValueError as error:
        raise RoutingError(f"Routing service returned invalid JSON: {error}")


def _parse_trip(trip: Optional[Dict[str, Any]], kind: str) -> Optional[Dict[str, Any]]:
    """Convert a Valhalla trip into {distance_km, time_min, coordinates, kind}."""
    if not trip:
        return None

    coordinates: List[List[float]] = []
    elevation: List[Optional[float]] = []
    for leg in trip.get("legs", []):
        shape = leg.get("shape")
        if shape:
            coordinates.extend(decode_polyline6(shape))
        # elevation is a flat list of metres, one per shape point in this leg.
        elev = leg.get("elevation") or []
        elevation.extend(elev if elev else [None] * len(decode_polyline6(shape or "")))

    if len(coordinates) < 2:
        return None

    # Downsample elevation to ≤ 50 points so the UI chart stays clean.
    if len(elevation) > 50:
        step = max(1, len(elevation) // 50)
        elevation = elevation[::step]

    summary = trip.get("summary", {})
    return {
        "kind": kind,  # direct / alternate / detour_left / detour_right
        "distance_km": round(summary.get("length", 0), 2),
        "time_min": round(summary.get("time", 0) / 60),
        "coordinates": coordinates,  # [[lat, lng], ...]
        "elevation": elevation,       # metres above sea level, may contain None
    }


def _add_unique(routes: List[Dict[str, Any]], candidate: Optional[Dict[str, Any]]) -> None:
    """Add the route unless it is nearly identical to one we already have."""
    if candidate is None:
        return
    for existing in routes:
        if _overlap_ratio(candidate["coordinates"], existing["coordinates"]) >= 0.85:
            return
    routes.append(candidate)


def _dedupe(candidates: List[Optional[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """Shortest first; drop routes that nearly duplicate a shorter one."""
    unique: List[Dict[str, Any]] = []
    for route in sorted(
        (c for c in candidates if c is not None), key=lambda r: r["distance_km"]
    ):
        _add_unique(unique, route)
    return unique


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def get_walking_routes(
    start_lat: float,
    start_lng: float,
    end_lat: float,
    end_lng: float,
    max_routes: int = 3,
    night_walk: bool = False,
    user_profile: str = "normal",
) -> List[Dict[str, Any]]:
    """
    Return up to `max_routes` distinct walking routes, shortest first.

    1. A plain "shortest" route (neutral costing) is always requested, next to
       Valhalla's normal main route and its alternates.
    2. If that yields fewer distinct routes than wanted, extra ones are forced
       through waypoints on either side of the straight line.
    3. Routes far longer than the shortest one are dropped.
    The first route returned is therefore always the true shortest; the scoring
    step then picks the safest among them. Raises RoutingError if nothing works.

    When `night_walk` is True, all Valhalla requests use NIGHT_OPTIONS costing
    so every candidate route is biased toward main/arterial roads and away from
    alleys, driveways and unmapped back-streets.
    """
    start: Point = (start_lat, start_lng)
    end: Point = (end_lat, end_lng)

    # Apply profile-specific walking speed to all requests.
    speed = PROFILE_WALKING_SPEED.get(user_profile, PROFILE_WALKING_SPEED["normal"])
    speed_opt: Dict[str, Any] = {"walking_speed": speed}

    # base_options governs the main route + alternates + detours.
    # Night walk: force main roads. Day walk: unlock all surface types so
    # nearby lanes and living streets are used instead of the nearest highway.
    base_options: Dict[str, Any] = {**speed_opt, **(NIGHT_OPTIONS if night_walk else DAY_OPTIONS)}

    # The "shortest" request always uses fully-neutral costing so it finds the
    # true geometric minimum regardless of day/night preferences. In night mode
    # we still want to know the shortest distance even if we don't recommend it.
    short_options: Dict[str, Any] = {**speed_opt, **SHORTEST_OPTIONS}

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        main_res, short_res = await asyncio.gather(
            _post(client, _payload([start, end], alternates=max_routes - 1,
                                   costing_options=base_options)),
            _post(client, _payload([start, end], costing_options=short_options)),
            return_exceptions=True,
        )

        if isinstance(main_res, Exception) and isinstance(short_res, Exception):
            raise main_res  # nothing to work with

        candidates: List[Optional[Dict[str, Any]]] = []
        if isinstance(short_res, Exception):
            logger.warning("Shortest route request failed: %s", short_res)
        else:
            candidates.append(_parse_trip(short_res.get("trip"), "shortest"))
        if not isinstance(main_res, Exception):
            candidates.append(_parse_trip(main_res.get("trip"), "direct"))
            for alternate in main_res.get("alternates", []):
                candidates.append(_parse_trip(alternate.get("trip"), "alternate"))

        routes = _dedupe(candidates)

        if 0 < len(routes) < max_routes:
            detours = []
            for ratio in DETOUR_RATIOS:
                for side, label in ((1, "detour_left"), (-1, "detour_right")):
                    via = _via_point(start, end, side, ratio)
                    if via:
                        detours.append((label, via))

            results = await asyncio.gather(
                *[
                    _post(client, _payload([start, via, end],
                                           costing_options=base_options))
                    for _, via in detours
                ],
                return_exceptions=True,
            )

            extra: List[Optional[Dict[str, Any]]] = []
            for (label, _), result in zip(detours, results):
                if isinstance(result, Exception):
                    # One failed detour must not break the whole request.
                    logger.warning("Detour %s failed: %s", label, result)
                    continue
                extra.append(_parse_trip(result.get("trip"), label))

            routes = _dedupe(routes + extra)

    if not routes:
        raise RoutingError("No walking route found between these points.")

    shortest_km = routes[0]["distance_km"]
    if shortest_km > 0:
        routes = [r for r in routes if r["distance_km"] <= shortest_km * MAX_DETOUR_RATIO]

    return routes[:max_routes]
