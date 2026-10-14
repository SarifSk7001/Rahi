import React, { useEffect, useState } from 'react'
import { MapContainer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import LiveLocationControl from './LiveLocationControl'
import { addGoogleTileLayer, hasGoogleKey } from './googleMapLayer'
import { getT } from './i18n'
import './Home.css'

function GoogleTileLayer() {
  const map = useMap()
  useEffect(() => {
    addGoogleTileLayer(map)
  }, [map])
  return null
}

function MapResizeHandler() {
  const map = useMap()
  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 120)
    return () => clearTimeout(timer)
  }, [map])
  return null
}

export default function Home({ onChoose, onSOS, sosBusy, lang = 'en' }) {
  const t = getT(lang)
  const [showMap, setShowMap] = useState(false)
  const [userCoords, setUserCoords] = useState(null)

  const defaultCenter = [22.72, 88.48] // Kolkata / Barasat default region

  return (
    <div className="rahi-home">
      {/* Background Decorative Glows */}
      <div className="bg-glow glow-1" />
      <div className="bg-glow glow-2" />

      {/* Hero Section */}
      <header className="rahi-hero">
        <div className="badge-pill">
          <span className="pulse-dot" /> Microclimate &amp; Safety Navigation
        </div>
        <h1 className="hero-heading">{t('heroHeading')}</h1>
        <p className="hero-lead">{t('heroLead')}</p>

        <div className="hero-controls">
          <button
            type="button"
            className={`btn-map-toggle ${showMap ? 'active' : ''}`}
            onClick={() => setShowMap((prev) => !prev)}
          >
            {showMap ? t('hideLiveMap') : t('openLiveMap')}
          </button>
        </div>
      </header>

      {/* Interactive Map Wrapper */}
      {showMap && (
        <section className="map-view-container">
          <div className="map-header">
            <span>{t('liveRegionalView')}</span>
            <span className="live-status">{t('liveUpdatesActive')}</span>
          </div>
          <div className="map-inner">
          <div className="map-frame">
            <MapContainer
              center={defaultCenter}
              zoom={15}
              maxZoom={hasGoogleKey ? 22 : 20}
              scrollWheelZoom={true}
              style={{ height: '100%', width: '100%' }}
            >
              <GoogleTileLayer />
              <MapResizeHandler />
              <LiveLocationControl
                onLocationUpdate={(coords) => setUserCoords(coords)}
              />
            </MapContainer>
          </div>
          </div>
        </section>
      )}

      {/* Quick Access Core Features */}
      <section className="quick-actions-grid">
        <div
          className="action-card card-walk"
          onClick={() => onChoose('walk')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onChoose('walk')}
        >
          <div className="card-badge">{t('safeWalkBadge')}</div>
          <div className="card-icon">🚶‍♂️</div>
          <h3>{t('safeWalk')}</h3>
          <p>{t('safeWalkDesc')}</p>
          <div className="card-cta">{t('safeWalkCta')} <span>→</span></div>
        </div>

        <div
          className="action-card card-car"
          onClick={() => onChoose('car')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onChoose('car')}
        >
          <div className="card-badge">{t('fastDriveBadge')}</div>
          <div className="card-icon">🚗</div>
          <h3>{t('fastDrive')}</h3>
          <p>{t('fastDriveDesc')}</p>
          <div className="card-cta">{t('fastDriveCta')} <span>→</span></div>
        </div>

        <div
          className={`action-card card-sos ${sosBusy ? 'disabled' : ''}`}
          onClick={sosBusy ? undefined : () => onSOS && onSOS(userCoords)}
          role="button"
          tabIndex={sosBusy ? -1 : 0}
          onKeyDown={(e) => !sosBusy && e.key === 'Enter' && onSOS && onSOS(userCoords)}
        >
          <div className="card-badge alert-badge">{t('sosBadge')}</div>
          <div className="card-icon">🚨</div>
          <h3>{t('instantSOS')}</h3>
          <p>{t('sosDesc')}</p>
          <div className="card-cta sos-cta">
            {sosBusy ? t('sosLocating') : t('sosCta')} <span>→</span>
          </div>
        </div>

        <div
          className="action-card card-112"
          onClick={() => { window.location.href = 'tel:112' }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && (window.location.href = 'tel:112')}
        >
          <div className="card-badge alert-badge">{t('call112Badge')}</div>
          <div className="card-icon">📞</div>
          <h3>{t('call112')}</h3>
          <p>{t('call112Desc')}</p>
          <div className="card-cta sos-cta">{t('call112Cta')} <span>→</span></div>
        </div>
      </section>

      {/* Why RAHI Section */}
      <section className="section-block">
        <div className="section-heading-wrap">
          <h2>{t('whyTitle')}</h2>
          <p>{t('whySub')}</p>
        </div>

        <div className="why-grid">
          <div className="info-box">
            <div className="info-icon">🌑</div>
            <h4>{t('why1Title')}</h4>
            <p>{t('why1Desc')}</p>
          </div>
          <div className="info-box">
            <div className="info-icon">🌡️</div>
            <h4>{t('why2Title')}</h4>
            <p>{t('why2Desc')}</p>
          </div>
          <div className="info-box">
            <div className="info-icon">♿</div>
            <h4>{t('why3Title')}</h4>
            <p>{t('why3Desc')}</p>
          </div>
          <div className="info-box">
            <div className="info-icon">🔗</div>
            <h4>{t('why4Title')}</h4>
            <p>{t('why4Desc')}</p>
          </div>
          <div className="info-box">
            <div className="info-icon">⭐</div>
            <h4>{t('why5Title')}</h4>
            <p>{t('why5Desc')}</p>
          </div>
          <div className="info-box">
            <div className="info-icon">🔄</div>
            <h4>{t('why6Title')}</h4>
            <p>{t('why6Desc')}</p>
          </div>
        </div>
      </section>

      {/* Feature Grid — Key Capabilities */}
      <section className="section-block">
        <div className="section-heading-wrap">
          <h2>{t('capTitle')}</h2>
          <p>{t('capSub')}</p>
        </div>

        <div className="features-grid">
          <div className="feature-item">
            <div className="f-icon">📊</div>
            <div>
              <h4>{t('cap1Title')}</h4>
              <p>{t('cap1Desc')}</p>
            </div>
          </div>
          <div className="feature-item">
            <div className="f-icon">🌳</div>
            <div>
              <h4>{t('cap2Title')}</h4>
              <p>{t('cap2Desc')}</p>
            </div>
          </div>
          <div className="feature-item">
            <div className="f-icon">💧</div>
            <div>
              <h4>{t('cap3Title')}</h4>
              <p>{t('cap3Desc')}</p>
            </div>
          </div>
          <div className="feature-item">
            <div className="f-icon">🚨</div>
            <div>
              <h4>{t('cap4Title')}</h4>
              <p>{t('cap4Desc')}</p>
            </div>
          </div>
          <div className="feature-item">
            <div className="f-icon">📹</div>
            <div>
              <h4>{t('cap5Title')}</h4>
              <p>{t('cap5Desc')}</p>
            </div>
          </div>
          <div className="feature-item">
            <div className="f-icon">🔊</div>
            <div>
              <h4>{t('cap6Title')}</h4>
              <p>{t('cap6Desc')}</p>
            </div>
          </div>
          <div className="feature-item">
            <div className="f-icon">⛰️</div>
            <div>
              <h4>{t('cap7Title')}</h4>
              <p>{t('cap7Desc')}</p>
            </div>
          </div>
          <div className="feature-item">
            <div className="f-icon">📱</div>
            <div>
              <h4>{t('cap8Title')}</h4>
              <p>{t('cap8Desc')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="section-block">
        <div className="section-heading-wrap">
          <h2>{t('compTitle')}</h2>
          <p>{t('compSub')}</p>
        </div>

        <div className="comparison-card">
          <table className="comp-table">
            <thead>
              <tr>
                <th>{t('compFactor')}</th>
                <th>{t('compStandard')}</th>
                <th className="rahi-col">{t('compRahi')}</th>
              </tr>
            </thead>
            <tbody>
              {[1,2,3,4,5,6,7,8,9,10,11].map((n) => (
                <tr key={n}>
                  <td><strong>{t(`comp_r${n}_factor`)}</strong></td>
                  <td>{t(`comp_r${n}_std`)}</td>
                  <td className="rahi-col"><span className="tag-green">{t(`comp_r${n}_rahi`)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 112 Emergency Banner */}
      <section className="police-cta-banner">
        <div className="police-banner-inner">
          <div className="police-banner-text">
            <h3>{t('emergBannerTitle')}</h3>
            <p>{t('emergBannerDesc')}</p>
          </div>
          <a href="tel:112" className="btn-police-action">
            {t('emergBannerCta')}
          </a>
        </div>
      </section>
    </div>
  )
}
