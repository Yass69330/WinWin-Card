// ════════════════════════════════════════════════════════════════════════════
// /api/v1 — API machine des caisses (contrat docs/api/03-contrat-api-v1.md)
//
// Invariant du contrat (§0) : WinWin est additif, jamais bloquant. Ici : des
// réponses rapides et explicites (401, 403, 429, 503 + Retry-After), jamais une
// attente sans fin ; la caisse encaisse quoi qu'il arrive.
//
// Gardes, pour chaque requête :
//   1. ÉCHECS d'authentification comptés par adresse (30 / 15 min). Au-delà,
//      l'adresse ne peut plus ESSAYER de clé nouvelle (429, sans lecture en base) ;
//      une clé déjà reconnue valable passe toujours (revérifiée en base). Ainsi
//      une caisse mal réglée derrière un serveur central ne coupe pas les autres.
//   2. la clé (Authorization: Bearer wwk_…), jamais un jeton du dashboard ;
//   3. limiteur PAR CLÉ (600 / min). L'API est hors du limiteur global de
//      src/index.js (300 / 15 min par adresse), qui freinerait un serveur central.
//
// Routes : GET /ping (étape 1, vérifier sa clé) ; POST /ventes (étape 2, ventes.js ;
// téléphone à l'étape 3) ; POST /recuperations (étape 3, recuperations.js) ;
// POST /migrations (étape 4, migrations.js).
// ════════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const cle = require('./cle');

const FENETRE_ECHECS_MS = 15 * 60 * 1000;
const maxEchecs = () => Number(process.env.API_V1_ECHECS_MAX) || 30;
const echecs = new Map();   // adresse → { n, depuis }

function bloquee(ip) {
  const e = echecs.get(ip);
  if (!e) return 0;
  const reste = e.depuis + FENETRE_ECHECS_MS - Date.now();
  if (reste <= 0) { echecs.delete(ip); return 0; }
  return e.n >= maxEchecs() ? Math.ceil(reste / 1000) : 0;
}
function noterEchec(ip) {
  const e = echecs.get(ip);
  if (e && Date.now() - e.depuis < FENETRE_ECHECS_MS) { e.n++; return; }
  if (echecs.size >= 10000) echecs.clear();
  echecs.set(ip, { n: 1, depuis: Date.now() });
}

async function authCle(req, res, next) {
  const h = req.headers.authorization || '';
  const presentee = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  const attente = bloquee(req.ip);
  if (attente && !cle.dejaVue(presentee)) {
    return res.set('Retry-After', String(attente)).status(429).json({ error: 'trop_de_requetes' });
  }
  const v = await cle.verifier(presentee);
  if (v.erreur) {
    console.error('[api-v1] vérification de clé impossible :', v.erreur.message);
    return res.set('Retry-After', '30').status(503).json({ error: 'service_indisponible' });
  }
  if (!v.ok) {
    if (v.reason === 'cle_invalide') noterEchec(req.ip);
    return res.status(v.reason === 'commercant_suspendu' ? 403 : 401).json({ error: v.reason });
  }
  req.acces = v.acces;
  req.marchandId = v.acces.marchand_id;
  next();
}

const limiterCle = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.API_V1_MAX_PAR_MINUTE) || 600,
  keyGenerator: req => req.acces.cle_id,
  message: { error: 'trop_de_requetes' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(authCle, limiterCle);

// Vérifier sa clé (aide à l'intégration). Aucune donnée du commerçant.
router.get('/ping', (req, res) => res.json({ ok: true, environnement: req.acces.environnement }));

router.use('/ventes', require('./ventes'));
router.use('/recuperations', require('./recuperations'));
router.use('/migrations', require('./migrations'));

router.use((req, res) => res.status(404).json({ error: 'route_inconnue' }));

module.exports = router;
