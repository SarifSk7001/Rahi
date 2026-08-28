import httpx
from typing import List, Dict, Any

async def fetch_osrm_routes(start_lat: float, start_lng: float, end_lat: float, end_lng: float) -> List[Dict[str, Any]]:
    url = f"https://router.project-osrm.org/route/v1/foot/{start_lng},{start_lat};{end_lng},{end_lat}?overview=full&geometries=geojson&alternatives=true"
    headers = {"User-Agent": "NagarAI-CoolWalk/1.0"}
    async with httpx.AsyncClient() as client:
        try:
            res = await client.get(url, headers=headers, timeout=5.0)
            if res.status_code == 200:
                data = res.json()
                routes = data.get("routes", [])
                if routes:
                    return routes
        except Exception as e:
            print(f"OSRM API call failed: {e}")
            
    return [{
        "distance": 2200,
        "duration": 1500,
        "geometry": {
            "coordinates": [
                [start_lng, start_lat],
                [(start_lng + end_lng) / 2, (start_lat + end_lat) / 2],
                [end_lng, end_lat]
            ]
        }
    }]
