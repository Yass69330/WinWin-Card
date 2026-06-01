// Stratégie dev : HTML toujours depuis le réseau, assets statiques en cache.
// En production, remplacer par cache-first sur tout + versioning du CACHE.
const CACHE = 'winwin-dashboard-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Appels API : jamais mis en cache
  if (url.includes('/api/')) return;

  // HTML : network-first — toujours la version fraîche, fallback cache si offline
  if (e.request.destination === 'document' || url.endsWith('/dashboard/') || url.endsWith('/dashboard/index.html')) {
    e.respondWith(
      fetch(e.request)
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
