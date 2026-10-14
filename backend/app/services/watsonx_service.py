import hashlib
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

# Configuration comes from environment variables (never hard-code the API key):
#   WATSONX_APIKEY      IBM Cloud API key                         (required)
#   WATSONX_PROJECT_ID  watsonx.ai project ID                     (required)
#   WATSONX_URL         regional base URL, default us-south       (optional)
#   WATSONX_MODEL_ID    default ibm/granite-4-h-small             (optional)
IAM_TOKEN_URL = "https://iam.cloud.ibm.com/oidc/token"
DEFAULT_BASE_URL = "https://us-south.ml.cloud.ibm.com"
DEFAULT_MODEL_ID = "ibm/granite-4-h-small"
API_VERSION = "2024-03-14"

REQUEST_TIMEOUT = 20.0
CACHE_TTL_SECONDS = 600
MAX_EXPLANATION_CHARS = 600

_token: Dict[str, Any] = {"value": None, "expires_at": 0.0}
_cache: Dict[str, tuple] = {}
CACHE_MAX_ENTRIES = 200  # keeps memory bounded on a long-running server


def _cache_put(key: str, text: str) -> None:
    now = time.monotonic()
    # Drop expired entries first, then the oldest ones if still over the limit.
    for old_key in [k for k, (t, _) in _cache.items() if now - t >= CACHE_TTL_SECONDS]:
        _cache.pop(old_key, None)
    while len(_cache) >= CACHE_MAX_ENTRIES:
        oldest = min(_cache, key=lambda k: _cache[k][0])
        _cache.pop(oldest, None)
    _cache[key] = (now, text)


def is_configured() -> bool:
    return bool(os.getenv("WATSONX_APIKEY") and os.getenv("WATSONX_PROJECT_ID"))


async def _get_token(client: httpx.AsyncClient) -> str:
    """Exchange the API key for a short-lived IAM bearer token (cached)."""
    if _token["value"] and time.monotonic() < _token["expires_at"]:
        return _token["value"]

    response = await client.post(
        IAM_TOKEN_URL,
        data={
            "grant_type": "urn:ibm:params:oauth:grant-type:apikey",
            "apikey": os.getenv("WATSONX_APIKEY"),
        },
        headers={"Accept": "application/json"},
    )
    response.raise_for_status()
    data = response.json()

    _token["value"] = data["access_token"]
    _token["expires_at"] = time.monotonic() + int(data.get("expires_in", 3600)) - 120
    return _token["value"]


def _build_messages(
    routes: List[Any], best: Any, weather: Dict[str, Any], user_type: str
) -> List[Dict[str, str]]:
    """Give the model only verified facts so it explains instead of inventing."""
    facts = [
        {
            "route": r.route_id,
            "name": r.name,
            "distance_km": r.metrics.distance_km,
            "time_min": r.metrics.time_min,
            "safety_score": r.safety_score,
            "heat_risk": r.metrics.heat_risk_level,
            "feels_like_c": r.metrics.apparent_temp_c,
            "shade_percent": r.metrics.shade_percent,
            "traffic": r.metrics.traffic_exposure,
            "water_stops": r.metrics.water_points,
            "medical_facility_nearby": r.metrics.has_emergency_facility,
        }
        for r in routes
    ]

    system = (
        "You are CoolWalk, a walking-route assistant for hot Indian cities. "
        "Explain in 2 or 3 plain sentences why the recommended route is the best "
        "choice for this walker. Use ONLY the facts provided and never invent "
        "numbers, places or facilities. If the recommended route is longer than the "
        "shortest one, mention that trade-off. No markdown and no bullet points."
    )
    user = (
        f"Walker profile: {user_type}\n"
        f"Weather: feels like {weather.get('apparent_temp')}°C, "
        f"humidity {weather.get('humidity')}%\n"
        f"Routes: {json.dumps(facts)}\n"
        f"Explain why route {best.route_id} is recommended."
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def _extract_text(data: Dict[str, Any]) -> Optional[str]:
    choices = data.get("choices") or []
    if not choices:
        return None
    text = (choices[0].get("message") or {}).get("content") or ""
    text = text.strip()
    if not text:
        return None
    return text[:MAX_EXPLANATION_CHARS]


async def explain_recommendation(
    routes: List[Any], weather: Dict[str, Any], user_type: str
) -> Optional[str]:
    """
    Ask watsonx.ai to explain why the recommended route was chosen.
    Returns None if watsonx isn't configured or the call fails, so the caller
    keeps the built-in explanation. Never raises.
    """
    if not is_configured():
        return None

    best = next((r for r in routes if r.is_recommended), None)
    if best is None:
        return None

    messages = _build_messages(routes, best, weather, user_type)

    cache_key = hashlib.sha256(json.dumps(messages, sort_keys=True).encode()).hexdigest()
    cached = _cache.get(cache_key)
    if cached and time.monotonic() - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]

    base_url = os.getenv("WATSONX_URL", DEFAULT_BASE_URL).rstrip("/")
    body = {
        "messages": messages,
        "project_id": os.getenv("WATSONX_PROJECT_ID"),
        "model_id": os.getenv("WATSONX_MODEL_ID", DEFAULT_MODEL_ID),
        "max_completion_tokens": 250,
        "temperature": 0.2,
    }

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            token = await _get_token(client)
            response = await client.post(
                f"{base_url}/ml/v1/text/chat",
                params={"version": API_VERSION},
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {token}",
                },
                json=body,
            )
            response.raise_for_status()
            text = _extract_text(response.json())

    except httpx.HTTPStatusError as error:
        if error.response.status_code == 401:
            _token["value"] = None  # force a fresh token next time
        # The response body explains setup problems (bad project ID, model, region).
        logger.warning(
            "watsonx HTTP %s: %s",
            error.response.status_code,
            error.response.text[:300],
        )
        return None
    except (httpx.HTTPError, ValueError, KeyError) as error:
        logger.warning("watsonx request failed: %s", error)
        return None

    if text:
        _cache_put(cache_key, text)
    return text
