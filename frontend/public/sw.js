// RAAHI Service Worker — caches the app shell for offline use.
// Map tiles and API calls are NOT cached (they require live data).

const CACHE = 'raahi-shell-v1'
const SHELL = ['/', '/index.html']

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  // Only intercept same-origin navigation requests (not API/tile calls).
  const url = new URL(e.request.url)
  const isNavigation = e.request.mode === 'navigate'
  const isSameOrigin = url.origin === self.location.origin
  if (!isNavigation || !isSameOrigin) return

  e.respondWith(
    fetch(e.request).catch(() =>
      caches.match('/index.html')
    )
  )
})
