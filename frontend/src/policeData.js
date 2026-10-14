// Prototype "backend" for the SOS -> police flow.
// Alerts live in localStorage so a citizen tab and a police tab in the same
// browser can talk to each other. Replace with FastAPI endpoints for production.

// SECURITY NOTE: passwords are kept in a module-private map and are NOT
// exported with POLICE_STATIONS, so they do not appear in the parts of the
// bundle that are consumed by citizen-facing components.
// For production, move authentication entirely to the server side.
const _STATION_PASSWORDS = {
  'hare-street':        'hare123',
  'park-street':        'park123',
  'bowbazar':           'bow123',
  'new-market':         'market123',
  'shakespeare-sarani': 'shake123',
  'taltala':            'tala123',
  'jorabagan':          'jora123',
  'howrah':             'howrah123',
}

export const POLICE_STATIONS = [
  { id: 'hare-street',        name: 'Hare Street',        state: 'West Bengal', lat: 22.5697, lng: 88.348  },
  { id: 'park-street',        name: 'Park Street',        state: 'West Bengal', lat: 22.551,  lng: 88.352  },
  { id: 'bowbazar',           name: 'Bowbazar',           state: 'West Bengal', lat: 22.569,  lng: 88.356  },
  { id: 'new-market',         name: 'New Market',         state: 'West Bengal', lat: 22.562,  lng: 88.351  },
  { id: 'shakespeare-sarani', name: 'Shakespeare Sarani', state: 'West Bengal', lat: 22.547,  lng: 88.353  },
  { id: 'taltala',            name: 'Taltala',            state: 'West Bengal', lat: 22.556,  lng: 88.36   },
  { id: 'jorabagan',          name: 'Jorabagan',          state: 'West Bengal', lat: 22.587,  lng: 88.36   },
  { id: 'howrah',             name: 'Howrah',             state: 'West Bengal', lat: 22.585,  lng: 88.342  },
]

const ALERTS_KEY  = 'coolwalk_sos_alerts'
const SESSION_KEY = 'coolwalk_police_station'
const CHANGE_EVENT = 'coolwalk-alerts-changed'

// Distance between two lat/lng points in km (haversine).
export function distanceKm(aLat, aLng, bLat, bLng) {
  const rad  = (d) => (d * Math.PI) / 180
  const dLat = rad(bLat - aLat)
  const dLng = rad(bLng - aLng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

export function findNearestStation(lat, lng) {
  return POLICE_STATIONS.map((s) => ({
    ...s,
    distance_km: distanceKm(lat, lng, s.lat, s.lng),
  })).sort((a, b) => a.distance_km - b.distance_km)[0]
}

// Try the device GPS; fall back to a known point so the demo never breaks.
export function getUserLocation(fallbackPoint, cityCentre) {
  return new Promise((resolve) => {
    const useFallback = () => {
      const p = fallbackPoint || { lat: cityCentre[0], lng: cityCentre[1] }
      resolve({
        lat: p.lat,
        lng: p.lng,
        source: fallbackPoint ? 'route start point' : 'city centre (estimate)',
      })
    }
    if (!navigator.geolocation) return useFallback()
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'device GPS' }),
      useFallback,
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 },
    )
  })
}

/* Notifications --------------------------------------------------------- */

/**
 * Request Notification permission (must be called from a user gesture).
 * Returns the resulting permission string.
 */
export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  return Notification.requestPermission()
}

/**
 * Fire a browser push-style notification to the police dashboard tab AND
 * trigger the custom in-app event so the dashboard re-renders immediately.
 *
 * title   – notification headline
 * body    – detail text
 * tag     – unique tag so repeated alerts replace rather than stack
 */
export function sendSosNotification({ title, body, tag }) {
  // 1. Browser Notification (visible even when the tab is in background)
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(title, {
        body,
        tag,
        icon: '/favicon.ico',
        requireInteraction: true,   // stays on screen until dismissed
        vibrate: [200, 100, 200],   // mobile vibration pattern
      })
      // Clicking the notification focuses the RAAHI tab
      n.onclick = () => {
        window.focus()
        n.close()
      }
    } catch {
      // Some browsers block Notification from service workers; ignore.
    }
  }

  // 2. In-app event so the police dashboard in the same tab updates instantly
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/* Alerts --------------------------------------------------------------- */

export function loadAlerts() {
  try {
    return JSON.parse(localStorage.getItem(ALERTS_KEY) || '[]')
  } catch {
    return []
  }
}

function saveAlerts(list) {
  localStorage.setItem(ALERTS_KEY, JSON.stringify(list))
  window.dispatchEvent(new Event(CHANGE_EVENT)) // same-tab listeners
}

export function createAlert({ station, lat, lng, source }) {
  const alert = {
    id: `sos-${Date.now()}`,
    station_id:   station.id,
    station_name: station.name,
    station_state: station.state || 'Unknown State',
    distance_km:  Number(station.distance_km.toFixed(2)),
    lat,
    lng,
    source,
    status: 'new', // new -> acknowledged -> resolved
    created_at: new Date().toISOString(),
  }
  saveAlerts([alert, ...loadAlerts()])

  // Fire browser notification to any open police dashboard tab
  sendSosNotification({
    title: `🚨 SOS Alert — ${station.name} Thana`,
    body:  `State: ${station.state}\nLocation: ${lat.toFixed(5)}, ${lng.toFixed(5)}\nSource: ${source}`,
    tag:   alert.id,
  })

  return alert
}

export function updateAlertStatus(id, status) {
  saveAlerts(loadAlerts().map((a) => (a.id === id ? { ...a, status } : a)))
}

// Calls cb(alerts) whenever alerts change (this tab or another tab).
export function subscribeAlerts(cb) {
  const onStorage = (e) => {
    if (e.key === ALERTS_KEY) cb(loadAlerts())
  }
  const onLocal = () => cb(loadAlerts())
  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE_EVENT, onLocal)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(CHANGE_EVENT, onLocal)
  }
}

/* Police session (prototype only: plain-text demo passwords) ----------- */

export function loginStation(name, password) {
  const station = POLICE_STATIONS.find(
    (s) => s.name.toLowerCase() === name.trim().toLowerCase(),
  )
  if (!station || _STATION_PASSWORDS[station.id] !== password) return null
  sessionStorage.setItem(SESSION_KEY, station.id)
  return station
}

export function getLoggedInStation() {
  const id = sessionStorage.getItem(SESSION_KEY)
  return POLICE_STATIONS.find((s) => s.id === id) || null
}

export function logoutStation() {
  sessionStorage.removeItem(SESSION_KEY)
}
