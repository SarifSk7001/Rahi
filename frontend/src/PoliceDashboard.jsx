import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { addGoogleTileLayer } from './googleMapLayer'
import { loadAlerts, subscribeAlerts, updateAlertStatus } from './policeData'

const STATUS_LABELS = { new: 'New', acknowledged: 'Acknowledged', resolved: 'Resolved' }

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    const ctx = new Ctx()

    // Two-tone alarm: 880 Hz then 660 Hz
    const times = [[880, 0], [660, 0.22]]
    times.forEach(([freq, delay]) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      osc.connect(gain)
      gain.connect(ctx.destination)
      gain.gain.setValueAtTime(0.6, ctx.currentTime + delay)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.18)
      osc.start(ctx.currentTime + delay)
      osc.stop(ctx.currentTime + delay + 0.2)
    })

    setTimeout(() => ctx.close(), 700)
  } catch {
    // Browsers may block sound before the first click; ignore.
  }
}

function AlertMap({ alert, station }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const alertLat = alert ? alert.lat : null
  const alertLng = alert ? alert.lng : null

  useEffect(() => {
    const map = L.map(containerRef.current).setView([station.lat, station.lng], 13)
    addGoogleTileLayer(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [station])

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()

    L.circleMarker([station.lat, station.lng], {
      radius: 8, color: '#ffffff', weight: 2, fillColor: '#2563eb', fillOpacity: 1,
    })
      .bindTooltip(`${station.name} Thana`)
      .addTo(layer)

    if (alertLat === null) {
      map.setView([station.lat, station.lng], 13)
      return
    }

    L.polyline([[station.lat, station.lng], [alertLat, alertLng]], {
      color: '#dc2626', weight: 2, dashArray: '6 6',
    }).addTo(layer)
    L.circleMarker([alertLat, alertLng], {
      radius: 10, color: '#ffffff', weight: 2, fillColor: '#dc2626', fillOpacity: 1,
    })
      .bindTooltip('SOS location', { permanent: true, direction: 'top' })
      .addTo(layer)

    map.fitBounds(
      L.latLngBounds([[station.lat, station.lng], [alertLat, alertLng]]),
      { padding: [50, 50], maxZoom: 16 },
    )
  }, [alertLat, alertLng, station])

  return <div className="map" ref={containerRef} />
}

export default function PoliceDashboard({ station, onLogout, onBack }) {
  const [alerts, setAlerts] = useState(() => loadAlerts())
  const [selectedId, setSelectedId] = useState(null)
  const [flashId, setFlashId] = useState(null)
  const prevNewCount = useRef(null)

  useEffect(() => subscribeAlerts(setAlerts), [])

  const mine = alerts.filter((a) => a.station_id === station.id)
  const newCount = mine.filter((a) => a.status === 'new').length
  const selected = mine.find((a) => a.id === selectedId) || mine[0] || null

  // Sound + tab title + flash card when a new SOS arrives.
  useEffect(() => {
    if (prevNewCount.current !== null && newCount > prevNewCount.current) {
      beep()
      // Flash the newest "new" alert card
      const newest = mine.find((a) => a.status === 'new')
      if (newest) {
        setFlashId(newest.id)
        setTimeout(() => setFlashId(null), 2000)
      }
    }
    prevNewCount.current = newCount
    document.title = newCount > 0 ? `(${newCount}) 🚨 SOS · RAAHI` : 'RAAHI'
    return () => {
      document.title = 'RAAHI'
    }
  }, [newCount]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-row">
          <div>
            <h1>{station.name} Thana · Dashboard</h1>
            <p>
              {station.state} Police Headquarters
              {newCount > 0
                ? ` · ${newCount} new SOS alert${newCount > 1 ? 's' : ''} need attention`
                : ' · No new alerts. Listening for SOS requests…'}
            </p>
          </div>
          <div className="header-actions">
            {newCount > 0 && (
              <span className="sos-badge" aria-label={`${newCount} new SOS alerts`}>
                🚨 {newCount} New
              </span>
            )}
            <button type="button" className="ghost-btn" onClick={onBack}>Citizen app</button>
            <button type="button" className="ghost-btn" onClick={onLogout}>Logout</button>
          </div>
        </div>
      </header>

      <main className="layout">
        <aside className="panel">
          {mine.length === 0 && (
            <p className="footnote">
              When a citizen near this thana presses SOS, the alert and their location
              will appear here instantly with a sound notification.
            </p>
          )}

          {mine.map((a) => (
            <article
              key={a.id}
              className={[
                'alert-card',
                a.id === selected?.id ? 'selected' : '',
                a.status === 'new' ? 'new' : '',
                a.id === flashId ? 'alert-flash' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setSelectedId(a.id)}
            >
              <div className="route-head">
                <strong className="alert-title">🚨 SOS help request</strong>
                <span className={`status status-${a.status}`}>{STATUS_LABELS[a.status]}</span>
              </div>

              {/* State / HQ header */}
              <div className="alert-hq-row">
                <span className="alert-hq-badge">🏛️ {a.station_name} Thana</span>
                {a.station_state && (
                  <span className="alert-state-badge">📍 {a.station_state}</span>
                )}
              </div>

              <dl className="metrics">
                <div><dt>Time</dt><dd>{new Date(a.created_at).toLocaleTimeString()}</dd></div>
                <div><dt>Distance</dt><dd>{a.distance_km} km away</dd></div>
                <div><dt>Location</dt><dd>{a.lat.toFixed(5)}, {a.lng.toFixed(5)}</dd></div>
                <div><dt>Source</dt><dd>{a.source}</dd></div>
              </dl>

              <div className="alert-actions">
                <a
                  href={`https://www.google.com/maps?q=${a.lat},${a.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  Open in Google Maps
                </a>
                {a.status === 'new' && (
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      updateAlertStatus(a.id, 'acknowledged')
                    }}
                  >
                    Acknowledge
                  </button>
                )}
                {a.status !== 'resolved' && (
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      updateAlertStatus(a.id, 'resolved')
                    }}
                  >
                    Resolve
                  </button>
                )}
              </div>
            </article>
          ))}

          <p className="footnote">
            Prototype: alerts are shared through browser storage, so open the citizen app
            and this dashboard in two tabs of the same browser.
          </p>
        </aside>

        <section className="map-wrap">
          <AlertMap alert={selected} station={station} />
        </section>
      </main>
    </div>
  )
}
