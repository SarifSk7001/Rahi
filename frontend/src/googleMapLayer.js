/**
 * Adds a Google Maps tile layer to a Leaflet map instance.
 * Falls back to CartoDB Voyager (free, no key) if the key is missing.
 *
 * Usage:
 *   import { addGoogleTileLayer } from './googleMapLayer'
 *   addGoogleTileLayer(map)
 */
import 'leaflet.gridlayer.googlemutant'
import L from 'leaflet'

const GMAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY

/** Inject the Maps JS API script once — safe to call multiple times. */
function loadGoogleMapsScript() {
  if (window.google?.maps) return               // already loaded
  if (document.getElementById('gmaps-script')) return // already injecting

  const script = document.createElement('script')
  script.id  = 'gmaps-script'
  script.src = `https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&libraries=places`
  script.async = true
  script.defer = true
  document.head.appendChild(script)
}

/**
 * Add the correct tile layer to `map` and return it.
 * mapType: 'roadmap' | 'satellite' | 'hybrid' | 'terrain'  (default 'roadmap')
 */
export function addGoogleTileLayer(map, mapType = 'roadmap') {
  if (GMAPS_KEY && GMAPS_KEY !== 'YOUR_GOOGLE_MAPS_API_KEY_HERE') {
    loadGoogleMapsScript()

    // Wait up to 5 s for the Google Maps JS SDK to be ready, then add the layer.
    const tryAdd = (attempt = 0) => {
      if (window.google?.maps) {
        L.gridLayer.googleMutant({ type: mapType, maxZoom: 22 }).addTo(map)
      } else if (attempt < 50) {
        setTimeout(() => tryAdd(attempt + 1), 100)
      } else {
        // SDK never loaded — fall back to CartoDB
        addFallbackTileLayer(map)
      }
    }
    tryAdd()
  } else {
    addFallbackTileLayer(map)
  }
}

function addFallbackTileLayer(map) {
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map)
}

/** True when a real Google Maps key is configured. */
export const hasGoogleKey =
  Boolean(GMAPS_KEY) && GMAPS_KEY !== 'YOUR_GOOGLE_MAPS_API_KEY_HERE'
