// Service worker du scanner PWA.
//
// ⚠️ STRATÉGIE (corrige l'incident « pavé points jamais affiché », 2026-07) :
// le DOCUMENT HTML est servi en NETWORK-FIRST — on va toujours chercher la
// dernière version en ligne ; le cache ne sert qu'en repli hors-ligne. Sans ça,
// un ancien index.html figé en cache masquait les nouvelles fonctionnalités
// (ex. le pavé points) indéfiniment : le worker précédent était cache-first sur
// TOUT, et son nom de cache figé ne se purgeait jamais → les téléphones
// servaient un bundle pré-points, qui postait un scan sans montant → 400 serveur.
//
// Les statiques tiers (jsQR CDN) restent cache-first : URL versionnée, jamais
// modifiée, et utile hors-ligne.
//
// Bumper CACHE force le cycle install/activate (le navigateur détecte que sw.js
// a changé d'octets → réinstalle → purge l'ancien cache dans 'activate').

const CACHE = 'winwin-scanner-v4';

// Coquille pré-cachée, uniquement pour le repli hors-ligne.
const SHELL = [
  '/scanner/',
  '/scanner/index.html',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;

  // Les appels API ne sont jamais interceptés (réseau direct, comme avant).
  if (req.url.includes('/api/')) return;

  // DOCUMENT (navigation) → NETWORK-FIRST : toujours la dernière version.
  // Le cache est rafraîchi au passage ; en cas d'échec réseau, repli sur le cache.
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('/scanner/index.html')))
    );
    return;
  }

  // STATIQUES (jsQR, icônes, manifest) → cache-first, repli réseau.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req))
  );
});
