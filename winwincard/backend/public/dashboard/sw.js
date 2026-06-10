const CACHE = 'winwin-dashboard-v3';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' })))
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Appels API : jamais mis en cache
  if (url.includes('/api/')) return;

  // HTML : network-first, cache HTTP bypassé pour toujours avoir la version fraîche
  if (e.request.destination === 'document' || url.includes('/dashboard')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' })
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Autres assets (JS, CSS, images) : cache-first
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});
