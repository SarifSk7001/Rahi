import asyncio
import logging
import math
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
HEADERS = {"User-Agent": "NagarAI-CoolWalk/1.0"}
REQUEST_TIMEOUT = 30.0

CACHE_TTL_SECONDS = 3600
EMPTY_CACHE_TTL_SECONDS = 300  # areas with no OSM data are remembered briefly
CACHE_MAX_ENTRIES = 50  # oldest entries are dropped beyond this, so memory stays bounded
BBOX_PADDING_DEG = 0.003  # about 330 m around the routes

# How close (in metres) something must be to a point on the route to count.
TREE_RADIUS_M = 15
ROAD_RADIUS_M = 15
WATER_RADIUS_M = 150
EMERGENCY_RADIUS_M = 600

# OSM tree/park coverage is patchy in many cities. If fewer shade features than
# this exist around the routes, shade is reported as unknown (None) so the
# caller can fall back to an estimate instead of trusting a misleading 0%.
MIN_SHADE_FEATURES = 15

EMERGENCY_TAGS = ("hospital", "clinic")

# Night-safety signals (WomenSafe / SafeZone)
MAJOR_HIGHWAYS = ("trunk", "primary", "secondary")  # counted as "traffic"
LIT_RADIUS_M = 20  # a road tagged lit=yes lights the route this close to it
LAMP_RADIUS_M = 25  # a street lamp lights the route this close to it
CCTV_RADIUS_M = 40  # a camera "covers" the route this close to it
ACTIVITY_RADIUS_M = 50  # open-late places that keep the street active
POLICE_RADIUS_M = 800
MIN_LIGHT_FEATURES = 10  # fewer lamps/lit roads than this = lighting data unreliable
ACTIVITY_AMENITIES = ("pharmacy", "fuel", "cafe", "restaurant", "fast_food")
ACTIVITY_SHOPS = ("convenience", "supermarket")

Point = Tuple[float, float]
_cache: Dict[tuple, Tuple[float, List[Dict[str, Any]]]] = {}


# ---------------------------------------------------------------------------
# Geometry helpers (metres, using a local flat projection)
# ---------------------------------------------------------------------------

def _make_projector(ref_lat: float) -> Callable[[float, float], Point]:
    k = math.cos(math.radians(ref_lat))

    def project(lat: float, lng: float) -> Point:
        return (lng * k * 111_320.0, lat * 110_540.0)

    return project


def _bbox_of(points: List[Point], pad: float = 0.0) -> Tuple[float, float, float, float]:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return (min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad)


def _within(px: float, py: float, box: Tuple[float, float, float, float]) -> bool:
    return box[0] <= px <= box[2] and box[1] <= py <= box[3]


def _dist_point_segment(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> float:
    dx, dy = bx - ax, by - ay
    seg2 = dx * dx + dy * dy
    if seg2 == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _in_polygon(px: float, py: float, poly: List[Point]) -> bool:
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _resample(points: List[Point], spacing: float) -> List[Point]:
    """Points spaced roughly `spacing` metres apart along the path."""
    out = [points[0]]
    carried = 0.0
    for (x1, y1), (x2, y2) in zip(points, points[1:]):
        seg = math.hypot(x2 - x1, y2 - y1)
        if seg == 0:
            continue
        d = spacing - carried
        while d <= seg:
            t = d / seg
            out.append((x1 + (x2 - x1) * t, y1 + (y2 - y1) * t))
            d += spacing
        carried = seg - (d - spacing)
    return out


# ---------------------------------------------------------------------------
# Overpass
# ---------------------------------------------------------------------------

def _build_query(south: float, west: float, north: float, east: float) -> str:
    bbox = f"{south},{west},{north},{east}"
    return f"""
[out:json][timeout:25];
(
  node["natural"="tree"]({bbox});
  node["amenity"="drinking_water"]({bbox});
  node["amenity"~"^(hospital|clinic)$"]({bbox});
  way["amenity"~"^(hospital|clinic)$"]({bbox});
  way["leisure"="park"]({bbox});
  way["natural"="wood"]({bbox});
  way["landuse"="forest"]({bbox});
  way["highway"~"^(trunk|primary|secondary)$"]({bbox});
  way["highway"]["lit"="yes"]({bbox});
  node["highway"="street_lamp"]({bbox});
  node["man_made"="surveillance"]({bbox});
  node["amenity"="police"]({bbox});
  way["amenity"="police"]({bbox});
  node["amenity"~"^(pharmacy|fuel|cafe|restaurant|fast_food)$"]({bbox});
  node["shop"~"^(convenience|supermarket)$"]({bbox});
);
out geom;
"""


def _cache_get(key: tuple) -> Optional[List[Dict[str, Any]]]:
    """Cached elements (possibly an empty list), or None if missing/expired."""
    entry = _cache.get(key)
    if entry is None:
        return None
    stored_at, elements = entry
    ttl = CACHE_TTL_SECONDS if elements else EMPTY_CACHE_TTL_SECONDS
    if time.monotonic() - stored_at >= ttl:
        _cache.pop(key, None)
        return None
    return elements


def _cache_put(key: tuple, elements: List[Dict[str, Any]]) -> None:
    now = time.monotonic()
    # Drop expired entries first, then the oldest ones if still over the limit.
    for old_key in [
        k
        for k, (t, els) in _cache.items()
        if now - t >= (CACHE_TTL_SECONDS if els else EMPTY_CACHE_TTL_SECONDS)
    ]:
        _cache.pop(old_key, None)
    while len(_cache) >= CACHE_MAX_ENTRIES:
        oldest = min(_cache, key=lambda k: _cache[k][0])
        _cache.pop(oldest, None)
    _cache[key] = (now, elements)


async def _fetch_elements(
    south: float, west: float, north: float, east: float
) -> Optional[List[Dict[str, Any]]]:
    key = (round(south, 3), round(west, 3), round(north, 3), round(east, 3))
    cached = _cache_get(key)
    if cached is not None:
        return cached or None  # an empty list means "known to have no data"

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            response = await client.post(
                OVERPASS_URL,
                data={"data": _build_query(south, west, north, east)},
                headers=HEADERS,
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as error:
        logger.warning("Overpass request failed: %s", error)
        return None

    # Overpass returns HTTP 200 with a "remark" when it ran out of time/memory.
    remark = payload.get("remark", "")
    if "runtime error" in remark or "timed out" in remark:
        logger.warning("Overpass incomplete result: %s", remark)
        return None

    elements = payload.get("elements", [])
    _cache_put(key, elements)  # empty results are cached too, but only briefly
    return elements or None


# ---------------------------------------------------------------------------
# Dataset + per-route analysis
# ---------------------------------------------------------------------------

def _build_dataset(
    elements: List[Dict[str, Any]], project: Callable[[float, float], Point]
) -> Dict[str, list]:
    ds: Dict[str, list] = {
        "trees": [],
        "water": [],
        "emergency": [],
        "parks": [],
        "roads": [],
        "lit_ways": [],
        "lamps": [],
        "cctv": [],
        "police": [],
        "activity": [],
    }

    for el in elements:
        tags = el.get("tags", {})

        if el.get("type") == "node":
            point = project(el["lat"], el["lon"])
            amenity = tags.get("amenity")
            if tags.get("natural") == "tree":
                ds["trees"].append(point)
            elif amenity == "drinking_water":
                ds["water"].append(point)
            elif amenity in EMERGENCY_TAGS:
                ds["emergency"].append(point)
            elif amenity == "police":
                ds["police"].append(point)
            elif tags.get("man_made") == "surveillance":
                ds["cctv"].append(point)
            elif tags.get("highway") == "street_lamp":
                ds["lamps"].append(point)
            elif amenity in ACTIVITY_AMENITIES or tags.get("shop") in ACTIVITY_SHOPS:
                ds["activity"].append(point)

        elif el.get("type") == "way":
            geometry = el.get("geometry") or []
            if len(geometry) < 2:
                continue
            poly = [project(p["lat"], p["lon"]) for p in geometry]
            highway = tags.get("highway")

            if highway:
                # Only big roads count as "traffic"; any lit road counts as lighting.
                if highway in MAJOR_HIGHWAYS:
                    ds["roads"].append((_bbox_of(poly, ROAD_RADIUS_M), poly))
                if tags.get("lit") == "yes":
                    ds["lit_ways"].append((_bbox_of(poly, LIT_RADIUS_M), poly))
            elif tags.get("amenity") in EMERGENCY_TAGS:
                ds["emergency"].append(
                    (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly))
                )
            elif tags.get("amenity") == "police":
                ds["police"].append(
                    (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly))
                )
            elif (
                tags.get("leisure") == "park"
                or tags.get("natural") == "wood"
                or tags.get("landuse") == "forest"
            ):
                ds["parks"].append((_bbox_of(poly), poly))

    return ds


def _is_shaded(px: float, py: float, ds: Dict[str, list]) -> bool:
    for tx, ty in ds["trees"]:
        if abs(px - tx) <= TREE_RADIUS_M and abs(py - ty) <= TREE_RADIUS_M:
            if math.hypot(px - tx, py - ty) <= TREE_RADIUS_M:
                return True
    for box, poly in ds["parks"]:
        if _within(px, py, box) and _in_polygon(px, py, poly):
            return True
    return False


def _near_major_road(px: float, py: float, ds: Dict[str, list]) -> bool:
    for box, poly in ds["roads"]:
        if not _within(px, py, box):
            continue
        for (ax, ay), (bx, by) in zip(poly, poly[1:]):
            if _dist_point_segment(px, py, ax, ay, bx, by) <= ROAD_RADIUS_M:
                return True
    return False


def _near_lit_way(px: float, py: float, ds: Dict[str, list]) -> bool:
    for box, poly in ds["lit_ways"]:
        if not _within(px, py, box):
            continue
        for (ax, ay), (bx, by) in zip(poly, poly[1:]):
            if _dist_point_segment(px, py, ax, ay, bx, by) <= LIT_RADIUS_M:
                return True
    return False


def _is_lit(px: float, py: float, ds: Dict[str, list]) -> bool:
    for lx, ly in ds["lamps"]:
        if abs(px - lx) <= LAMP_RADIUS_M and abs(py - ly) <= LAMP_RADIUS_M:
            if math.hypot(px - lx, py - ly) <= LAMP_RADIUS_M:
                return True
    return _near_lit_way(px, py, ds)


def _count_near(points: List[Point], samples: List[Point], radius: float) -> int:
    """How many of `points` are within `radius` metres of any route sample."""
    return sum(
        1
        for x, y in points
        if any(math.hypot(x - sx, y - sy) <= radius for sx, sy in samples)
    )


def _analyse_route(
    coordinates: List[List[float]],
    ds: Dict[str, list],
    project: Callable[[float, float], Point],
    shade_reliable: bool,
    light_reliable: bool,
) -> Dict[str, Any]:
    xy = [project(lat, lng) for lat, lng in coordinates]
    total_m = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(xy, xy[1:]))
    samples = _resample(xy, max(30.0, total_m / 120))

    shaded = sum(1 for px, py in samples if _is_shaded(px, py, ds))
    on_major = sum(1 for px, py in samples if _near_major_road(px, py, ds))
    lit = sum(1 for px, py in samples if _is_lit(px, py, ds)) if light_reliable else 0

    major_fraction = on_major / len(samples)
    if major_fraction >= 0.5:
        traffic = "High"
    elif major_fraction >= 0.2:
        traffic = "Medium"
    else:
        traffic = "Low"

    water_points = _count_near(ds["water"], samples, WATER_RADIUS_M)
    has_emergency = _count_near(ds["emergency"], samples, EMERGENCY_RADIUS_M) > 0

    return {
        # None means "unknown"; the caller keeps its own estimate for that field.
        "shade_percent": round(100 * shaded / len(samples)) if shade_reliable else None,
        "traffic_exposure": traffic,
        "water_points": water_points,
        "has_emergency_facility": has_emergency,
        # Night safety (WomenSafe / SafeZone). lit_percent is None when OSM has too
        # little lighting data here; camera and shop counts are real but may be low
        # because OSM coverage is patchy.
        "lit_percent": round(100 * lit / len(samples)) if light_reliable else None,
        "cctv_count": _count_near(ds["cctv"], samples, CCTV_RADIUS_M),
        "open_places": _count_near(ds["activity"], samples, ACTIVITY_RADIUS_M),
        "has_police_nearby": _count_near(ds["police"], samples, POLICE_RADIUS_M) > 0,
    }


def _analyse_all(
    elements: List[Dict[str, Any]],
    routes: List[Dict[str, Any]],
    ref_lat: float,
) -> List[Dict[str, Any]]:
    project = _make_projector(ref_lat)
    ds = _build_dataset(elements, project)
    shade_reliable = len(ds["trees"]) + len(ds["parks"]) >= MIN_SHADE_FEATURES
    light_reliable = len(ds["lamps"]) + len(ds["lit_ways"]) >= MIN_LIGHT_FEATURES
    return [
        _analyse_route(route["coordinates"], ds, project, shade_reliable, light_reliable)
        for route in routes
    ]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def get_route_features(
    routes: List[Dict[str, Any]],
) -> Optional[List[Dict[str, Any]]]:
    """
    Measure real conditions along each route from OpenStreetMap data.

    Returns one dict per route (same order) with shade_percent, traffic_exposure,
    water_points, has_emergency_facility and the night-safety fields lit_percent,
    cctv_count, open_places and has_police_nearby. shade_percent and lit_percent
    may be None when OSM has too little data nearby to trust. Returns None if OSM data could not
    be fetched at all, so the caller can fall back to estimates.
    """
    points = [p for route in routes for p in route["coordinates"]]
    if not points:
        return None

    south = min(p[0] for p in points) - BBOX_PADDING_DEG
    north = max(p[0] for p in points) + BBOX_PADDING_DEG
    west = min(p[1] for p in points) - BBOX_PADDING_DEG
    east = max(p[1] for p in points) + BBOX_PADDING_DEG

    elements = await _fetch_elements(south, west, north, east)
    if not elements:
        return None

    try:
        # CPU-heavy geometry work runs in a thread so the server stays responsive.
        return await asyncio.to_thread(_analyse_all, elements, routes, (south + north) / 2)
    except Exception as error:  # never let OSM analysis break route planning
        logger.exception("OSM route analysis failed: %s", error)
        return None