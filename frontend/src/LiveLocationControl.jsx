import { useState } from 'react'
import { useMap } from 'react-leaflet'
import UserLocationMarker from './UserLocationMarker'

export default function LiveLocationControl({ onLocationUpdate }) {
  const map = useMap()
  const [active, setActive] = useState(false)
  const [currentCoords, setCurrentCoords] = useState(null)

  const handleClick = () => {
    if (!active) {
      setActive(true)
    } else if (currentCoords) {
      // Re-center map if active and coordinates exist
      map.flyTo([currentCoords.lat, currentCoords.lng], 16, { animate: true })
    }
  }

  return (
    <>
      <div
        className="leaflet-top leaflet-right"
        style={{ marginTop: '12px', marginRight: '12px', pointerEvents: 'auto', zIndex: 1000 }}
      >
        <div className="leaflet-control">
          <button
            type="button"
            onClick={handleClick}
            title={active ? 'Center on live location' : 'Show live location'}
            aria-label="Live location control"
            className={`map-locate-btn ${active ? 'active' : ''}`}
          >
            📍
          </button>
        </div>
      </div>

      {active && (
        <UserLocationMarker
          onLocation={(coords) => {
            setCurrentCoords(coords)
            if (onLocationUpdate) onLocationUpdate(coords)
          }}
        />
      )}
    </>
  )
}