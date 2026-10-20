// ════════════════════════════════════════════════════════════════════════════
// Récupération de carte — côté client (f04 côté comptoir, 20/10)
//
// Le client scanne le QR affiché par la caisse avec l'appareil photo de son
// nouveau téléphone : /r/:jeton ouvre public/recuperation.html, qui lit
// /api/recuperation/:jeton et propose « Ajouter à Apple Wallet / Google Wallet »
// pour LA MÊME carte (même numéro de série, même solde). Public, sans compte :
// le jeton (10 minutes) est la seule clé. Chaque ouverture est comptée en base.
// ════════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const path = require('path');
const crypto = require('crypto');
const supabase = require('../services/supabase');
const asyncHandler = require('../utils/asyncHandler');

const PAGE = path.resolve(__dirname, '../../public/recuperation.html');
const FORME_JETON = /^[0-9a-f]{32}$/;

router.get('/r/:jeton', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(PAGE, err => { if (err) res.status(500).send('Erreur serveur'); });
});

router.get('/api/recuperation/:jeton', asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const jeton = String(req.params.jeton).toLowerCase();
  if (!FORME_JETON.test(jeton)) return res.status(404).json({ error: 'introuvable' });
  const { data, error } = await supabase.rpc('ouvrir_recuperation', {
    p_jeton_hash: crypto.createHash('sha256').update(jeton).digest('hex'),
  });
  if (error) {
    console.error('[recuperation] base indisponible :', error.message);
    return res.set('Retry-After', '30').status(503).json({ error: 'database_unavailable' });
  }
  if (!data.ok) return res.status(data.reason === 'expire' ? 410 : 404).json({ error: data.reason });
  const base = process.env.API_BASE_URL || 'https://app.winwin-card.com';
  res.json({
    prenom: data.prenom, marchand: data.marchand, langue: data.langue,
    apple_pass_url: `${base}/api/passes/${data.serial}/apple`,
    google_wallet_url: data.google ? `${base}/api/passes/${data.serial}/google` : null,
  });
}));

module.exports = router;
