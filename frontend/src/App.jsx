import { useCallback, useEffect, useRef, useState } from 'react'
import { LOCALES, getT, voiceLangFor } from './i18n'
import { API_URL } from './config'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { addGoogleTileLayer, hasGoogleKey } from './googleMapLayer'
import './App.css'
import './UserLocationMarker.css'
import './TravelMode.css'
import './Home.css'
import PlaceInput from './PlaceInput'
import Directions from './DirectionsPanel'
import Home from './Home'
import About from './About'
import logo from './assets/logo.png'
import { fetchCarRoute } from './carRouting'
import { getUserLocation, findNearestStation } from './policeData'

// ---------------------------------------------------------------------------
// Saved routes helpers (Feature 3)
// ---------------------------------------------------------------------------
const SAVED_KEY = 'raahi_saved_routes'
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]') } catch { return [] }
}
function saveFavourite(entry) {
  const list = loadSaved().filter(
    (r) => !(r.startText === entry.startText && r.endText === entry.endText && r.userType === entry.userType)
  )
  localStorage.setItem(SAVED_KEY, JSON.stringify([entry, ...list].slice(0, 10)))
}
function deleteSaved(idx) {
  const list = loadSaved()
  list.splice(idx, 1)
  localStorage.setItem(SAVED_KEY, JSON.stringify(list))
}

// ---------------------------------------------------------------------------
// Share URL helpers (Feature 1)
// ---------------------------------------------------------------------------
function buildShareUrl({ startText, endText, startPoint, endPoint, userType, nightWalk }) {
  const p = new URLSearchParams()
  if (startPoint) { p.set('slat', startPoint.lat); p.set('slng', startPoint.lng) }
  if (endPoint)   { p.set('elat', endPoint.lat);   p.set('elng', endPoint.lng) }
  p.set('from', startText)
  p.set('to', endText)
  p.set('profile', userType)
  if (nightWalk) p.set('night', '1')
  return `${window.location.origin}${window.location.pathname}?${p.toString()}`
}
function readShareUrl() {
  const p = new URLSearchParams(window.location.search)
  if (!p.get('from') && !p.get('slat')) return null
  return {
    startText:  p.get('from') || '',
    endText:    p.get('to') || '',
    startPoint: p.get('slat') ? { lat: parseFloat(p.get('slat')), lng: parseFloat(p.get('slng')) } : null,
    endPoint:   p.get('elat') ? { lat: parseFloat(p.get('elat')), lng: parseFloat(p.get('elng')) } : null,
    userType:   p.get('profile') || 'normal',
    nightWalk:  p.get('night') === '1',
  }
}

const KOLKATA = [22.5726, 88.3639]

// Profile labels are looked up from i18n via profile_<value> keys at render time.
const PROFILE_VALUES = ['normal', 'elderly', 'child', 'accessibility', 'fitness']

const userDotIcon = L.divIcon({
  className: 'user-location-icon',
  html: '<div class="user-dot-pulse"></div><div class="user-dot"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
})

function scoreColor(score) {
  if (score >= 75) return '#16a34a'
  if (score >= 50) return '#d97706'
  return '#dc2626'
}

const SEARCH_VIEWBOX = import.meta.env.VITE_SEARCH_VIEWBOX || '88.15,22.75,88.55,22.40'
const SEARCH_COUNTRY = import.meta.env.VITE_SEARCH_COUNTRY ?? 'in'

async function geocode(query) {
  const params = new URLSearchParams({ format: 'json', limit: '1', q: query, 'accept-language': 'en' })
  if (SEARCH_COUNTRY) params.set('countrycodes', SEARCH_COUNTRY)
  if (SEARCH_VIEWBOX) params.set('viewbox', SEARCH_VIEWBOX)
  const url = `https://nominatim.openstreetmap.org/search?${params}`
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } })
  if (!res.ok) throw new Error(`Could not look up "${query}". Please try again.`)
  const data = await res.json()
  if (!data.length) {
    throw new Error(`Could not find "${query}". Try adding the city name.`)
  }
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
}

function MapView({ routes, carRoute, selectedId, onSelect, start, end, focus }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const focusLayerRef = useRef(null)
  const hasRoutesRef = useRef(false)

  useEffect(() => {
    hasRoutesRef.current = routes.length > 0 || !!carRoute
  }, [routes, carRoute])

  /* Invalidate Leaflet size whenever the container is resized */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (mapRef.current) mapRef.current.invalidateSize()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const map = L.map(containerRef.current).setView(KOLKATA, 12)
    addGoogleTileLayer(map)
    layerRef.current = L.layerGroup().addTo(map)
    focusLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    let userMarker = null
    let accuracyCircle = null
    let centered = false
    let watchId = null

    if ('geolocation' in navigator) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude, accuracy } = pos.coords
          const latlng = [latitude, longitude]

          if (!userMarker) {
            accuracyCircle = L.circle(latlng, {
              radius: accuracy,
              color: '#1a73e8',
              weight: 1,
              fillColor: '#1a73e8',
              fillOpacity: 0.12,
              interactive: false,
            }).addTo(map)
            userMarker = L.marker(latlng, {
              icon: userDotIcon,
              interactive: false,
              keyboard: false,
              zIndexOffset: 1000,
            }).addTo(map)
          } else {
            userMarker.setLatLng(latlng)
            accuracyCircle.setLatLng(latlng)
            accuracyCircle.setRadius(accuracy)
          }

          if (!centered) {
            centered = true
            if (!hasRoutesRef.current) map.setView(latlng, 15)
          }
        },
        (err) => console.warn('Location unavailable:', err.message),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
      )
    }

    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId)
      map.remove()
      mapRef.current = null
      layerRef.current = null
      focusLayerRef.current = null
    }
  }, [])

  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    layer.clearLayers()

    const ordered = [...routes].sort(
      (a, b) => (a.route_id === selectedId) - (b.route_id === selectedId),
    )

    ordered.forEach((route) => {
      const selected = route.route_id === selectedId
      L.polyline(route.coordinates, {
        color: scoreColor(route.safety_score),
        weight: selected ? 7 : 4,
        opacity: selected ? 0.95 : 0.45,
      })
        .on('click', () => onSelect(route.route_id))
        .bindTooltip(`${route.route_id}: ${route.name} (${route.safety_score}/100)`, {
          sticky: true,
        })
        .addTo(layer)
    })

    if (carRoute) {
      L.polyline(carRoute.coordinates, { color: '#ffffff', weight: 10, opacity: 0.9 }).addTo(layer)
      L.polyline(carRoute.coordinates, { color: '#4f46e5', weight: 6, opacity: 0.95 })
        .bindTooltip(`Car route · ${carRoute.distance_km} km · ${carRoute.time_min} min`, {
          sticky: true,
        })
        .addTo(layer)
    }

    const pin = (point, color, label) =>
      L.circleMarker([point.lat, point.lng], {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: color,
        fillOpacity: 1,
      })
        .bindTooltip(label)
        .addTo(layer)

    if (start) pin(start, '#2563eb', 'Start')
    if (end) pin(end, '#dc2626', 'Destination')
  }, [routes, carRoute, selectedId, start, end, onSelect])

  useEffect(() => {
    const map = mapRef.current
    if (!map || routes.length > 0 || carRoute) return

    if (start && end) {
      map.fitBounds(
        L.latLngBounds(
          [start.lat, start.lng],
          [end.lat, end.lng]
        ),
        { padding: [50, 50] }
      )
    } else if (start) {
      map.setView([start.lat, start.lng], 14)
    } else if (end) {
      map.setView([end.lat, end.lng], 14)
    }
  }, [start, end, routes, carRoute])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !routes.length) return
    map.fitBounds(L.latLngBounds(routes.flatMap((r) => r.coordinates)), {
      padding: [30, 30],
    })
  }, [routes])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !carRoute) return
    map.fitBounds(L.latLngBounds(carRoute.coordinates), { padding: [30, 30] })
  }, [carRoute])

  useEffect(() => {
    const map = mapRef.current
    const layer = focusLayerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    if (!focus) return

    L.circleMarker([focus.lat, focus.lng], {
      radius: 10,
      color: '#ffffff',
      weight: 3,
      fillColor: '#f59e0b',
      fillOpacity: 1,
    })
      .bindTooltip(focus.text, {
        permanent: true,
        direction: 'top',
        offset: [0, -8],
        className: 'step-tooltip',
      })
      .addTo(layer)

    map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 17), { duration: 0.6 })
  }, [focus])

  return <div className="map" ref={containerRef} />
}

function RouteCard({ route, selected, onSelect, tags = [], style, nightMode = false, t }) {
  const m = route.metrics

  return (
    <article
      className={`route-card${selected ? ' selected' : ''}${route.is_recommended ? ' recommended' : ''}${nightMode ? ' night-card' : ''}`}
      onClick={() => onSelect(route.route_id)}
      style={style}
    >
      <div className="route-head">
        <span className="route-id">{route.route_id}</span>
        <div className="route-title">
          <h3 className="route-name">{route.name}</h3>
          <div className="tag-row">
            {tags.map((tag) => (
              <span key={tag} className={`badge badge-${tag.toLowerCase()}`}>{tag}</span>
            ))}
            {route.is_recommended && !tags.includes('Safest') && (
              <span className={`badge${nightMode ? ' badge-night' : ''}`}>
                {nightMode ? t('safestNight') : t('recommended')}
              </span>
            )}
          </div>
        </div>
        <div className="score" style={{ '--score-color': scoreColor(route.safety_score) }}>
          {route.safety_score}
          <small>/100</small>
        </div>
      </div>

      <dl className="metrics">
        <div><dt>{t('distance')}</dt><dd>{m.distance_km} km</dd></div>
        <div><dt>{t('time')}</dt><dd>{m.time_min} min</dd></div>
        {nightMode ? (
          <>
            <div>
              <dt>{t('litPercent')}</dt>
              <dd>{m.lit_percent != null ? `${m.lit_percent}%` : t('unknown')}</dd>
            </div>
            <div>
              <dt>{t('activePlaces')}</dt>
              <dd>{m.open_places != null ? m.open_places : '—'}</dd>
            </div>
            <div>
              <dt>{t('policeNearby')}</dt>
              <dd>{m.has_police_nearby ? t('yes') : t('no')}</dd>
            </div>
            {/* Feature 7: CCTV count */}
            {m.cctv_count != null && (
              <div><dt>{t('cctvCameras')}</dt><dd>{m.cctv_count}</dd></div>
            )}
            <div><dt>{t('traffic')}</dt><dd>{m.traffic_exposure}</dd></div>
            <div><dt>{t('emergencyAccess')}</dt><dd>{m.has_emergency_facility ? t('nearby') : t('noneNearby')}</dd></div>
          </>
        ) : (
          <>
            <div><dt>{t('heatRisk')}</dt><dd>{m.heat_risk_level} ({m.apparent_temp_c}°C)</dd></div>
            {/* Feature 5: humidity */}
            <div><dt>{t('humidityLabel')}</dt><dd>{m.humidity_percent}%</dd></div>
            <div><dt>{t('shade')}</dt><dd>{m.shade_percent}%</dd></div>
            <div><dt>{t('traffic')}</dt><dd>{m.traffic_exposure}</dd></div>
            <div><dt>{t('waterStops')}</dt><dd>{m.water_points}</dd></div>
            <div><dt>{t('emergencyAccess')}</dt><dd>{m.has_emergency_facility ? t('nearby') : t('noneNearby')}</dd></div>
          </>
        )}
      </dl>

      <p className="explanation">
        {route.explanation}
        {route.explanation_source === 'watsonx' && (
          <span className="ai-tag">{t('writtenByAI')}</span>
        )}
      </p>

      <div className="breakdown">
        {Object.entries(route.score_breakdown).map(([key, value]) => (
          <div className="breakdown-row" key={key}>
            <span>{t(`factor_${key}`) || key}</span>
            <div className="bar">
              <span style={{ width: `${value}%`, background: nightMode ? '#7c3aed' : scoreColor(value) }} />
            </div>
          </div>
        ))}
      </div>
    </article>
  )
}

export default function App() {
  const [step, setStep] = useState('home')
  const [mode, setMode] = useState('walk')
  const [startText, setStartText] = useState('')
  const [endText, setEndText] = useState('')
  const [startPoint, setStartPoint] = useState(null)
  const [endPoint, setEndPoint] = useState(null)
  const [locating, setLocating] = useState(false)
  const [userType, setUserType] = useState('normal')
  const [preferShade, setPreferShade] = useState(true)
  const [needWater, setNeedWater] = useState(false)
  const [needEmergency, setNeedEmergency] = useState(false)
  const [nightWalk, setNightWalk] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [carResult, setCarResult] = useState(null)
  const [points, setPoints] = useState({ start: null, end: null })
  const [selectedId, setSelectedId] = useState(null)
  const [focusStep, setFocusStep] = useState(null)

  const [sosBusy, setSosBusy] = useState(false)
  const [sosInfo, setSosInfo] = useState(null)
  const [showAbout, setShowAbout] = useState(false)

  // Feature 3: saved/favourite routes
  const [savedRoutes, setSavedRoutes] = useState(loadSaved)
  const [showSaved, setShowSaved] = useState(false)

  // App-level language (persisted to localStorage)
  const [lang, setLang] = useState(() => localStorage.getItem('raahi_lang') || 'en')
  const t = getT(lang)

  // Voice language always tracks the app language automatically
  const voiceLang = voiceLangFor(lang)

  // Feature 8: deviation auto-recalculate
  const deviationRef = useRef({ count: 0, routeCoords: null })

  const selectRoute = useCallback((id) => {
    setSelectedId(id)
    setFocusStep(null)
  }, [])

  // Feature 1: on mount read URL params and auto-submit
  useEffect(() => {
    const shared = readShareUrl()
    if (!shared) return
    setStartText(shared.startText)
    setEndText(shared.endText)
    if (shared.startPoint) setStartPoint(shared.startPoint)
    if (shared.endPoint) setEndPoint(shared.endPoint)
    setUserType(shared.userType)
    setNightWalk(shared.nightWalk)
    setStep('form')
    // Clear params from URL bar without reload
    window.history.replaceState({}, '', window.location.pathname)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function changeLang(code) {
    setLang(code)
    localStorage.setItem('raahi_lang', code)
  }

  function switchMode(next) {
    if (next === mode) return
    setMode(next)
    setResult(null)
    setCarResult(null)
    setPoints({ start: null, end: null })
    setSelectedId(null)
    setFocusStep(null)
    setError('')
  }

  function chooseFeature(next) {
    switchMode(next)
    setError('')
    setStep('form')
  }

  // Feature 1: share copied toast state
  const [shareCopied, setShareCopied] = useState(false)
  function handleShare() {
    const url = buildShareUrl({ startText, endText, startPoint: points.start, endPoint: points.end, userType, nightWalk })
    navigator.clipboard.writeText(url).then(() => {
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2500)
    }).catch(() => {
      prompt('Copy this link to share your route:', url)
    })
  }

  // Feature 8: GPS deviation — watch position while on walk map; re-route if off track
  useEffect(() => {
    if (step !== 'map' || mode !== 'walk' || !('geolocation' in navigator)) return
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        const ref = deviationRef.current
        if (!ref.routeCoords || ref.routeCoords.length < 2) return
        const MIN_DIST_M = 150
        const closest = ref.routeCoords.reduce((best, [rlat, rlng]) => {
          const d = Math.hypot((lat - rlat) * 110540, (lng - rlng) * 111320 * Math.cos(lat * Math.PI / 180))
          return d < best ? d : best
        }, Infinity)
        if (closest > MIN_DIST_M) {
          ref.count = (ref.count || 0) + 1
          if (ref.count >= 3) {
            // User is consistently off-route — recalculate from live position
            ref.count = 0
            ref.routeCoords = null
            setStartPoint({ lat, lng })
            setStartText('Live location')
            setStep('form')
          }
        } else {
          ref.count = 0
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 15000 },
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [step, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSOS() {
    if (sosBusy) return
    setSosBusy(true)
    setError('')
    let loc
    try {
      loc = await getUserLocation(points.start, KOLKATA)
    } catch {
      setError(t('sosLocationError'))
      setSosBusy(false)
      return
    }
    try {
      const nearest = findNearestStation(loc.lat, loc.lng)
      setSosInfo({ loc, nearest, time: new Date().toISOString() })
    } catch {
      setError(t('sosStationError'))
    } finally {
      setSosBusy(false)
    }
  }

  async function useMyLocation() {
    setLocating(true)
    setError('')
    try {
      const pos = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('unsupported'))
          return
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 8000,
        })
      })
      setStartPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      setStartText('My live location')
    } catch {
      setError(t('locationError'))
    } finally {
      setLocating(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const start = startPoint || (await geocode(startText.trim()))
      const end = endPoint || (await geocode(endText.trim()))

      if (mode === 'car') {
        const car = await fetchCarRoute(start, end)
        setCarResult(car)
        setResult(null)
        setPoints({ start, end })
        setSelectedId(null)
        setFocusStep(null)
        setStep('map')
        return
      }

      const res = await fetch(`${API_URL}/api/v1/navigate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_lat: start.lat,
          start_lng: start.lng,
          end_lat: end.lat,
          end_lng: end.lng,
          user_type: userType,
          prefer_shade: preferShade,
          need_water_access: needWater,
          need_emergency_proximity: needEmergency,
          night_walk: nightWalk,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(
          typeof body.detail === 'string' ? body.detail : `Request failed (${res.status}).`,
        )
      }

      const data = await res.json()
      const best = data.routes.find((r) => r.is_recommended) || data.routes[0]

      setResult(data)
      setCarResult(null)
      setPoints({ start, end })
      setSelectedId(best.route_id)
      setFocusStep(null)
      setStep('map')

      // Feature 3: auto-save last walk to favourites
      saveFavourite({ startText: startText.trim() || 'My location', endText: endText.trim(), startPoint: start, endPoint: end, userType, nightWalk })
      setSavedRoutes(loadSaved())

      // Feature 8: store coords of best route for deviation detection
      deviationRef.current = { count: 0, routeCoords: best.coordinates }

    } catch (err) {
      setResult(null)
      setCarResult(null)
      setFocusStep(null)
      setError(
        err instanceof TypeError
          ? t('networkError')
          : err.message || 'Something went wrong.',
      )
    } finally {
      setLoading(false)
    }
  }

  const routes = result ? result.routes : []
  const weather = result ? result.city_weather : null
  const selectedRoute = routes.find((r) => r.route_id === selectedId) || null

  const safest = routes.length
    ? routes.reduce((a, b) => (b.safety_score > a.safety_score ? b : a))
    : null
  const shortest = routes.length
    ? routes.reduce((a, b) => (b.metrics.distance_km < a.metrics.distance_km ? b : a))
    : null
  const tagsFor = (route) => [
    ...(safest && route.route_id === safest.route_id ? ['Safest'] : []),
    ...(shortest && route.route_id === shortest.route_id ? ['Shortest'] : []),
  ]

  const getReasonText = (label, route) => {
    if (label === 'Safest') {
      const m = route.metrics
      const perks = []
      if (m.shade_percent > 30) perks.push(`${m.shade_percent}% shade`)
      if (m.traffic_exposure) perks.push(`${m.traffic_exposure} traffic`)
      if (m.water_points > 0) perks.push(`${m.water_points} water point(s)`)
      if (m.has_emergency_facility) perks.push('emergency access')

      return perks.length > 0
        ? `Highest safety score (${route.safety_score}/100) due to ${perks.join(', ')}.`
        : `Highest overall safety score (${route.safety_score}/100) across all measured factors.`
    }

    if (label === 'Shortest') {
      const savedKm = safest.metrics.distance_km - route.metrics.distance_km
      if (savedKm > 0.05) {
        return `Shortest distance (${route.metrics.distance_km} km), saving ${savedKm.toFixed(1)} km compared to the safest route.`
      }
      return `Minimum walking distance (${route.metrics.distance_km} km) and fastest travel time.`
    }

    return ''
  }

  const currentStartPoint = startPoint || points.start
  const currentEndPoint = endPoint || points.end

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-row">
          <div className="brand-container" onClick={() => { setStep('home'); setShowAbout(false); }}>
            <img src={logo} alt="RAAHI Logo" className="header-logo" />
            <div className="brand-text">
              <h1>{t('appName')}</h1>
              <p>{t('appTagline')}</p>
            </div>
          </div>
          <div className="header-actions">
            {/* Language selector — 3 flag buttons */}
            <div className="lang-selector" role="group" aria-label={t('languageLabel')}>
              {LOCALES.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  className={`lang-btn${lang === l.code ? ' active' : ''}`}
                  onClick={() => changeLang(l.code)}
                  title={l.label}
                  aria-pressed={lang === l.code}
                >
                  <span className="lang-flag">{l.flag}</span>
                  <span className="lang-native">{l.native}</span>
                </button>
              ))}
            </div>
            {step !== 'home' && !showAbout && (
              <button type="button" className="ghost-btn" onClick={() => { setStep('home'); setShowAbout(false); }}>
                <span className="ghost-btn-label">{t('home')}</span>
              </button>
            )}
            <button type="button" className="ghost-btn" onClick={() => setShowAbout(true)}>
              <span className="ghost-btn-label">{t('about')}</span>
            </button>
            <a href="tel:112" className="ghost-btn sos-header-btn">
              <span className="ghost-btn-label">{t('emergency112')}</span>
            </a>
          </div>
        </div>
      </header>

      {showAbout ? (
        <About onBack={() => setShowAbout(false)} lang={lang} />
      ) : step === 'home' ? (
        <Home
          onChoose={chooseFeature}
          onSOS={handleSOS}
          sosBusy={sosBusy}
          lang={lang}
        />
      ) : (
        <main className="layout">
          <aside className="panel">
            {step === 'form' && (
              <form className="search" onSubmit={handleSubmit}>
                <button type="button" className="back-link" onClick={() => setStep('home')}>
                  {t('back')}
                </button>
                <h2 className="step-title">
                  {mode === 'car' ? t('carTitle') : t('safeWalkTitle')}
                </h2>

                {/* Feature 3: saved routes quick-pick */}
                {savedRoutes.length > 0 && (
                  <div className="saved-section">
                    <button type="button" className="saved-toggle" onClick={() => setShowSaved((v) => !v)}>
                      ⭐ {t('savedRoutes')} ({savedRoutes.length}) {showSaved ? '▾' : '▸'}
                    </button>
                    {showSaved && (
                      <ul className="saved-list">
                        {savedRoutes.map((r, i) => (
                          <li key={i} className="saved-item">
                            <button type="button" className="saved-pick" onClick={() => {
                              setStartText(r.startText); setEndText(r.endText)
                              setStartPoint(r.startPoint); setEndPoint(r.endPoint)
                              setUserType(r.userType); setNightWalk(r.nightWalk)
                              setShowSaved(false)
                            }}>
                              <span className="saved-label">{r.nightWalk ? '🌙' : '☀️'} {r.startText} → {r.endText}</span>
                              <span className="saved-meta">{r.userType}</span>
                            </button>
                            <button type="button" className="saved-del" aria-label="Delete" onClick={() => { deleteSaved(i); setSavedRoutes(loadSaved()) }}>✕</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <PlaceInput
                  label={t('from')}
                  value={startText}
                  onChange={setStartText}
                  onPick={setStartPoint}
                  placeholder={t('fromPlaceholder')}
                  onLive={useMyLocation}
                  liveBusy={locating}
                />

                <PlaceInput
                  label={t('to')}
                  value={endText}
                  onChange={setEndText}
                  onPick={setEndPoint}
                  placeholder={t('toPlaceholder')}
                />

                {mode === 'walk' && (
                  <>
                    <label className="field">
                      <span>{t('walkerProfile')}</span>
                      <select value={userType} onChange={(e) => setUserType(e.target.value)}>
                        {PROFILE_VALUES.map((v) => (
                          <option key={v} value={v}>{t(`profile_${v}`)}</option>
                        ))}
                      </select>
                    </label>

                    <div className="night-toggle-row">
                      <button
                        type="button"
                        className={`night-toggle-btn${nightWalk ? ' active' : ''}`}
                        onClick={() => setNightWalk((v) => !v)}
                        aria-pressed={nightWalk}
                      >
                        <span className="night-toggle-icon">{nightWalk ? '🌙' : '☀️'}</span>
                        <span>{nightWalk ? t('nightWalk') : t('dayWalk')}</span>
                      </button>
                    </div>

                    <div className="options">
                      {!nightWalk && (
                        <label>
                          <input type="checkbox" checked={preferShade} onChange={(e) => setPreferShade(e.target.checked)} />
                          {t('preferShade')}
                        </label>
                      )}
                      <label>
                        <input type="checkbox" checked={needWater} onChange={(e) => setNeedWater(e.target.checked)} />
                        {t('needWater')}
                      </label>
                      <label>
                        <input type="checkbox" checked={needEmergency} onChange={(e) => setNeedEmergency(e.target.checked)} />
                        {t('needEmergency')}
                      </label>
                    </div>
                  </>
                )}

                <button className="primary-btn" type="submit" disabled={loading}>
                  {loading
                    ? t('findingRoutes')
                    : mode === 'car'
                      ? t('findCarRoute')
                      : nightWalk
                        ? t('findNightRoute')
                        : t('findSafeRoute')}
                </button>
              </form>
            )}

            {error && <p className="error" role="alert">{error}</p>}

            {step === 'map' && (
              <div className="trip-summary">
                <span>{startText || t('from')} → {endText || t('to')}</span>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    setStep('form')
                    setStartPoint(null)
                    setEndPoint(null)
                  }}
                >
                  {t('change')}
                </button>
              </div>
            )}

            {step === 'map' && (
              <>
                {mode === 'car' && carResult && (
                  <>
                    <div className="car-card">
                      <div className="car-card-head">
                        <span className="car-badge">🚗 {t('fastDrive')}</span>
                        <strong>{carResult.time_min} {t('min')}</strong>
                      </div>
                      <p className="car-meta">
                        {carResult.distance_km} {t('km')}{carResult.via ? ` · via ${carResult.via}` : ''}
                      </p>
                      {carResult.live_traffic && (
                        <p className="car-meta">
                          {carResult.traffic_delay_min > 0 ? (
                            <span className="car-delay">+{carResult.traffic_delay_min} {t('min')} {t('traffic')}</span>
                          ) : (
                            t('noTrafficDelay')
                          )}
                          {' · '}
                          {carResult.free_flow_min} {t('min')} without traffic
                        </p>
                      )}
                      {carResult.saved_min > 0 && (
                        <p className="car-meta">
                          ✅ {t('fasterThanMain')} ({carResult.main_route_min} {t('min')}): {t('saves')}{' '}
                          {carResult.saved_min} {t('min')}
                        </p>
                      )}
                      <p className="footnote">
                        {t('pickedFrom')} {carResult.compared} {t('options')}
                      </p>
                    </div>

                    <Directions
                      steps={carResult.steps}
                      summary={`${t('driving')} · ${carResult.distance_km} ${t('km')} · ${carResult.time_min} ${t('min')}`}
                      voiceMode="car"
                      lang={lang}
                      onSelectStep={setFocusStep}
                    />
                  </>
                )}

                {/* Feature 2: extreme heat alert banner */}
                {weather && weather.apparent_temp_c >= 38 && (
                  <div className="heat-alert" role="alert">
                    <strong>{t('heatAlert')} — {weather.apparent_temp_c}°C {t('heatAlertSub')}</strong>
                  </div>
                )}

                {weather && (
                  <div className="weather">
                    <strong>{t('feelsLike')} {weather.apparent_temp_c}°C</strong>
                    <span>
                      {weather.temperature_c}°C · {weather.humidity_percent}% {t('humidity')}
                    </span>
                    {weather.source === 'fallback' && (
                      <em>{t('liveWeatherUnavail')}</em>
                    )}
                  </div>
                )}

                {routes.length > 0 && (
                  <div className="quick-pick">
                    {[
                      ['Safest', safest],
                      ['Shortest', shortest],
                    ].map(([label, r]) => (
                      <button
                        key={label}
                        type="button"
                        className={`pick-btn${selectedId === r.route_id ? ' active' : ''}`}
                        onClick={() => selectRoute(r.route_id)}
                      >
                        <div className="pick-btn-header">
                          <strong>{label === 'Safest' ? t('safest') : t('shortest')}</strong>
                          <span className="pick-score" style={{ color: scoreColor(r.safety_score) }}>
                            {r.safety_score}/100
                          </span>
                        </div>
                        <span className="pick-meta">
                          {r.metrics.distance_km} km · {r.metrics.time_min} min
                        </span>
                        <p className="pick-reason">
                          <strong>{t('why')}</strong>{getReasonText(label, r)}
                        </p>
                      </button>
                    ))}
                  </div>
                )}

                {routes.length > 0 && safest.route_id === shortest.route_id && (
                  <p className="footnote">{t('safestAlsoShortest')}</p>
                )}

                {selectedRoute && (
                  <Directions
                    coordinates={selectedRoute.coordinates}
                    elevation={selectedRoute.elevation}
                    summary={`${t('walking')} · ${selectedRoute.metrics.distance_km} ${t('km')} · ${selectedRoute.metrics.time_min} ${t('min')}`}
                    voiceMode="walk"
                    voiceLang={voiceLang}
                    lang={lang}
                    onSelectStep={setFocusStep}
                  />
                )}

                {routes.map((route, index) => (
                  <RouteCard
                    key={route.route_id}
                    route={route}
                    selected={route.route_id === selectedId}
                    onSelect={selectRoute}
                    tags={tagsFor(route)}
                    nightMode={nightWalk}
                    style={{ animationDelay: `${index * 0.08}s` }}
                    t={t}
                  />
                ))}

                {/* Feature 1: Share route button */}
                {routes.length > 0 && (
                  <button type="button" className="share-btn" onClick={handleShare}>
                    {shareCopied ? t('linkCopied') : t('shareRoute')}
                  </button>
                )}

                {routes.length > 0 && (
                  <p className="footnote">
                    {nightWalk
                      ? result.conditions_source === 'openstreetmap'
                        ? t('nightOsmNote')
                        : t('nightEstimateNote')
                      : result.conditions_source === 'openstreetmap'
                        ? t('osmNote')
                        : t('estimateNote')}
                  </p>
                )}
              </>
            )}
          </aside>

          <section className="map-wrap">
            <MapView
              routes={routes}
              carRoute={mode === 'car' ? carResult : null}
              selectedId={selectedId}
              onSelect={selectRoute}
              start={currentStartPoint}
              end={currentEndPoint}
              focus={focusStep}
            />
          </section>
        </main>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand-wrap">
            <span className="footer-title">{t('appName')}</span>
            <span className="footer-tagline">{t('footerTagline')}</span>
          </div>
          <p className="footer-disclaimer">
            {t('footerDisclaimer')} <strong>112</strong> {t('footerDirectly')}
          </p>
          <div className="footer-links">
            <button type="button" className="footer-link-btn" onClick={() => { setStep('home'); setShowAbout(false); }}>{t('home')}</button>
            <span>·</span>
            <button type="button" className="footer-link-btn" onClick={() => setShowAbout(true)}>{t('about')}</button>
            <span>·</span>
            <a href="tel:112" className="footer-link">📞 112</a>
            <span>·</span>
            {hasGoogleKey ? (
              <a href="https://maps.google.com" target="_blank" rel="noreferrer" className="footer-link">© Google Maps</a>
            ) : (
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="footer-link">© OpenStreetMap</a>
            )}
          </div>
          <p className="footer-copy">
            &copy; {new Date().getFullYear()} {t('appName')}.{' '}
            {hasGoogleKey ? t('footerCopyGoogle') : t('footerCopyOSM')}
          </p>
        </div>
      </footer>

      <button
        className="sos-button"
        type="button"
        onClick={handleSOS}
        aria-label={t('emergencyAlert')}
        title={t('emergency112')}
        disabled={sosBusy}
      >
        <span className="sos-icon">SOS</span>
        <span className="sos-text">{sosBusy ? t('sosLocating') : t('instantSOS')}</span>
      </button>

      {sosInfo && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="sos-modal-title">
          <div className="modal sos-modal">
            <div className="sos-modal-header">
              <span className="sos-modal-icon">🚨</span>
              <div>
                <h2 id="sos-modal-title">{t('emergencyAlert')}</h2>
                <p className="sos-modal-sub">{t('locationReady')}</p>
              </div>
            </div>

            <div className="sos-detail-grid">
              <div className="sos-detail-row">
                <span className="sos-detail-label">{t('yourLocation')}</span>
                <span className="sos-detail-value">
                  {sosInfo.loc.lat.toFixed(5)}, {sosInfo.loc.lng.toFixed(5)}
                </span>
              </div>
              <div className="sos-detail-row">
                <span className="sos-detail-label">{t('source')}</span>
                <span className="sos-detail-value">{sosInfo.loc.source}</span>
              </div>
              <div className="sos-detail-row">
                <span className="sos-detail-label">{t('nearestStation')}</span>
                <span className="sos-detail-value">
                  {sosInfo.nearest.name} ({sosInfo.nearest.distance_km.toFixed(1)} km)
                </span>
              </div>
              <div className="sos-detail-row">
                <span className="sos-detail-label">{t('state')}</span>
                <span className="sos-detail-value">{sosInfo.nearest.state}</span>
              </div>
              <div className="sos-detail-row">
                <span className="sos-detail-label">{t('alertTime')}</span>
                <span className="sos-detail-value">
                  {new Date(sosInfo.time).toLocaleTimeString()}
                </span>
              </div>
            </div>

            {/* Google Maps link so the operator can see the pin */}
            <a
              className="sos-maps-link"
              href={`https://www.google.com/maps?q=${sosInfo.loc.lat},${sosInfo.loc.lng}`}
              target="_blank"
              rel="noreferrer"
            >
              {t('openInMaps')}
            </a>

            {/* WhatsApp message pre-filled with location + time */}
            <a
              className="sos-whatsapp-link"
              href={`https://wa.me/?text=${encodeURIComponent(
                `🚨 EMERGENCY SOS 🚨\nLocation: https://maps.google.com/?q=${sosInfo.loc.lat},${sosInfo.loc.lng}\nNearest station: ${sosInfo.nearest.name} (${sosInfo.nearest.state})\nTime: ${new Date(sosInfo.time).toLocaleString()}\nPlease call 112.`
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              {t('shareWhatsApp')}
            </a>

            <div className="modal-actions sos-modal-actions">
              <a className="primary-btn call-btn" href="tel:112">{t('call112Now')}</a>
              <button type="button" className="ghost-btn" onClick={() => setSosInfo(null)}>
                {t('close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}