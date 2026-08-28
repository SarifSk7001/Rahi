import httpx

async def get_live_weather(lat: float, lng: float) -> dict:
    url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,direct_normal_irradiance"
    headers = {"User-Agent": "NagarAI-CoolWalk/1.0"}
    async with httpx.AsyncClient() as client:
        try:
            res = await client.get(url, headers=headers, timeout=4.0)
            if res.status_code == 200:
                data = res.json().get("current", {})
                return {
                    "temp": data.get("temperature_2m", 32.0),
                    "apparent_temp": data.get("apparent_temperature", 36.0),
                    "humidity": data.get("relative_humidity_2m", 65),
                    "irradiance": data.get("direct_normal_irradiance", 400.0)
                }
        except Exception as e:
            print(f"Weather API fallback used: {e}")
            
    return {"temp": 32.0, "apparent_temp": 36.0, "humidity": 65, "irradiance": 400.0}
