// ════════════════════════════════════════════════════════════════════════════
// POST /api/v1/recuperations — récupérer une carte (contrat v1 §7, étape 3, 22/10)
//
// Le client est en magasin, sur son nouveau téléphone ; la caisse connaît son
// numéro. WinWin rend un lien de 10 minutes (et son QR) vers la MÊME carte
// (public/recuperation.html, src/integration/recuperation.js). Le jeton n'existe
// en clair que dans cette réponse ; la base n'en garde que l'empreinte, avec la
// boutique et l'heure (recuperations_carte, migration 068).
// Limite : 30 demandes par 15 minutes et par boutique (par clé et code boutique).
// ════════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const supabase = require('../../services/supabase');
const asyncHandler = require('../../utils/asyncHandler');
const { trouverParTelephone } = require('./telephone');
const { lireBoutiques, choisirBoutique } = require('./boutiques');

const indisponible = (res, etape, error) => {
  console.error(`[api-v1] récupération, ${etape} impossible :`, error.message);
  return res.set('Retry-After', '30').status(503).json({ error: 'service_indisponible' });
};

const limiterBoutique = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.API_V1_RECUP_MAX) || 30,
  keyGenerator: req => `${req.acces.cle_id}:${typeof req.body.boutique === 'string' ? req.body.boutique : '-'}`,
  message: { error: 'trop_de_requetes' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/', limiterBoutique, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const invalide = champ => res.status(400).json({ error: 'corps_invalide', champ });
  if (typeof b.telephone !== 'string' || !b.telephone.trim() || b.telephone.length > 40) return invalide('telephone');
  if (b.boutique != null && (typeof b.boutique !== 'string' || !/^[A-Za-z0-9._:/-]{1,64}$/.test(b.boutique))) return invalide('boutique');

  const { data: boutiques, error: errB } = await lireBoutiques(req.marchandId);
  if (errB) return indisponible(res, 'lecture des boutiques', errB);
  const boutique = choisirBoutique(boutiques, b.boutique);
  if (boutique.statut) return res.status(boutique.statut).json(boutique.corps);

  const t = await trouverParTelephone(req.marchandId, b.telephone);
  if (t.erreur) return indisponible(res, 'lecture de la carte', t.erreur);
  if (t.invalide) return invalide('telephone');
  if (!t.client) return res.status(404).json({ error: 'telephone_inconnu' });

  const jeton = crypto.randomBytes(16).toString('hex');
  const { data, error } = await supabase.rpc('creer_recuperation', {
    p_marchand_id: req.marchandId, p_client_id: t.client.id, p_point_de_vente_id: boutique.id, p_role: 'api',
    p_jeton_hash: crypto.createHash('sha256').update(jeton).digest('hex'),
  });
  if (error) return indisponible(res, 'création du lien', error);
  if (!data || !data.ok) return res.status(404).json({ error: 'telephone_inconnu' });
  const url = `${process.env.API_BASE_URL || 'https://app.winwin-card.com'}/r/${jeton}`;
  const qrcode = await require('qrcode').toDataURL(url, { width: 360, margin: 2 });
  res.status(201).json({ url, expire_le: data.expire_le, qrcode_png: qrcode, solde: t.client.stored_value });
}));

module.exports = router;
