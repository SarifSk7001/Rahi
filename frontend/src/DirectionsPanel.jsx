import { useEffect, useMemo, useState } from 'react'
import { buildDirections, formatDistance } from './routeSteps'
import { speak, spokenStep, useVoiceGuidance, voiceSupported } from './useVoiceGuidance'
import { getT } from './i18n'
import './Directions.css'

// Feature 11: inline SVG elevation chart
function ElevationChart({ points }) {
  const valid = (points || []).filter((v) => v != null)
  if (valid.length < 4) return null
  const W = 340, H = 56, PAD = 2
  const min = Math.min(...valid), max = Math.max(...valid)
  const range = max - min || 1
  const xs = valid.map((_, i) => PAD + (i / (valid.length - 1)) * (W - PAD * 2))
  const ys = valid.map((v) => H - PAD - ((v - min) / range) * (H - PAD * 2))
  const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')
  const fill = `${d} L${xs[xs.length - 1]},${H} L${xs[0]},${H} Z`
  return (
    <div className="elev-wrap">
      <div className="elev-labels">
        <span>▲ {Math.round(max)} m</span>
        <span className="elev-title">Elevation profile</span>
        <span>{Math.round(min)} m ▼</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="elev-chart" aria-hidden="true">
        <path d={fill} fill="rgba(15,118,110,0.15)" />
        <path d={d} fill="none" stroke="var(--accent,#0f766e)" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function voiceStatusText(voiceOn, gpsStatus, t) {
  if (!voiceSupported) return t('voiceUnsupported')
  if (!voiceOn) return t('voiceTurnOn')
  if (gpsStatus === 'denied') return t('voiceLocationBlocked')
  if (gpsStatus === 'active') return t('voiceListening')
  return t('voiceWaiting')
}

// Pass either `coordinates` (steps are worked out from the path, used for walking)
// or ready-made `steps` (used for car routes, which come with street names).
export default function Directions({
  coordinates,
  elevation,
  steps: presetSteps,
  summary,
  voiceMode = 'walk',
  voiceLang = 'en-IN',
  lang = 'en',
  onSelectStep,
}) {
  const t = getT(lang)
  const [open, setOpen] = useState(true)
  const [activeId, setActiveId] = useState(null)
  const [voiceOn, setVoiceOn] = useState(false)

  const steps = useMemo(
    () => presetSteps || buildDirections(coordinates || [], t),
    [presetSteps, coordinates, t],
  )
  const gpsStatus = useVoiceGuidance(steps, voiceOn, voiceMode, voiceLang)

  // New route (or new search) → clear the highlighted step.
  useEffect(() => {
    setActiveId(null)
  }, [steps])

  function toggleVoice() {
    if (!voiceSupported) return
    if (voiceOn) {
      window.speechSynthesis.cancel()
      setVoiceOn(false)
      return
    }
    setVoiceOn(true)
    // Speak from the click itself; browsers only allow speech after a user gesture.
    if (steps.length) speak(`Voice guidance on. ${spokenStep(steps[0])}`)
  }

  function pick(step) {
    setActiveId(step.id)
    onSelectStep({ lat: step.lat, lng: step.lng, text: step.text })
    if (voiceOn) speak(spokenStep(step)) // tap a step to preview it
  }

  return (
    <section className="directions">
      <button
        type="button"
        className="directions-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div>
          <strong>{t('directions')}</strong>
          <small>{summary}</small>
        </div>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <>
          <div className="voice-bar">
            <button
              type="button"
              className={`voice-btn${voiceOn ? ' on' : ''}`}
              onClick={toggleVoice}
              disabled={!voiceSupported}
              aria-pressed={voiceOn}
            >
              {voiceOn ? t('voiceOn') : t('voiceOff')}
            </button>
            <span className="voice-status">{voiceStatusText(voiceOn, gpsStatus, t)}</span>
          </div>

          <ElevationChart points={elevation} />
          <ol className="steps">
            {steps.map((step) => (
              <li
                key={step.id}
                className={`step ${step.kind === 'arrive' ? 'arrive' : ''}${activeId === step.id ? ' active' : ''}`}
              >
                <button type="button" className="step-btn" onClick={() => pick(step)}>
                  <span className="step-icon">{step.icon}</span>
                  <span className="step-main">
                    <span className="step-text">{step.text}</span>
                    {step.distance > 0 && (
                      <span className="step-dist">
                        {t('dir_continueFor')} {formatDistance(step.distance)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  )
}