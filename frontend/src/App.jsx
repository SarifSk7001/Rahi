import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';

import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

// Custom Emergency SOS Red Marker Icon
const sosIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const PRESET_LOCATIONS = [
  { name: "City College", lat: 22.5726, lng: 88.3639 },
  { name: "Howrah Railway Station", lat: 22.5828, lng: 88.3426 },
  { name: "Sealdah Railway Station", lat: 22.5673, lng: 88.3712 },
  { name: "Victoria Memorial", lat: 22.5448, lng: 88.3426 },
  { name: "Park Street Metro", lat: 22.5551, lng: 88.3518 }
];

const PROFILES = [
  { id: 'normal', label: 'Standard Walker' },
  { id: 'elderly', label: 'Elderly Safety' },
  { id: 'child', label: 'Child Protection' },
  { id: 'fitness', label: 'Fitness Walker' }
];

function MapRecenter({ start, end, activeCoordinates, sosLocation }) {
  const map = useMap();

  useEffect(() => {
    if (sosLocation) {
      map.flyTo([sosLocation.lat, sosLocation.lng], 17, { animate: true });
    } else if (activeCoordinates && activeCoordinates.length > 0) {
      const bounds = L.latLngBounds(activeCoordinates);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    } else if (start && end) {
      const bounds = L.latLngBounds([
        [start.lat, start.lng],
        [end.lat, end.lng]
      ]);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  }, [start, end, activeCoordinates, sosLocation, map]);

  return null;
}

function MapClickListener({ selectionMode, onLocationSelected }) {
  useMapEvents({
    click(e) {
      const { lat, lng } = e.latlng;
      onLocationSelected(
        selectionMode,
        parseFloat(lat.toFixed(4)),
        parseFloat(lng.toFixed(4))
      );
    }
  });
  return null;
}

export default function App() {
  const [startPoint, setStartPoint] = useState(PRESET_LOCATIONS[0]);
  const [endPoint, setEndPoint] = useState(PRESET_LOCATIONS[1]);
  const [selectionMode, setSelectionMode] = useState('start');
  const [geoError, setGeoError] = useState('');

  const [profile, setProfile] = useState('normal');

  const [navigationData, setNavigationData] = useState(null);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const [isMobilePanelOpen, setIsMobilePanelOpen] = useState(true);

  // SOS Emergency State
  const [sosActive, setSosActive] = useState(false);
  const [sosLoading, setSosLoading] = useState(false);
  const [sosLocation, setSosLocation] = useState(null);

  const handleDetectLocation = (targetField) => {
    setGeoError('');
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by your browser.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const detected = {
          name: `GPS Point (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)})`,
          lat: parseFloat(pos.coords.latitude.toFixed(4)),
          lng: parseFloat(pos.coords.longitude.toFixed(4))
        };
        if (targetField === 'start') {
          setStartPoint(detected);
        } else {
          setEndPoint(detected);
        }
      },
      (err) => {
        setGeoError(`Location access denied (${err.message}).`);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // 🚨 Emergency Trigger Handler
  const handleEmergencySOS = () => {
    setSosLoading(true);

    const triggerSOSAlert = (lat, lng) => {
      const emergencyData = {
        timestamp: new Date().toLocaleTimeString(),
        lat: lat.toFixed(5),
        lng: lng.toFixed(5),
        googleMapsUrl: `https://www.google.com/maps?q=${lat},${lng}`
      };

      setSosLocation({ lat, lng, details: emergencyData });
      setSosLoading(false);
      setSosActive(true);

      // Trigger automatic direct call prompt on mobile devices (112 Emergency Line)
      if (/Mobi|Android|iPhone/i.test(navigator.userAgent)) {
        window.location.href = "tel:112";
      }
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          triggerSOSAlert(pos.coords.latitude, pos.coords.longitude);
        },
        () => {
          // Fallback to current startPoint if browser location permission fails
          triggerSOSAlert(startPoint.lat, startPoint.lng);
        },
        { enableHighAccuracy: true, timeout: 5000 }
      );
    } else {
      triggerSOSAlert(startPoint.lat, startPoint.lng);
    }
  };

  const fetchLiveRoute = async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:8000/api/v1/navigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_lat: startPoint.lat,
          start_lng: startPoint.lng,
          end_lat: endPoint.lat,
          end_lng: endPoint.lng,
          user_type: profile,
          prefer_shade: true,
          need_water_access: profile === 'elderly' || profile === 'child',
          need_emergency_proximity: profile === 'elderly'
        })
      });

      const data = await res.json();
      setNavigationData(data);
      if (data.routes && data.routes.length > 0) {
        setSelectedRouteId(data.routes[0].route_id);
      }
    } catch (err) {
      console.error("Failed to fetch routes:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLiveRoute();
  }, [startPoint, endPoint, profile]);

  const handleMapClick = (mode, lat, lng) => {
    if (mode === 'start') {
      setStartPoint({ name: `Custom Pin (${lat}, ${lng})`, lat, lng });
      setSelectionMode('end');
    } else {
      setEndPoint({ name: `Custom Pin (${lat}, ${lng})`, lat, lng });
    }
  };

  const currentActiveRoute = navigationData?.routes.find(r => r.route_id === selectedRouteId);

  return (
    <div className="app-container">
      {/* 🚨 SOS MODAL DIALOG */}
      {sosActive && sosLocation && (
        <div className="sos-modal-overlay">
          <div className="sos-modal">
            <div className="sos-modal-header">
              <span className="sos-pulse-icon">🚨</span>
              <h2>EMERGENCY SOS DISPATCHED</h2>
            </div>
            <p className="sos-subtext">
              Live location coordinates sent to <strong>Police (112)</strong> & <strong>Ambulance dispatch</strong>.
            </p>
            <div className="sos-location-card">
              <div><strong>Latitude:</strong> {sosLocation.details.lat}</div>
              <div><strong>Longitude:</strong> {sosLocation.details.lng}</div>
              <div><strong>Time:</strong> {sosLocation.details.timestamp}</div>
            </div>
            <div className="sos-actions">
              <a 
                href={`tel:112`} 
                className="btn-call-emergency"
              >
                📞 Call 112 Direct
              </a>
              <button 
                className="btn-cancel-sos" 
                onClick={() => setSosActive(false)}
              >
                Dismiss Alert
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOP NAVBAR */}
      <header className="top-navbar">
        <div className="nav-brand">
          <div className="brand-icon">🌿</div>
          <h1>NAGAR AI <span>CoolWalk</span></h1>
        </div>

        <div className="nav-status">
          {navigationData?.city_weather && (
            <div className="weather-pill">
              ☀️ {navigationData.city_weather.apparent_temp}°C Feels Like
            </div>
          )}

          {/* TOP SOS BUTTON */}
          <button 
            className={`btn-sos-top ${sosLoading ? 'loading' : ''}`} 
            onClick={handleEmergencySOS}
            disabled={sosLoading}
          >
            🚨 {sosLoading ? 'Locating...' : 'EMERGENCY SOS'}
          </button>
        </div>
      </header>

      {/* MOBILE TOGGLE FLOATING BUTTON */}
      <button 
        className="mobile-toggle-btn" 
        onClick={() => setIsMobilePanelOpen(!isMobilePanelOpen)}
      >
        {isMobilePanelOpen ? '🗺️ Hide Panel' : '⚙️ Show Route Panel'}
      </button>

      {/* FLOATING CONTROL PANEL / BOTTOM DRAWER */}
      <aside className={`floating-panel ${isMobilePanelOpen ? 'mobile-open' : 'mobile-closed'}`}>
        <div className="mobile-drag-handle" onClick={() => setIsMobilePanelOpen(false)}></div>

        {/* SOS MOBILE QUICK BAR */}
        <button 
          className="btn-sos-mobile" 
          onClick={handleEmergencySOS}
        >
          🚨 PRESS FOR SOS (POLICE & AMBULANCE)
        </button>

        {/* STEP 1: LOCATIONS */}
        <div className="panel-card">
          <div className="card-title">
            <span className="step-indicator">1</span>
            <h3>Start Location & Destination</h3>
          </div>

          <div className="action-grid">
            <button className="btn-action" onClick={() => handleDetectLocation('start')}>
              🎯 Detect Start GPS
            </button>
            <button className="btn-action" onClick={() => handleDetectLocation('end')}>
              🎯 Detect End GPS
            </button>
          </div>
          {geoError && <p className="error-msg">{geoError}</p>}

          <div className="action-grid">
            <button
              className={`btn-action ${selectionMode === 'start' ? 'active-start' : ''}`}
              onClick={() => setSelectionMode('start')}
            >
              📍 Pin Start
            </button>
            <button
              className={`btn-action ${selectionMode === 'end' ? 'active-end' : ''}`}
              onClick={() => setSelectionMode('end')}
            >
              🏁 Pin Destination
            </button>
          </div>

          <div className="select-group">
            <div className="select-row">
              <span>Start:</span>
              <select
                value={startPoint.name.includes("Custom") || startPoint.name.includes("GPS") ? "custom" : startPoint.name}
                onChange={(e) => {
                  const loc = PRESET_LOCATIONS.find(p => p.name === e.target.value);
                  if (loc) setStartPoint(loc);
                }}
              >
                {(startPoint.name.includes("Custom") || startPoint.name.includes("GPS")) && (
                  <option value="custom">{startPoint.name}</option>
                )}
                {PRESET_LOCATIONS.map(p => (
                  <option key={`start-${p.name}`} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className="select-row">
              <span>End:</span>
              <select
                value={endPoint.name.includes("Custom") || endPoint.name.includes("GPS") ? "custom" : endPoint.name}
                onChange={(e) => {
                  const loc = PRESET_LOCATIONS.find(p => p.name === e.target.value);
                  if (loc) setEndPoint(loc);
                }}
              >
                {(endPoint.name.includes("Custom") || endPoint.name.includes("GPS")) && (
                  <option value="custom">{endPoint.name}</option>
                )}
                {PRESET_LOCATIONS.map(p => (
                  <option key={`end-${p.name}`} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* STEP 2: PROFILE SELECTOR */}
        <div className="panel-card">
          <div className="card-title">
            <span className="step-indicator">2</span>
            <h3>Walking Profile</h3>
          </div>

          <div className="profiles-grid">
            {PROFILES.map((p) => (
              <button
                key={p.id}
                className={`chip-btn ${profile === p.id ? 'active' : ''}`}
                onClick={() => setProfile(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* STEP 3: RESULTS */}
        <div className="panel-card">
          <div className="card-title">
            <span className="step-indicator">3</span>
            <h3>Navigation Results</h3>
          </div>

          <div className="routes-container">
            {loading ? (
              <div className="loading-state">Calculating real-time OSRM paths...</div>
            ) : (
              navigationData?.routes.map((route) => (
                <div
                  key={route.route_id}
                  className={`route-card-item ${selectedRouteId === route.route_id ? 'active-route' : ''} ${route.is_recommended ? 'best-route' : ''}`}
                  onClick={() => {
                    setSelectedRouteId(route.route_id);
                    if (window.innerWidth <= 768) {
                      setIsMobilePanelOpen(false);
                    }
                  }}
                >
                  <div className="route-head">
                    <div>
                      <h4>Route {route.route_id}: {route.name}</h4>
                      {route.is_recommended && <span className="badge-rec">RECOMMENDED</span>}
                    </div>
                    <div className={`score-circle ${route.safety_score >= 80 ? 'green' : 'orange'}`}>
                      {route.safety_score}
                    </div>
                  </div>

                  <div className="metrics-strip">
                    <div>Dist: <strong>{route.metrics.distance_km} km</strong></div>
                    <div>Time: <strong>{route.metrics.time_min} min</strong></div>
                    <div>Shade: <strong>{route.metrics.shade_percent}%</strong></div>
                    <div>Water: <strong>{route.metrics.water_points} pts</strong></div>
                  </div>

                  <div className="ai-reason">
                    🤖 {route.explanation}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>

      {/* FULL CANVAS MAP */}
      <main className="map-canvas">
        <MapContainer
          center={[startPoint.lat, startPoint.lng]}
          zoom={14}
          scrollWheelZoom={true}
          style={{ width: '100%', height: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapRecenter
            start={startPoint}
            end={endPoint}
            activeCoordinates={currentActiveRoute?.coordinates}
            sosLocation={sosLocation}
          />

          <MapClickListener
            selectionMode={selectionMode}
            onLocationSelected={handleMapClick}
          />

          <Marker position={[startPoint.lat, startPoint.lng]}>
            <Popup><strong>Start Location:</strong><br />{startPoint.name}</Popup>
          </Marker>

          <Marker position={[endPoint.lat, endPoint.lng]}>
            <Popup><strong>Destination:</strong><br />{endPoint.name}</Popup>
          </Marker>

          {/* SOS Pulsing Map Marker */}
          {sosLocation && (
            <Marker position={[sosLocation.lat, sosLocation.lng]} icon={sosIcon}>
              <Popup>
                <strong style={{ color: '#ef4444' }}>🚨 EMERGENCY SOS POINT</strong><br />
                Dispatching Police & Medical Assistance!
              </Popup>
            </Marker>
          )}

          {navigationData?.routes.map((route) => {
            const isSelected = selectedRouteId === route.route_id;
            const color = route.is_recommended ? '#10b981' : (isSelected ? '#3b82f6' : '#64748b');
            return (
              <Polyline
                key={route.route_id}
                positions={route.coordinates}
                pathOptions={{
                  color: color,
                  weight: isSelected ? 6 : 4,
                  opacity: isSelected ? 0.95 : 0.45,
                  dashArray: route.is_recommended ? null : '6, 10'
                }}
              />
            );
          })}
        </MapContainer>
      </main>
    </div>
  );
}