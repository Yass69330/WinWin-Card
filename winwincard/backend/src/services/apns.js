// APNs — Apple Wallet push notifications
// Auth : JWT ES256 signé avec la clé .p8 (APN Auth Key, différente du certificat pass)
// Transport : HTTP/2 natif Node.js (node:http2), connexion persistante réutilisée.
//
// Variables d'environnement requises :
//   APPLE_APN_KEY_ID      — 10 chars, ex : ABC1DE2F3G (depuis le nom AuthKey_XXXXXXXXXX.p8)
//   APPLE_TEAM_ID         — déjà présent : LTW34ARCX2
//   APPLE_PASS_TYPE_IDENTIFIER — déjà présent : pass.com.winwincard.loyalty
//   APPLE_APN_KEY         — chemin vers certs/apn.p8 (dev)
//   APPLE_APN_KEY_B64     — contenu base64 du .p8 (Railway prod)

const http2 = require('node:http2');
const jwt   = require('jsonwebtoken');
const fs    = require('fs');
const path  = require('path');

// ── Config ────────────────────────────────────────────────────

function isApnsConfigured() {
  const keyId  = process.env.APPLE_APN_KEY_ID;
  const hasKey = !!(
    process.env.APPLE_APN_KEY_B64 ||
    process.env.APPLE_APN_KEY     ||
    fs.existsSync(path.resolve('./certs/apn.p8'))
  );
  return !!(keyId && hasKey);
}

function loadApnKey() {
  if (process.env.APPLE_APN_KEY_B64) {
    return Buffer.from(process.env.APPLE_APN_KEY_B64, 'base64').toString('utf8');
  }
  const p = process.env.APPLE_APN_KEY || path.resolve('./certs/apn.p8');
  if (!fs.existsSync(p)) {
    throw new Error(`Clé APNs introuvable : ${p}. Configurez APPLE_APN_KEY ou APPLE_APN_KEY_B64.`);
  }
  return fs.readFileSync(p, 'utf8');
}

// ── JWT APNs (ES256, mis en cache 45 min) ────────────────────
// Apple invalide les tokens après 1 h — on renouvelle avant.

let _apnsJwt   = null;
let _apnsJwtTs = 0;

function getApnsJwt() {
  const now = Math.floor(Date.now() / 1000);
  if (_apnsJwt && now - _apnsJwtTs < 2700) return _apnsJwt; // 45 min
  console.log(`[APNs] génération nouveau JWT (ancien âge: ${_apnsJwtTs ? now - _apnsJwtTs : 'n/a'}s)`);
  _apnsJwt = jwt.sign(
    { iss: process.env.APPLE_TEAM_ID },
    loadApnKey(),
    { algorithm: 'ES256', keyid: process.env.APPLE_APN_KEY_ID, expiresIn: '55m' }
  );
  _apnsJwtTs = now;
  return _apnsJwt;
}

// ── Session HTTP/2 persistante ────────────────────────────────
// Une seule connexion TCP/TLS réutilisée pour tous les push successifs.
// Reconnexion automatique sur GOAWAY, erreur réseau, ou session zombie
// (connexion coupée en silence — détectée par la borne 10 s de doRequest,
// puis le push est renvoyé UNE fois sur une session neuve par apnsRequest).

const APNS_HOST = process.env.NODE_ENV === 'production'
  ? 'https://api.push.apple.com'
  : 'https://api.sandbox.push.apple.com';

let _session       = null;
let _sessionCreatedAt = 0;

function getSession() {
  if (_session && !_session.destroyed) {
    console.log(`[APNs] session HTTP/2 réutilisée (âge: ${Math.floor(Date.now() / 1000) - _sessionCreatedAt}s)`);
    return _session;
  }
  console.log('[APNs] ouverture nouvelle session HTTP/2');
  _session = http2.connect(APNS_HOST);
  _sessionCreatedAt = Math.floor(Date.now() / 1000);
  _session.on('error',  e => { console.error('[APNs] session error:', e.message); _session = null; });
  _session.on('close',  () => { console.log('[APNs] session close'); _session = null; });
  _session.on('goaway', (code) => { console.log('[APNs] session goaway, code=', code); _session = null; });
  return _session;
}

// ── Envoi d'une requête APNs ─────────────────────────────────

function doRequest(pushToken, payload, isAlert) {
  return new Promise((resolve, reject) => {
    const session  = getSession();
    const topic    = process.env.APPLE_PASS_TYPE_IDENTIFIER || 'pass.com.winwincard.loyalty';
    const jwtAgeS  = Math.floor(Date.now() / 1000) - _apnsJwtTs;

    let req;
    try {
      req = session.request({
        ':method':       'POST',
        ':path':         `/3/device/${pushToken}`,
        'authorization': `bearer ${getApnsJwt()}`,
        'apns-topic':    topic,
        'apns-push-type': isAlert ? 'alert' : 'background',
        'apns-priority':  isAlert ? '10' : '5',
        'content-type':  'application/json',
      });
    } catch (e) {
      console.error(`[APNs] session.request() a levé une exception (jwt_age=${jwtAgeS}s):`, e.message);
      return reject(e);
    }

    let status = 0;
    let body   = '';

    req.on('response', h => { status = h[':status']; });
    req.on('data',  chunk => { body += chunk; });
    req.on('end', () => {
      let reason = null;
      try { reason = JSON.parse(body).reason || null; } catch {}

      console.log(
        `[APNs] réponse brute — token=…${pushToken.slice(-8)} status=${status} reason=${reason || '(aucune)'} ` +
        `jwt_age=${jwtAgeS}s push_type=${isAlert ? 'alert' : 'background'}`
      );

      if (status === 200) {
        resolve();
      } else {
        reject(new Error(`APNs ${status}: ${reason || body}`));
      }
    });
    req.on('error', e => {
      console.error(`[APNs] erreur stream HTTP/2 (jwt_age=${jwtAgeS}s):`, e.message, e.code || '');
      reject(e);
    });

    // Borne l'attente à 10 s : une session zombie (connexion coupée en silence
    // par le réseau, le serveur croit qu'elle est ouverte) ne répond JAMAIS —
    // sans borne, le push reste suspendu ~7 min jusqu'au read ETIMEDOUT TCP et
    // la mise à jour du pass est perdue (incident Magic Clean, 2026-07-15).
    // APNs répond normalement en < 1 s. req.destroy(err) passe par le handler
    // 'error' ci-dessus (log + reject), PUIS on jette la session présumée
    // morte — dans cet ordre : détruire la session d'abord fermerait le stream
    // sans notre code d'erreur et le retry ne se déclencherait pas.
    req.setTimeout(10000, () => {
      const err = new Error('timeout APNs (10s) — connexion présumée morte');
      err.code = 'APNS_TIMEOUT';
      req.destroy(err);
      try { session.destroy(); } catch {}
    });

    req.write(JSON.stringify(payload));
    req.end();
  });
}

// Retry unique sur erreur de connexion (session morte entre deux envois)
async function apnsRequest(pushToken, payload, isAlert) {
  try {
    await doRequest(pushToken, payload, isAlert);
  } catch (e) {
    const isConnErr = e.code === 'ERR_HTTP2_GOAWAY_SESSION' ||
                     e.code === 'ERR_HTTP2_STREAM_ERROR'    ||
                     e.code === 'ECONNRESET'                ||
                     e.code === 'ETIMEDOUT'                 || // ligne morte détectée (tard) par TCP
                     e.code === 'APNS_TIMEOUT'              || // ligne morte détectée par notre borne 10 s
                     (_session && _session.destroyed);
    if (isConnErr) {
      _session = null;
      await doRequest(pushToken, payload, isAlert);
    } else {
      throw e;
    }
  }
}

// ── API publique ──────────────────────────────────────────────

// Mise à jour silencieuse après scan — Apple re-télécharge le pass
async function sendPushUpdate(pushToken) {
  if (!isApnsConfigured()) {
    console.log('[APNs] Non configuré — push update ignoré');
    return;
  }
  try {
    await apnsRequest(pushToken, { aps: {} }, false);
  } catch (e) {
    console.error(`[APNs] Push update échoué (…${pushToken.slice(-8)}):`, e.message);
    throw e;
  }
}

// Notification visible depuis le dashboard marchand
async function sendPushNotification(pushToken, { titre, message }) {
  if (!isApnsConfigured()) {
    throw new Error('APNs non configuré : vérifiez APPLE_APN_KEY_ID et APPLE_APN_KEY / APPLE_APN_KEY_B64');
  }
  await apnsRequest(pushToken, {
    aps: {
      alert: { title: titre, body: message },
      sound: 'default',
    },
  }, true);
}

module.exports = { isApnsConfigured, sendPushUpdate, sendPushNotification };
