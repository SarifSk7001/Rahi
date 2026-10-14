import { useEffect, useState } from 'react'

// How far from a turn we announce it, per travel mode.
const MODES = {
  walk: { farM: 120, nowM: 25 },
  car: { farM: 300, nowM: 60 },
}
const EARTH_R = 6371000

const toRad = (d) => (d * Math.PI) / 180

function distanceMeters(a, b) {
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.sqrt(s))
}

export const voiceSupported =
  typeof window !== 'undefined' && 'speechSynthesis' in window

// lang defaults to en-IN; can be overridden to hi-IN or bn-IN.
export function speak(text, lang = 'en-IN') {
  if (!voiceSupported) return
  window.speechSynthesis.cancel() // stop anything still being spoken
  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = lang
  utter.rate = 0.95
  window.speechSynthesis.speak(utter)
}

export function spokenDistance(meters) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} kilometers`
  return `${Math.max(10, Math.round(meters / 10) * 10)} meters`
}

// What we say when a step is reached (or previewed by tapping it).
export function spokenStep(step) {
  if (step.kind === 'arrive') return step.text
  const tail = step.distance > 0 ? `, then continue for ${spokenDistance(step.distance)}` : ''
  return `${step.text}${tail}`
}

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1)

// Watches the user's GPS and speaks each upcoming turn.
// mode: 'walk' | 'car'. Returns 'idle' | 'waiting' | 'active' | 'denied'.
export function useVoiceGuidance(steps, enabled, mode = 'walk', lang = 'en-IN') {
  const [gpsStatus, setGpsStatus] = useState('idle')

  useEffect(() => {
    if (!enabled || !voiceSupported || steps.length < 2) {
      setGpsStatus('idle')
      return undefined
    }
    if (!('geolocation' in navigator)) {
      setGpsStatus('denied')
      return undefined
    }

    const { farM, nowM } = MODES[mode] || MODES.walk
    let next = 1 // index of the next step to announce (step 0 is "Head ...")
    const farDone = new Set() // steps already announced from far away
    setGpsStatus('waiting')

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsStatus('active')
        const here = [pos.coords.latitude, pos.coords.longitude]

        // Reached the next step (or skipped one because of GPS jitter)?
        for (let k = next; k < Math.min(steps.length, next + 2); k++) {
          if (distanceMeters(here, [steps[k].lat, steps[k].lng]) <= nowM) {
            speak(spokenStep(steps[k]), lang)
            next = k + 1
            return
          }
        }

        if (next >= steps.length) return
        const step = steps[next]
        if (step.kind === 'arrive' || farDone.has(next)) return

        const d = distanceMeters(here, [step.lat, step.lng])
        if (d <= farM) {
          farDone.add(next)
          speak(`In ${spokenDistance(d)}, ${lowerFirst(step.text)}`, lang)
        }
      },
      () => setGpsStatus('denied'),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    )

    return () => {
      navigator.geolocation.clearWatch(watchId)
      window.speechSynthesis.cancel()
    }
  }, [enabled, steps, mode, lang])

  return enabled ? gpsStatus : 'idle'
}