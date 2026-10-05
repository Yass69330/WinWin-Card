'use strict';

// ════════════════════════════════════════════════════════════════════════════
// IMITATEUR (étape 15) : ce que le serveur de test croit être Apple et Google,
// et les iPhones qui viennent chercher leur carte. Jamais de vraies clés ni de
// vrais appareils : les jetons de push viennent des données factices.
//
//   APNs     HTTP/2 en clair (le fichier de campagne y redirige apns.js) :
//            POST /3/device/<jeton> → 200 après un délai, ou 410 (part d'erreurs).
//   Google   HTTP : /oauth2.googleapis.com/token et
//            /walletobjects.googleapis.com/walletobjects/v1/... (délais mesurés
//            par l'audit 04 n° 3 pour la création ; HYPOTHÈSE pour le reste).
//   Stockage HTTP, en mémoire, pour le banc local seulement (/storage/v1/...).
//   iPhones  après chaque push, l'appareil fait ce que fait iOS : la liste de
//            ses cartes, puis chaque carte avec If-Modified-Since. Chacun a sa
//            propre adresse 4G (X-Forwarded-For), comme les vrais clients.
//   Bilan    GET /__stats (sur le port Google), ?raz=1 pour remettre à zéro ;
//            POST /__config {serveur} donne l'adresse du serveur après coup.
//
// Le jeton de push encode l'appareil : jeton = numéro de l'appareil en
// hexadécimal sur 64 caractères, appareil = « appareil-<numéro> » (donnees.sql).
// ════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const http = require('http');
const http2 = require('http2');

const P = {
  serveur: process.env.IMITATEUR_SERVEUR,                     // serveur de test (iPhones)
  secret: process.env.JWT_SECRET,                             // jeton d'accès aux cartes
  typeCarte: process.env.IMITATEUR_TYPE_CARTE || 'pass.campagne.etape15',
  apnsMs: [Number(process.env.IMITATEUR_APNS_MIN_MS || 50), Number(process.env.IMITATEUR_APNS_MAX_MS || 300)],
  apnsErreurs: Number(process.env.IMITATEUR_APNS_ERREURS || 0.01),
  iphoneMs: [Number(process.env.IMITATEUR_IPHONE_MIN_MS || 1000), Number(process.env.IMITATEUR_IPHONE_MAX_MS || 5000)],
  googleCreationMs: Number(process.env.IMITATEUR_GOOGLE_CREATION_MS || 1400),   // médiane, 04 n° 3
  googleCreationP90Ms: Number(process.env.IMITATEUR_GOOGLE_CREATION_P90_MS || 2400),
  googleAutreMs: Number(process.env.IMITATEUR_GOOGLE_MS || 400),               // HYPOTHÈSE
  iphones: process.env.IMITATEUR_IPHONES !== '0',
  // Flux simultanés par connexion APNs : Apple en limite le nombre (HYPOTHÈSE :
  // 1 000) ; au-delà, le client reçoit un refus de flux.
  apnsFlux: Number(process.env.IMITATEUR_APNS_FLUX || 1000),
};

const attendre = ms => new Promise(r => setTimeout(r, ms));
const uniforme = ([a, b]) => a + Math.random() * (b - a);
// Loi log-normale de médiane m et de 90e centile p90, bornée à 22 s (04 n° 3).
function lognormale(m, p90) {
  const sigma = Math.log(p90 / m) / 1.2816;
  const z = Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
  return Math.min(22000, m * Math.exp(sigma * z));
}

// ── Bilan ───────────────────────────────────────────────────────────────────
let stats;
function raz() {
  stats = { apns: { recus: 0, refuses: 0, abandonnes: 0 }, google: {}, stockage: { lectures: 0, ecritures: 0 },
    iphones: { reveils: 0, listes: 0, listes_vides: 0, cartes_200: 0, cartes_304: 0, erreurs: {}, durees_ms: [] } };
}
raz();
function quantiles(v) {
  const s = [...v].sort((a, b) => a - b);
  const q = p => (s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : null);
  return { n: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s.length ? Math.round(s[s.length - 1]) : null };
}

// ── iPhones ─────────────────────────────────────────────────────────────────
const appareils = new Map();   // numéro → { tag, modifie: Map(serial → Last-Modified) }
const jetonCarte = serial => crypto.createHmac('sha256', P.secret).update(serial).digest('hex').slice(0, 32);
const adresse4G = n => `100.${64 + ((n >> 16) & 63)}.${(n >> 8) & 255}.${n & 255}`;

// Un appareil déjà connu de la production est à jour : à son premier réveil, il
// annonce ses cartes comme reçues une minute plus tôt (seule la carte qui vient
// de changer revient en 200, les autres en 304, comme en régime établi).
async function reveiller(n) {
  stats.iphones.reveils++;
  const avant = new Date(Date.now() - 60000);
  const etat = appareils.get(n) || { tag: avant.toISOString(), modifie: new Map(), defaut: avant.toUTCString() };
  appareils.set(n, etat);
  const entetes = { 'X-Forwarded-For': adresse4G(n) };
  try {
    const q = etat.tag ? `?passesUpdatedSince=${encodeURIComponent(etat.tag)}` : '';
    const r = await fetch(`${P.serveur}/v1/devices/appareil-${n}/registrations/${P.typeCarte}${q}`, { headers: entetes });
    if (r.status === 204) { stats.iphones.listes_vides++; return; }
    if (r.status !== 200) { stats.iphones.erreurs[`liste ${r.status}`] = (stats.iphones.erreurs[`liste ${r.status}`] || 0) + 1; return; }
    const { serialNumbers = [], lastUpdated } = await r.json();
    stats.iphones.listes++;
    etat.tag = lastUpdated;
    for (const serial of serialNumbers) {
      const t0 = performance.now();
      const h = { ...entetes, Authorization: `ApplePass ${jetonCarte(serial)}` };
      h['If-Modified-Since'] = etat.modifie.get(serial) || etat.defaut;
      const c = await fetch(`${P.serveur}/v1/passes/${P.typeCarte}/${serial}`, { headers: h });
      await c.arrayBuffer();
      stats.iphones.durees_ms.push(performance.now() - t0);
      if (c.status === 200) { stats.iphones.cartes_200++; etat.modifie.set(serial, c.headers.get('last-modified')); }
      else if (c.status === 304) stats.iphones.cartes_304++;
      else stats.iphones.erreurs[`carte ${c.status}`] = (stats.iphones.erreurs[`carte ${c.status}`] || 0) + 1;
    }
  } catch (e) {
    const cause = `${e.message}${e.cause && e.cause.code ? ` (${e.cause.code})` : ''}`;
    stats.iphones.erreurs[cause] = (stats.iphones.erreurs[cause] || 0) + 1;
  }
}

// ── APNs ────────────────────────────────────────────────────────────────────
const apns = http2.createServer({ settings: { maxConcurrentStreams: P.apnsFlux } });
apns.on('stream', (flux, entetes) => {
  const m = /^\/3\/device\/([0-9a-f]+)$/.exec(entetes[':path'] || '');
  flux.on('error', () => {});
  flux.on('data', () => {});
  flux.on('end', async () => {
    await attendre(uniforme(P.apnsMs));
    // Le serveur a pu abandonner l'envoi entre-temps (borne de 10 s d'apns.js).
    if (flux.destroyed || flux.closed) { stats.apns.abandonnes = (stats.apns.abandonnes || 0) + 1; return; }
    if (!m) { flux.respond({ ':status': 400 }); return flux.end('{"reason":"BadPath"}'); }
    stats.apns.recus++;
    if (Math.random() < P.apnsErreurs) {
      stats.apns.refuses++;
      flux.respond({ ':status': 410 });
      return flux.end('{"reason":"Unregistered"}');
    }
    flux.respond({ ':status': 200 });
    flux.end();
    if (P.iphones && P.serveur) {
      const n = parseInt(m[1], 16);
      setTimeout(() => reveiller(n), uniforme(P.iphoneMs));
    }
  });
});

// ── Google, stockage, bilan ─────────────────────────────────────────────────
const stockage = new Map();
const corps = req => new Promise(r => { const b = []; req.on('data', d => b.push(d)); req.on('end', () => r(Buffer.concat(b))); });
const json = (res, code, v) => { res.writeHead(code, { 'Content-Type': 'application/json', 'X-Servi-Par': 'imitateur' }); res.end(JSON.stringify(v)); };

const web = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://imitateur');
  const chemin = url.pathname;
  const contenu = await corps(req);

  // Adresse du serveur de test, connue après son démarrage (banc local).
  if (chemin === '/__config' && req.method === 'POST') {
    P.serveur = JSON.parse(contenu.toString() || '{}').serveur || P.serveur;
    return json(res, 200, { serveur: P.serveur });
  }
  if (chemin === '/__stats') {
    const v = { ...stats, iphones: { ...stats.iphones, durees_ms: quantiles(stats.iphones.durees_ms) } };
    if (url.searchParams.get('raz') === '1') raz();
    return json(res, 200, v);
  }
  if (chemin === '/oauth2.googleapis.com/token') {
    stats.google.jeton = (stats.google.jeton || 0) + 1;
    return json(res, 200, { access_token: 'campagne', expires_in: 3600, token_type: 'Bearer' });
  }
  if (chemin.startsWith('/walletobjects.googleapis.com/')) {
    const op = `${req.method} ${chemin.split('/')[4] || ''}${chemin.endsWith('/addMessage') ? '/addMessage' : ''}`;
    stats.google[op] = (stats.google[op] || 0) + 1;
    const creation = req.method === 'POST' && !chemin.endsWith('/addMessage');
    await attendre(creation ? lognormale(P.googleCreationMs, P.googleCreationP90Ms) : lognormale(P.googleAutreMs, P.googleAutreMs * 1.7));
    if (req.method === 'GET' && /loyaltyObject\//.test(chemin)) return json(res, 404, { error: { code: 404, message: 'not found' } });
    return json(res, 200, { id: chemin.split('/').pop() });
  }
  // Stockage Supabase, en mémoire (banc local).
  if (chemin.startsWith('/storage/v1/')) {
    const reste = chemin.slice('/storage/v1/'.length);
    if (reste === 'bucket') return json(res, 200, { name: 'passes' });
    if (reste.startsWith('object/list/')) return json(res, 200, []);
    if (reste.startsWith('object/') && req.method === 'DELETE') return json(res, 200, []);
    const cle = decodeURIComponent(reste.replace(/^object\/(public\/|authenticated\/)?/, ''));
    if (req.method === 'POST' || req.method === 'PUT') {
      stats.stockage.ecritures++;
      stockage.set(cle, contenu);
      return json(res, 200, { Key: cle });
    }
    stats.stockage.lectures++;
    if (!stockage.has(cle)) return json(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(stockage.get(cle));
  }
  json(res, 404, { error: 'imitateur : chemin inconnu' });
});

// Premier processus du conteneur sur Railway : sans ce gestionnaire, l'ordre
// d'arrêt serait ignoré et Railway tuerait l'imitateur au bout du délai.
process.on('SIGTERM', () => process.exit(0));

const portApns = Number(process.env.IMITATEUR_PORT_APNS || 0);
const portWeb = Number(process.env.IMITATEUR_PORT_WEB || 0);
apns.listen(portApns, () => web.listen(portWeb, () => {
  console.log(`[imitateur] prêt apns=${apns.address().port} web=${web.address().port} iphones=${P.iphones ? 'oui' : 'non'}`);
}));
