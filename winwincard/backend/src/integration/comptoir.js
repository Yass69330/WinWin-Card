// ════════════════════════════════════════════════════════════════════════════
// /api/comptoir — gestes du caissier (f04 côté comptoir, 20/10)
//
// Jeton boutique ou marchand (authScanner, comme le scan). Chaque route fait UN
// aller vers la base : la règle (format, un numéro = une carte, pas
// d'écrasement) vit dans une fonction SQL (migration 066), la route reste mince.
// Aucune de ces routes n'est appelée par le scan : elles partent au tap du
// caissier, jamais pendant un passage en caisse (règle n°1).
//
//   POST /cartes/:serial/telephone  { telephone, confirme }
//        confirme absent ou faux → aperçu (numéro normalisé, prénom), rien
//        d'écrit : l'écran demande « Attacher le … à la carte de … ? » ;
//        confirme = true → écriture + consentement (source « comptoir »).
//   POST /recherche      { telephone }  → prénom et solde de la carte, ou 404
//   POST /recuperations  { client_id }  → QR de 10 minutes, tracé
// ════════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const supabase = require('../services/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { authScanner } = require('../middleware/auth');

const FORME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function baseIndisponible(res, route, error) {
  console.error(`[comptoir] ${route} : base indisponible :`, error.message);
  return res.set('Retry-After', '30').status(503).json({ error: 'database_unavailable' });
}

function telephoneRecu(req) {
  const t = req.body.telephone;
  return typeof t === 'string' && t.trim() && t.length <= 40 ? t : null;
}

// Rechercher une carte par numéro dit le prénom et le solde d'un client : on
// limite le défilement de numéros, par boutique (30 par 15 min). Un comptoir
// réel en fait quelques-unes par jour.
const limiterRecherche = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.COMPTOIR_RECHERCHES_MAX) || 30,
  keyGenerator: req => `${req.marchandId}:${req.pointDeVenteId || '-'}`,
  message: { error: 'rate_limited' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/cartes/:serial/telephone', authScanner, asyncHandler(async (req, res) => {
  const telephone = telephoneRecu(req);
  if (!telephone) return res.status(400).json({ error: 'telephone_requis' });
  const { data, error } = await supabase.rpc('attacher_telephone', {
    p_marchand_id: req.marchandId, p_serial: String(req.params.serial),
    p_brut: telephone, p_source: 'comptoir', p_ecrire: req.body.confirme === true,
  });
  if (error) return baseIndisponible(res, 'attache', error);
  if (data.ok) return res.json(data);
  const statut = { numero_invalide: 400, carte_introuvable: 404 }[data.reason] || 409;
  res.status(statut).json({ error: data.reason, fin: data.fin, prenom_autre: data.prenom_autre });
}));

router.post('/recherche', authScanner, limiterRecherche, asyncHandler(async (req, res) => {
  const telephone = telephoneRecu(req);
  if (!telephone) return res.status(400).json({ error: 'telephone_requis' });
  const { data, error } = await supabase.rpc('trouver_carte_par_telephone', {
    p_marchand_id: req.marchandId, p_brut: telephone,
  });
  if (error) return baseIndisponible(res, 'recherche', error);
  if (!data.ok) return res.status(data.reason === 'numero_invalide' ? 400 : 404).json({ error: data.reason });
  res.json({ client_id: data.client_id, prenom: data.prenom, solde: data.solde });
}));

// Le jeton (128 bits) n'existe en clair que dans le QR : la base n'en garde que
// l'empreinte (sha256). Qui lit la table ne peut pas ouvrir une récupération.
router.post('/recuperations', authScanner, asyncHandler(async (req, res) => {
  const clientId = String(req.body.client_id || '').toLowerCase();
  if (!FORME_UUID.test(clientId)) return res.status(400).json({ error: 'client_id_requis' });
  const jeton = crypto.randomBytes(16).toString('hex');
  const { data, error } = await supabase.rpc('creer_recuperation', {
    p_marchand_id: req.marchandId, p_client_id: clientId,
    p_point_de_vente_id: req.pointDeVenteId, p_role: req.scannerRole,
    p_jeton_hash: crypto.createHash('sha256').update(jeton).digest('hex'),
  });
  if (error) return baseIndisponible(res, 'récupération', error);
  if (!data.ok) return res.status(404).json({ error: data.reason });
  const url = `${process.env.API_BASE_URL || 'https://app.winwin-card.com'}/r/${jeton}`;
  const qrcode = await require('qrcode').toDataURL(url, { width: 360, margin: 2 });
  res.status(201).json({ url, qrcode, expire_le: data.expire_le });
}));

module.exports = router;
