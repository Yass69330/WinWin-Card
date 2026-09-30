// Service worker de l'espace admin (portée /admin/ : index.html, preview.html,
// diag-resultats.html).
//
// ⚠️ STRATÉGIE (corrige 00b §4.7, étape 7 de la synthèse) : la v1 pré-cachait
// /admin/ à l'installation puis servait ce cache sans jamais le rafraîchir
// (cache-first, aucune écriture au passage). Toute modification de
// public/admin/index.html restait invisible sur un appareil où l'admin avait
// déjà été ouvert — même incident que le scanner en 2026-07.
//
// Désormais les PAGES (navigations) passent par le réseau d'abord ; le cache
// ne sert qu'en repli hors ligne. Tout le reste (API, icônes, manifest, images)
// n'est pas intercepté : le navigateur le traite comme sans service worker.
//
// Le stockage des caches est commun à toute l'origine (dashboard et scanner
// compris) : l'activation ne supprime que les caches « winwin-admin-* ».
//
// Changer CACHE (v2 → v3…) seulement si la stratégie change. Une modification
// de index.html n'exige rien ici : elle est servie dès le chargement suivant.

const CACHE   = 'winwin-admin-v2';
const PREFIXE = 'winwin-admin-';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith(PREFIXE) && k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.mode !== 'navigate') return;

  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || Response.error()))
  );
});
