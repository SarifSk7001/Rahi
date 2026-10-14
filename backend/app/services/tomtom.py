"""Live-traffic car routing via the TomTom Routing API."""

import os

import httpx

# NOTE: main.py loads backend/.env via load_dotenv() before any routes or
# services are imported, so TOMTOM_API_KEY is already in os.environ here.
# A second load_dotenv call is not needed and has been removed.

TOMTOM_URL = "https://api.tomtom.com/routing/1/calculateRoute"
TURN_PENALTY_S = 5  # tiny tie-breaker only: a real time saving always beats fewer turns
NON_TURN = {"DEPART", "ARRIVE", "ARRIVE_LEFT", "ARRIVE_RIGHT", "STRAIGHT", "FOLLOW"}


class TomTomError(Exception):
    """Raised when TomTom can't give us a route."""


def _api_key() -> str:
    key = os.getenv("TOMTOM_API_KEY", "").strip()
    if not key:
        raise TomTomError("TOMTOM_API_KEY is not set in backend/.env")
    return key


def _icon(maneuver: str) -> str:
    m = maneuver.upper()
    if m == "DEPART":
        return "🚗"
    if m.startswith("ARRIVE"):
        return "🏁"
    if "UTURN" in m:
        return "↩"
    if "ROUNDABOUT" in m or "TRAFFIC_CIRCLE" in m:
        return "⟳"
    if "SHARP_LEFT" in m:
        return "↙"
    if "SHARP_RIGHT" in m:
        return "↘"
    if "BEAR_LEFT" in m or "KEEP_LEFT" in m:
        return "↖"
    if "BEAR_RIGHT" in m or "KEEP_RIGHT" in m:
        return "↗"
    if "LEFT" in m:
        return "←"
    if "RIGHT" in m:
        return "→"
    return "↑"


def _instructions(route: dict) -> list[dict]:
    return route.get("guidance", {}).get("instructions", [])


def _turn_count(route: dict) -> int:
    return sum(1 for i in _instructions(route) if i.get("maneuver") not in NON_TURN)


def _error_detail(resp: httpx.Response, key: str) -> str:
    """Short reason from TomTom's error body, with the API key masked."""
    try:
        body = resp.json()
        text = (body.get("detailedError") or {}).get("message") or body.get("error") or ""
    except ValueError:
        text = resp.text
    return str(text).replace(key, "***")[:200] or "no details"


async def get_car_route(
    start_lat: float, start_lng: float, end_lat: float, end_lng: float
) -> dict:
    key = _api_key()
    locations = f"{start_lat},{start_lng}:{end_lat},{end_lng}"
    params = {
        "key": key,
        "traffic": "true",
        "travelMode": "car",
        "routeType": "fastest",
        "departAt": "now",
        "maxAlternatives": 5,  # more candidates = better chance of a faster side road
        "instructionsType": "text",
        "language": "en-GB",
        "computeTravelTimeFor": "all",
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(f"{TOMTOM_URL}/{locations}/json", params=params)
    except httpx.HTTPError:
        # Deliberately no details: the error text could contain the URL with the key.
        raise TomTomError("Could not reach TomTom") from None

    if resp.status_code == 401:
        raise TomTomError(
            "TomTom says the API key is invalid or expired (401). "
            "Check TOMTOM_API_KEY in backend/.env and restart the server."
        )
    if resp.status_code == 403:
        raise TomTomError(
            "TomTom refused the request (403). In the TomTom portal, tick 'Routing API' "
            "for this key and clear the Domain whitelisting box."
        )
    if resp.status_code == 429:
        raise TomTomError("TomTom free limit reached for now")
    if resp.status_code != 200:
        raise TomTomError(f"TomTom returned status {resp.status_code}: {_error_detail(resp, key)}")

    routes = resp.json().get("routes") or []
    if not routes:
        raise TomTomError("No drivable route found")

    # Quickest option including live traffic, with a small penalty per turn (direct routes win).
    best = min(
        routes,
        key=lambda r: r["summary"]["travelTimeInSeconds"] + TURN_PENALTY_S * _turn_count(r),
    )
    summary = best["summary"]
    main_s = routes[0]["summary"]["travelTimeInSeconds"]  # TomTom's default (main road) option

    coordinates = [
        [p["latitude"], p["longitude"]] for leg in best["legs"] for p in leg["points"]
    ]

    instructions = _instructions(best)
    steps = []
    longest_street, longest_len = "", -1
    for i, ins in enumerate(instructions):
        maneuver = ins.get("maneuver", "")
        offset = ins.get("routeOffsetInMeters", 0)
        if i + 1 < len(instructions):
            distance = max(0, instructions[i + 1].get("routeOffsetInMeters", offset) - offset)
        else:
            distance = 0

        if maneuver.startswith("ARRIVE"):
            kind = "arrive"
            distance = 0
        elif i == 0 or maneuver == "DEPART":
            kind = "depart"
        else:
            kind = "turn"

        street = ins.get("street") or ""
        if street and distance > longest_len:
            longest_street, longest_len = street, distance

        text = (ins.get("message") or street or "Continue").strip().rstrip(".")
        steps.append(
            {
                "id": f"car-step-{i}",
                "kind": kind,
                "icon": "🚗" if kind == "depart" else _icon(maneuver),
                "text": text,
                "distance": distance,
                "lat": ins["point"]["latitude"],
                "lng": ins["point"]["longitude"],
            }
        )

    if not steps or steps[-1]["kind"] != "arrive":
        steps.append(
            {
                "id": f"car-step-{len(steps)}",
                "kind": "arrive",
                "icon": "🏁",
                "text": "You have arrived at your destination",
                "distance": 0,
                "lat": coordinates[-1][0],
                "lng": coordinates[-1][1],
            }
        )

    travel_s = summary["travelTimeInSeconds"]
    delay_s = summary.get("trafficDelayInSeconds", 0)
    free_flow_s = summary.get("noTrafficTravelTimeInSeconds", travel_s - delay_s)

    return {
        "coordinates": coordinates,
        "distance_km": round(summary["lengthInMeters"] / 1000, 1),
        "time_min": max(1, round(travel_s / 60)),
        "free_flow_min": max(1, round(free_flow_s / 60)),
        "traffic_delay_min": max(0, round(delay_s / 60)),
        "via": longest_street,
        "compared": len(routes),
        "main_route_min": max(1, round(main_s / 60)),
        "saved_min": max(0, round((main_s - travel_s) / 60)),
        "steps": steps,
        "live_traffic": True,
        "source": "tomtom",
    }