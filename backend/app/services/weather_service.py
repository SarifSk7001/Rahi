import logging
import time
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
HEADERS = {"User-Agent": "NagarAI-CoolWalk/1.0"}

# Cache results for a few minutes so repeated searches are fast and
# we don't hammer the free Open-Meteo API during a demo.
CACHE_TTL_SECONDS = 600
CACHE_MAX_ENTRIES = 200  # keeps memory bounded on a long-running server
_cache: Dict[tuple, tuple] = {}


def _cache_put(key: tuple, weather: Dict[str, Any]) -> None:
    now = time.monotonic()
    # Drop expired entries first, then the oldest ones if still over the limit.
    for old_key in [k for k, (t, _) in _cache.items() if now - t >= CACHE_TTL_SECONDS]:
        _cache.pop(old_key, None)
    while len(_cache) >= CACHE_MAX_ENTRIES:
        oldest = min(_cache, key=lambda k: _cache[k][0])
        _cache.pop(oldest, None)
    _cache[key] = (now, weather)

# Typical hot, humid Kolkata conditions, used only if the API is unreachable.
# ASSUMPTION: these values reflect a Kolkata summer climate. If this app is
# deployed for a different city or region, update these defaults to avoid
# misleading the scoring engine when live weather is unavailable.
FALLBACK_WEATHER: Dict[str, Any] = {
    "temp": 32.0,
    "apparent_temp": 36.0,
    "humidity": 65,
    "irradiance": 400.0,
    "source": "fallback",
}

CORE_VARIABLES = "temperature_2m,relative_humidity_2m,apparent_temperature"
ALL_VARIABLES = CORE_VARIABLES + ",direct_normal_irradiance"


def _num(value: Any, default: float) -> float:
    """Open-Meteo can return null for a variable; fall back to the default."""
    return default if value is None else value


async def _fetch_current(
    client: httpx.AsyncClient, lat: float, lng: float, variables: str
) -> Optional[dict]:
    params = {"latitude": lat, "longitude": lng, "current": variables}
    res = await client.get(
        OPEN_METEO_URL, params=params, headers=HEADERS, timeout=6.0
    )

    if res.status_code != 200:
        # Log the reason instead of silently using fallback values.
        logger.warning("Weather API HTTP %s: %s", res.status_code, res.text[:200])
        return None

    return res.json().get("current")


async def get_live_weather(lat: float, lng: float) -> dict:
    """
    Returns current weather for a point:
    {temp, apparent_temp, humidity, irradiance, source}
    where source is "live", "cache" or "fallback".
    """
    key = (round(lat, 2), round(lng, 2))

    cached = _cache.get(key)
    if cached and time.monotonic() - cached[0] < CACHE_TTL_SECONDS:
        return {**cached[1], "source": "cache"}

    try:
        async with httpx.AsyncClient() as client:
            current = await _fetch_current(client, lat, lng, ALL_VARIABLES)

            # If the API rejects the irradiance variable, retry with the core ones.
            if current is None:
                current = await _fetch_current(client, lat, lng, CORE_VARIABLES)

        if current:
            weather = {
                "temp": _num(current.get("temperature_2m"), FALLBACK_WEATHER["temp"]),
                "apparent_temp": _num(
                    current.get("apparent_temperature"),
                    FALLBACK_WEATHER["apparent_temp"],
                ),
                "humidity": int(
                    _num(
                        current.get("relative_humidity_2m"),
                        FALLBACK_WEATHER["humidity"],
                    )
                ),
                "irradiance": _num(
                    current.get("direct_normal_irradiance"),
                    FALLBACK_WEATHER["irradiance"],
                ),
                "source": "live",
            }
            _cache_put(key, weather)
            return weather

    except (httpx.HTTPError, ValueError) as error:
        logger.warning("Weather request failed: %s", error)

    logger.warning("Weather service unavailable; using fallback values")
    return dict(FALLBACK_WEATHER)
