import { useEffect, useId, useRef, useState } from 'react'

// Text box with place-name suggestions (OpenStreetMap Nominatim) and an
// optional "use my live location" button.
// onChange(text)  -> called while typing
// onPick(point)   -> called with {lat, lng} when a suggestion is chosen, or null when typing
//
// The search area is configurable so the app is not tied to one city:
//   VITE_SEARCH_VIEWBOX=88.15,22.75,88.55,22.40   (left,top,right,bottom = lng,lat,lng,lat)
//   VITE_SEARCH_COUNTRY=in                         (country code, or empty for worldwide)
// Or pass the `viewbox` / `country` props to override per input.
const DEFAULT_VIEWBOX = import.meta.env.VITE_SEARCH_VIEWBOX || '88.15,22.75,88.55,22.40' // Kolkata
const DEFAULT_COUNTRY = import.meta.env.VITE_SEARCH_COUNTRY ?? 'in'

const DEBOUNCE_MS = 500 // Nominatim allows about 1 request per second
const CACHE_MAX = 50

// Shared by every PlaceInput, so the same text is never searched twice.
const searchCache = new Map()

function cacheSet(key, value) {
  if (searchCache.size >= CACHE_MAX) {
    searchCache.delete(searchCache.keys().next().value) // drop the oldest
  }
  searchCache.set(key, value)
}

export default function PlaceInput({
  label,
  value,
  onChange,
  onPick,
  placeholder,
  onLive,
  liveBusy,
  viewbox = DEFAULT_VIEWBOX,
  country = DEFAULT_COUNTRY,
}) {
  const id = useId()
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const typed = useRef(false) // only search when the user typed, not when we set the text

  useEffect(() => {
    const q = value.trim()
    if (!typed.current || q.length < 3) {
      setSuggestions([])
      return undefined
    }

    const cacheKey = `${country}|${viewbox}|${q.toLowerCase()}`
    const cached = searchCache.get(cacheKey)
    if (cached) {
      setSuggestions(cached)
      setOpen(true)
      return undefined
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ format: 'json', limit: '5', q, 'accept-language': 'en' })
        if (country) params.set('countrycodes', country)
        if (viewbox) params.set('viewbox', viewbox) // prefer results in this area

        const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
          signal: controller.signal,
          headers: { 'Accept-Language': 'en' },
        })
        if (!res.ok) return
        const data = await res.json()

        const results = data.map((d) => ({
          id: d.place_id,
          full: d.display_name,
          label: d.display_name.split(',').slice(0, 3).join(',').trim(),
          lat: parseFloat(d.lat),
          lng: parseFloat(d.lon),
        }))
        cacheSet(cacheKey, results)
        setSuggestions(results)
        setOpen(true)
      } catch {
        // aborted or offline: ignore
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [value, viewbox, country])

  function handleChange(e) {
    typed.current = true
    onChange(e.target.value)
    onPick(null) // typed text no longer matches a chosen place
  }

  function choose(s) {
    typed.current = false
    onChange(s.label)
    onPick({ lat: s.lat, lng: s.lng })
    setSuggestions([])
    setOpen(false)
  }

  function handleLive() {
    typed.current = false
    setSuggestions([])
    setOpen(false)
    onLive()
  }

  return (
    <div className="field place-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        onChange={handleChange}
        onFocus={() => suggestions.length && setOpen(true)}
        onBlur={() => setOpen(false)}
        placeholder={placeholder}
        autoComplete="off"
        required
      />

      {open && suggestions.length > 0 && (
        <ul className="suggestions">
          {suggestions.map((s) => (
            <li
              key={s.id}
              title={s.full}
              onMouseDown={(e) => {
                e.preventDefault() // keep focus so blur doesn't close before the click
                choose(s)
              }}
            >
              {s.label}
            </li>
          ))}
        </ul>
      )}

      {onLive && (
        <button type="button" className="live-btn" onClick={handleLive} disabled={liveBusy}>
          {liveBusy ? 'Getting your location…' : '📍 Use my live location'}
        </button>
      )}
    </div>
  )
}
