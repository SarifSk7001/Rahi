// Car routing via the CoolWalk backend (FastAPI + TomTom live traffic).
// The backend picks the quickest option (including live traffic, with a small
// penalty per turn) and returns turn-by-turn steps with real street names.
import { API_URL as API_BASE } from './config'

const REQUEST_TIMEOUT_MS = 20000

export async function fetchCarRoute(start, end) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let res
  try {
    res = await fetch(`${API_BASE}/api/v1/car-route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start_lat: start.lat,
        start_lng: start.lng,
        end_lat: end.lat,
        end_lng: end.lng,
      }),
      signal: controller.signal,
    })
  } catch (error) {
    throw new Error(
      error.name === 'AbortError'
        ? 'The car routing service took too long. Please try again.'
        : 'Could not reach the CoolWalk server. Is the backend running?',
    )
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.json()
      detail = typeof body.detail === 'string' ? body.detail : ''
    } catch {
      // response was not JSON; use the generic message below
    }
    throw new Error(detail || 'The car routing service is unavailable. Please try again.')
  }

  const data = await res.json()

  if (!data.coordinates?.length || !data.steps?.length) {
    throw new Error('Could not find a car route.')
  }

  // Same shape the app already used, plus live-traffic fields from TomTom.
  return {
    coordinates: data.coordinates, // [[lat, lng], ...]
    distance_km: data.distance_km,
    time_min: data.time_min,
    free_flow_min: data.free_flow_min ?? data.time_min,
    traffic_delay_min: data.traffic_delay_min ?? 0,
    via: data.via || '',
    main_route_min: data.main_route_min ?? data.time_min,
    saved_min: data.saved_min ?? 0,
    compared: data.compared ?? 1,
    steps: data.steps,
    live_traffic: Boolean(data.live_traffic),
  }
}