// Builds Google-Maps-style turn-by-turn steps from a route's coordinates.
// Input: array of [lat, lng] + a translator function t(). Output: array of steps.

const EARTH_R = 6371000
const WINDOW_M = 20     // how far before/after a point we look to measure a turn
const MIN_ARM_M = 6     // ignore points with too little road on either side
const MIN_TURN_DEG = 30 // smaller direction changes are treated as straight
const GROUP_GAP_M = 25  // merge nearby candidates into one turn
const END_MARGIN_M = 8  // no turn instructions right at the start / end

const toRad = (d) => (d * Math.PI) / 180
const toDeg = (r) => (r * 180) / Math.PI

function haversine(a, b) {
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.sqrt(s))
}

function bearing(a, b) {
  const p1 = toRad(a[0])
  const p2 = toRad(b[0])
  const dl = toRad(b[1] - a[1])
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

// Signed angle from one bearing to another, in [-180, 180). Positive = right turn.
const angleDiff = (from, to) => ((to - from + 540) % 360) - 180

const COMPASS_KEYS = [
  'dir_north',
  'dir_northeast',
  'dir_east',
  'dir_southeast',
  'dir_south',
  'dir_southwest',
  'dir_west',
  'dir_northwest',
]

function compass(b, t) {
  return t(COMPASS_KEYS[Math.round(b / 45) % 8])
}

export function formatDistance(meters) {
  if (meters < 20) return `${Math.round(meters)} m`
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`
  return `${(meters / 1000).toFixed(1)} km`
}

function classifyTurn(delta, t) {
  const a = Math.abs(delta)
  const right = delta > 0
  if (a >= 165) return { kind: 'uturn',        text: t('dir_uturn'),       icon: '↩' }
  if (a >= 120) return { kind: `sharp-${right ? 'right' : 'left'}`,
                         text: t(right ? 'dir_sharp_right' : 'dir_sharp_left'), icon: right ? '↘' : '↙' }
  if (a >= 45)  return { kind: right ? 'right' : 'left',
                         text: t(right ? 'dir_right' : 'dir_left'),         icon: right ? '→' : '←' }
  return          { kind: `slight-${right ? 'right' : 'left'}`,
                    text: t(right ? 'dir_slight_right' : 'dir_slight_left'), icon: right ? '↗' : '↖' }
}

// t is optional — falls back to English keys as values when not supplied.
export function buildDirections(coordinates, t) {
  const tr = t || ((k) => k.replace('dir_', '').replace(/_/g, ' '))

  // 1. Clean the path: drop points closer than 1 m to the previous one.
  const pts = []
  for (const c of coordinates || []) {
    if (!pts.length || haversine(pts[pts.length - 1], c) >= 1) pts.push(c)
  }
  if (pts.length < 2) return []

  const n = pts.length
  const cum = [0]
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]))
  const total = cum[n - 1]

  // 2. Find points where the walking direction changes noticeably.
  const candidates = []
  for (let i = 1; i < n - 1; i++) {
    let b = i
    while (b > 0 && cum[i] - cum[b] < WINDOW_M) b--
    let a = i
    while (a < n - 1 && cum[a] - cum[i] < WINDOW_M) a++
    if (cum[i] - cum[b] < MIN_ARM_M || cum[a] - cum[i] < MIN_ARM_M) continue

    const delta = angleDiff(bearing(pts[b], pts[i]), bearing(pts[i], pts[a]))
    if (Math.abs(delta) >= MIN_TURN_DEG) candidates.push({ index: i, delta })
  }

  // 3. Merge neighbouring candidates (same corner) and keep the sharpest one.
  const turns = []
  let group = []
  const flush = () => {
    if (!group.length) return
    turns.push(
      group.reduce((best, c) => (Math.abs(c.delta) > Math.abs(best.delta) ? c : best)),
    )
    group = []
  }
  for (const c of candidates) {
    const last = group[group.length - 1]
    if (
      last &&
      (cum[c.index] - cum[last.index] > GROUP_GAP_M || Math.sign(c.delta) !== Math.sign(last.delta))
    ) {
      flush()
    }
    group.push(c)
  }
  flush()

  const usable = turns.filter(
    (turn) => cum[turn.index] > END_MARGIN_M && total - cum[turn.index] > END_MARGIN_M,
  )

  // 4. Turn them into steps. Each step's distance = how far to go until the next step.
  const stopIndexes = [0, ...usable.map((turn) => turn.index), n - 1]

  let headIdx = 1
  while (headIdx < n - 1 && cum[headIdx] < 20) headIdx++
  const heading = compass(bearing(pts[0], pts[headIdx]), tr)

  const steps = []
  stopIndexes.forEach((idx, k) => {
    const isFirst = k === 0
    const isLast  = k === stopIndexes.length - 1
    const dist    = isLast ? 0 : cum[stopIndexes[k + 1]] - cum[idx]
    const base    = { id: `step-${k}`, lat: pts[idx][0], lng: pts[idx][1], distance: dist }

    if (isFirst) {
      steps.push({ ...base, kind: 'depart', icon: '🚶', text: `${tr('dir_head')} ${heading}` })
    } else if (isLast) {
      steps.push({ ...base, kind: 'arrive', icon: '🏁', text: tr('dir_arrive') })
    } else {
      const turn = usable[k - 1]
      steps.push({ ...base, ...classifyTurn(turn.delta, tr) })
    }
  })

  return steps
}
