'use strict';

// ════════════════════════════════════════════════════════════════════════════
// FICHIER DE CAMPAGNE (étape 15 de la synthèse, §4.4) — chargé AVANT le serveur
// de test, et lui seul :
//   NODE_OPTIONS="--require <dossier>/tests/charge/campagne.js"
// Rien dans src/ ne le charge ; la production ne le charge pas (aucun
// NODE_OPTIONS) et ne l'embarque pas (.dockerignore). Aucun fichier de src/
// n'est modifié : tout se fait de l'extérieur, au chargement.
//
// 1. Garde-fous, avant toute chose (refus = sortie 1, le serveur ne démarre pas) :
//    - la base doit porter le marchand TÉMOIN, que seules les données factices
//      créent : jamais la base de production ;
//    - API_BASE_URL obligatoire, hors winwin-card.com : sinon les cartes et les
//      liens générés pointeraient vers la production (apple-pass.js:325) ;
//    - aucune vraie clé Apple ou Google fournie ; pas de SENTRY_DSN.
// 2. Clés factices fabriquées au démarrage : les cartes sont signées et poussées
//    pour de vrai (même calcul), avec des clés que personne n'accepte.
// 3. Sorties réseau : la base de test (SUPABASE_URL) et l'imitateur, rien
//    d'autre. Apple (APNs) et Google (OAuth, Wallet) sont redirigés vers
//    l'imitateur ; tout autre hôte est bloqué et compté.
// 4. Mesures côté serveur : GET /__campagne/mesures (?raz=1 pour remettre à
//    zéro après lecture). POST /__campagne/cron : lance un passage COMPLET du
//    cron, qu'aucune route ne permet en production (réponse immédiate ; la fin
//    se lit sur /health/cron, comme en production). GET /__campagne/sortie?url=… (ou
//    ?h2=…) : tente une sortie depuis le serveur et dit ce qu'il en advient
//    (preuve que la production et les vrais Apple et Google sont injoignables).
//    GET /__campagne/adresse : ce que le serveur reçoit (X-Forwarded-For, adresse
//    de la connexion) et l'adresse qu'Express en retient pour le limiteur
//    (proxy-addr avec la règle qu'Express tire de « trust proxy 1 », index.js:25 :
//    seul le premier intermédiaire est cru) — étape 17.
//    Tous exigent l'en-tête x-campagne-cle (dérivé du JWT_SECRET de test).
//
// Variables : CAMPAGNE_APNS (imitateur APNs, HTTP/2 en clair, ex.
// http://127.0.0.1:9001), CAMPAGNE_GOOGLE (imitateur Google, ex.
// http://127.0.0.1:9002), CAMPAGNE_TEMOIN (identifiant du marchand témoin).
// ════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const http2 = require('http2');
const { execFileSync } = require('child_process');
const { monitorEventLoopDelay } = require('perf_hooks');

const SRC = path.join(__dirname, '..', '..', 'src');
const TEMOIN = process.env.CAMPAGNE_TEMOIN || 'c0ffee15-0000-4000-8000-000000000015';
const HOTES_APPLE = new Set(['api.push.apple.com', 'api.sandbox.push.apple.com']);
const HOTES_GOOGLE = new Set(['oauth2.googleapis.com', 'walletobjects.googleapis.com']);

function refuser(raison) {
  console.error(`[campagne] REFUS : ${raison}. Le serveur de test ne démarre pas.`);
  process.exit(1);
}

// ── 1. Garde-fous ───────────────────────────────────────────────────────────
const VRAIES_CLES = ['APPLE_APN_KEY_B64', 'APPLE_APN_KEY', 'APPLE_SIGNER_CERT_B64', 'APPLE_SIGNER_CERT',
  'APPLE_SIGNER_KEY_B64', 'APPLE_SIGNER_KEY', 'APPLE_WWDR_CERT_B64', 'APPLE_WWDR_CERT', 'APPLE_PASS_PHRASE',
  'GOOGLE_SERVICE_ACCOUNT_JSON'];
for (const v of VRAIES_CLES) if (process.env[v]) refuser(`${v} est fourni (une campagne n'accepte que ses clés factices)`);
if (process.env.SENTRY_DSN) refuser('SENTRY_DSN est fourni (les erreurs du test iraient dans le Sentry de production)');
const base = process.env.API_BASE_URL || '';
if (!/^https?:\/\//.test(base)) refuser('API_BASE_URL absent (les cartes pointeraient vers la production)');
if (/winwin-card\.com/i.test(base)) refuser(`API_BASE_URL vise la production (${base})`);
for (const v of ['CAMPAGNE_APNS', 'CAMPAGNE_GOOGLE', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET']) {
  if (!process.env[v]) refuser(`${v} absent`);
}

// Le témoin, lu par le même client que le serveur (supabase-js), dans un process
// à part pour attendre la réponse avant de laisser le serveur démarrer.
const temoin = (() => {
  const code = `require(${JSON.stringify(require.resolve('@supabase/supabase-js', { paths: [SRC] }))})
    .createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
    .from('marchands').select('id').eq('id', ${JSON.stringify(TEMOIN)})
    .then(({ data, error }) => process.exit(error ? 4 : (data || []).length === 1 ? 0 : 3));`;
  try {
    execFileSync(process.execPath, ['-e', code], { env: { ...process.env, NODE_OPTIONS: '' }, timeout: 20000, stdio: 'ignore' });
    return 'présent';
  } catch (e) {
    return e.status === 3 ? 'absent' : `illisible (code ${e.status})`;
  }
})();
if (temoin !== 'présent') refuser(`marchand témoin ${TEMOIN} ${temoin} dans la base de ${process.env.SUPABASE_URL} — ce n'est pas une base de campagne`);

// ── 2. Clés factices ────────────────────────────────────────────────────────
const dossierCles = fs.mkdtempSync(path.join(os.tmpdir(), 'campagne-cles-'));
function certificat(nom) {
  const cle = path.join(dossierCles, `${nom}.key`), cert = path.join(dossierCles, `${nom}.pem`);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', cle, '-out', cert,
    '-days', '30', '-subj', `/CN=campagne-etape15-${nom}`], { stdio: 'ignore' });
  return { cle: fs.readFileSync(cle), cert: fs.readFileSync(cert) };
}
const signataire = certificat('signataire');
const wwdr = certificat('wwdr');
const b64 = buf => Buffer.from(buf).toString('base64');
Object.assign(process.env, {
  APPLE_TEAM_ID: 'CAMPAGNE15',
  APPLE_PASS_TYPE_IDENTIFIER: 'pass.campagne.etape15',
  APPLE_APN_KEY_ID: 'CAMPAGNE15',
  APPLE_APN_KEY_B64: b64(crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })),
  APPLE_SIGNER_CERT_B64: b64(signataire.cert),
  APPLE_SIGNER_KEY_B64: b64(signataire.cle),
  APPLE_WWDR_CERT_B64: b64(wwdr.cert),
  GOOGLE_WALLET_ISSUER_ID: '3388000000000000015',
  GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
    type: 'service_account', client_email: 'campagne-etape15@exemple.invalid',
    private_key: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' }),
  }),
});

// ── 4 (d'abord le stockage des mesures, utilisé par les sorties) ────────────
const series = new Map();      // clé → durées (ms)
const statuts = new Map();     // clé → { code: nombre }
const bloques = new Map();     // hôte → nombre de sorties refusées
let depuis = Date.now();
const boucle = monitorEventLoopDelay({ resolution: 10 });
boucle.enable();
let memoireMax = 0;
setInterval(() => { memoireMax = Math.max(memoireMax, process.memoryUsage().rss); }, 1000).unref();

function noter(cle, ms, code) {
  if (!series.has(cle)) series.set(cle, []);
  series.get(cle).push(ms);
  if (code !== undefined) {
    const s = statuts.get(cle) || {};
    s[code] = (s[code] || 0) + 1;
    statuts.set(cle, s);
  }
}
async function chronometrer(cle, fn) {
  const t0 = performance.now();
  try { return await fn(); } finally { noter(cle, performance.now() - t0); }
}

// ── 3. Sorties réseau ───────────────────────────────────────────────────────
const SUPABASE = new URL(process.env.SUPABASE_URL);
const APNS = new URL(process.env.CAMPAGNE_APNS);
const GOOGLE = new URL(process.env.CAMPAGNE_GOOGLE);
const PERMIS = new Set([SUPABASE.host, APNS.host, GOOGLE.host]);

function bloquer(hote) {
  bloques.set(hote, (bloques.get(hote) || 0) + 1);
  const e = new Error(`[campagne] sortie bloquée vers ${hote}`);
  e.code = 'CAMPAGNE_BLOQUE';
  return e;
}

// fetch : supabase-js (base, stockage) et Google (google-pass.js).
const fetchOrigine = globalThis.fetch;
globalThis.fetch = async function fetchCampagne(entree, init) {
  const url = new URL(typeof entree === 'string' || entree instanceof URL ? entree : entree.url);
  if (HOTES_GOOGLE.has(url.host)) {
    const cible = `${GOOGLE.origin}/${url.host}${url.pathname}${url.search}`;
    const op = url.host === 'oauth2.googleapis.com' ? 'jeton'
      : url.pathname.endsWith('/addMessage') ? 'message'
      : `${(init && init.method) || 'GET'} ${url.pathname.split('/')[3] || ''}`.trim();
    return chronometrer(`google ${op}`, () => fetchOrigine(cible, init));
  }
  if (!PERMIS.has(url.host)) throw bloquer(url.host);
  if (url.host === SUPABASE.host) {
    const morceaux = url.pathname.split('/');   // /rest/v1/<table|rpc>/<fonction>
    const quoi = url.pathname.startsWith('/storage/') ? `stockage ${(init && init.method) || 'GET'}`
      : `base ${(init && init.method) || 'GET'} ${morceaux[3] === 'rpc' ? `rpc/${morceaux[4]}` : morceaux[3]}`;
    return chronometrer(quoi, () => fetchOrigine(entree, init));
  }
  return fetchOrigine(entree, init);
};

// HTTP/2 : APNs (apns.js:74 ouvre sa session au moment de l'envoi).
const connectOrigine = http2.connect;
http2.connect = function connectCampagne(autorite, ...reste) {
  const hote = new URL(typeof autorite === 'string' ? autorite : autorite.href).host;
  if (HOTES_APPLE.has(hote)) return connectOrigine.call(http2, APNS.origin, ...reste);
  if (!PERMIS.has(hote)) throw bloquer(hote);
  return connectOrigine.call(http2, autorite, ...reste);
};

// http(s).get / request : images des cartes (apple-pass.js, fetchImage).
for (const mod of [http, https]) {
  for (const nom of ['request', 'get']) {
    const origine = mod[nom];
    mod[nom] = function sortieCampagne(a, ...reste) {
      const hote = typeof a === 'string' ? new URL(a).host
        : a instanceof URL ? a.host : (a && (a.host || a.hostname)) || 'localhost';
      if (!PERMIS.has(hote) && !PERMIS.has(`${hote}:${a && a.port}`)) throw bloquer(hote);
      return origine.call(mod, a, ...reste);
    };
  }
}

// ── 4. Mesures : rendus, cartes, push ───────────────────────────────────────
// Avant que strip-cache.js ne garde sa propre référence à render().
const generateur = require(path.join(SRC, 'services', 'strip-generator'));
const renderOrigine = generateur.render;
generateur.render = args => chronometrer('rendu bandeau', () => renderOrigine(args));
const applePass = require(path.join(SRC, 'services', 'apple-pass'));
const genererOrigine = applePass.generateApplePass;
applePass.generateApplePass = args => chronometrer('carte apple', () => genererOrigine(args));
const apns = require(path.join(SRC, 'services', 'apns'));
const pushOrigine = apns.sendPushUpdate;
apns.sendPushUpdate = jeton => chronometrer('push apple', () => pushOrigine(jeton));

function quantiles(valeurs) {
  const v = [...valeurs].sort((x, y) => x - y);
  const q = p => (v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : null);
  const r = x => (x === null ? null : Math.round(x * 10) / 10);
  return { n: v.length, p50: r(q(0.5)), p95: r(q(0.95)), p99: r(q(0.99)), max: r(v[v.length - 1] ?? null) };
}
function lireMesures(raz) {
  const tout = {};
  for (const [cle, v] of [...series.entries()].sort()) tout[cle] = { ...quantiles(v), ...(statuts.has(cle) ? { statuts: statuts.get(cle) } : {}) };
  const ns = x => Math.round(x / 1e4) / 100;   // ns → ms, 2 décimales
  const resultat = {
    duree_s: Math.round((Date.now() - depuis) / 1000),
    mesures: tout,
    boucle_ms: { p50: ns(boucle.percentile(50)), p99: ns(boucle.percentile(99)), max: ns(boucle.max) },
    memoire_mo: { rss_max: Math.round(memoireMax / 1048576), rss: Math.round(process.memoryUsage().rss / 1048576) },
    sorties_bloquees: Object.fromEntries(bloques),
  };
  if (raz) { series.clear(); statuts.clear(); boucle.reset(); memoireMax = 0; depuis = Date.now(); }
  return resultat;
}

// Une clé par route : identifiants et jetons remplacés, requête sans paramètres.
function route(req) {
  return `${req.method} ${req.url.split('?')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/[0-9a-f]{20,}/gi, '/:jeton')
    .replace(/\/appareil-\d+/g, '/:appareil')
    .replace(/\/l\/[^/]+/, '/l/:slug')}`;
}

const CLE = crypto.createHash('sha256').update(`${process.env.JWT_SECRET}:campagne`).digest('hex').slice(0, 32);
const emitOrigine = http.Server.prototype.emit;
http.Server.prototype.emit = function emitCampagne(evenement, req, res) {
  if (evenement !== 'request') return emitOrigine.apply(this, arguments);
  if (req.url.startsWith('/__campagne/')) {
    if (req.headers['x-campagne-cle'] !== CLE) { res.writeHead(404); res.end(); return true; }
    try { return sonde(req, res); } catch (e) { res.writeHead(500); res.end(e.message); return true; }
  }
  // Clé lue tout de suite : Express réécrit req.url dans ses routeurs.
  const cle = route(req), t0 = performance.now();
  res.on('finish', () => noter(cle, performance.now() - t0, res.statusCode));
  return emitOrigine.apply(this, arguments);
};

// Les sondes de campagne (clé déjà vérifiée).
function sonde(req, res) {
  if (req.method === 'GET' && req.url.startsWith('/__campagne/mesures')) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(lireMesures(/[?&]raz=1/.test(req.url))));
    return true;
  }
  if (req.method === 'GET' && req.url.startsWith('/__campagne/sortie')) {
    const q = new URL(req.url, 'http://x').searchParams;
    const repondre = v => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(v)); };
    if (q.get('h2')) {
      let session;
      try { session = http2.connect(q.get('h2')); } catch (e) { return repondre({ h2: q.get('h2'), resultat: e.message }); }
      session.on('error', e => repondre({ h2: q.get('h2'), resultat: `erreur ${e.code || e.message}` }));
      session.on('connect', () => {
        repondre({ h2: q.get('h2'), resultat: `connecté à ${session.socket.remoteAddress}:${session.socket.remotePort}` });
        session.close();
      });
      return true;
    }
    fetch(q.get('url'), { method: 'GET' })
      .then(r => repondre({ url: q.get('url'), resultat: `réponse ${r.status}`, servi_par: r.headers.get('x-servi-par') }))
      .catch(e => repondre({ url: q.get('url'), resultat: e.message }));
    return true;
  }
  if (req.method === 'GET' && req.url === '/__campagne/adresse') {
    const proxyaddr = require(require.resolve('proxy-addr', { paths: [SRC] }));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ x_forwarded_for: req.headers['x-forwarded-for'] || null,
      connexion: req.socket.remoteAddress, ip_retenue: proxyaddr(req, (adresse, rang) => rang < 1) }));
    return true;
  }
  if (req.method === 'POST' && req.url === '/__campagne/cron') {
    const t0 = performance.now();
    require(path.join(SRC, 'workers', 'cron')).passageQuotidien()
      .then(() => console.log(`[campagne] passage du cron fini en ${Math.round(performance.now() - t0)} ms`))
      .catch(e => console.error(`[campagne] passage du cron en échec : ${e.message}`));
    res.end(JSON.stringify({ lance: true }));
    return true;
  }
  res.writeHead(404); res.end(); return true;
}

console.log(`[campagne] actif : témoin présent, clés factices, sorties permises ${[...PERMIS].join(', ')} ; ` +
  `Apple → ${APNS.origin}, Google → ${GOOGLE.origin}`);
