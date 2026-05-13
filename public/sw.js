const CACHE = 'fintrack-v3'

self.addEventListener('install', e => {
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return

  const url = new URL(e.request.url)

  // API calls: always network, never cache
  if (url.pathname.startsWith('/api/')) return

  // HTML pages (navigation): network-first, no cache
  if (e.request.mode === 'navigate') return

  // Static assets (_next/static): network-first.
  // Some Next.js app chunks can keep stable URLs across dev refreshes/deploys;
  // serving stale JS against fresh HTML causes React hydration mismatches.
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone()
            caches.open(CACHE).then(c => c.put(e.request, clone))
          }
          return res
        })
        .catch(() => caches.match(e.request))
    )
  }
})
