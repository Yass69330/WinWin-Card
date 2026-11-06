// ════════════════════════════════════════════════════════════════════════════
// Hubrise dans l'admin WinWin (H1a) — authAdmin
//
//   GET  /api/admin/marchands/:id/hubrise          { configure, connexions: [...] }
//        (jamais le jeton, ni chiffré ni en clair)
//   POST /api/admin/marchands/:id/hubrise/lien     → 201 { url, expire_le } : lien de
//        connexion signé, usage unique, 30 min, à ouvrir sur place ou envoyer au marchand
//   POST /api/admin/hubrise/connexions/:id/couper  coupe la connexion (jeton effacé
//        en base), puis révoque le jeton chez Hubrise, au mieux → { ok, revoque }
// ════════════════════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const router = express.Router();
const supabase = require('../../services/supabase');
const asyncHandler = require('../../utils/asyncHandler');
const { authAdmin } = require('../../middleware/auth');
const config = require('./config');
const lien = require('./lien');
const coffre = require('./coffre');
const hubrise = require('./api-hubrise');

const FORME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const siUuid = (req, res, next) => (FORME_UUID.test(req.params.id) ? next() : res.status(404).json({ error: 'introuvable' }));
const COLONNES = 'id, account_id, location_id, nom_location, cree_le, coupee_le, coupee_par, dernier_evenement_le';

router.get('/marchands/:id/hubrise', authAdmin, siUuid, asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from('hubrise_connexions').select(COLONNES)
    .eq('marchand_id', req.params.id).order('cree_le', { ascending: false }).limit(20);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ configure: config.etat().ok, connexions: data || [] });
}));

router.post('/marchands/:id/hubrise/lien', authAdmin, siUuid, asyncHandler(async (req, res) => {
  const e = config.etat();
  if (!e.ok) return res.status(503).json({ error: 'hubrise_non_configure', manquants: e.manquants });
  const { data: m, error } = await supabase.from('marchands').select('id').eq('id', req.params.id).eq('actif', true).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!m) return res.status(404).json({ error: 'Marchand introuvable ou inactif' });
  const { url, expire_le } = lien.creer(m.id);
  res.status(201).json({ url, expire_le });
}));

router.post('/hubrise/connexions/:id/couper', authAdmin, siUuid, asyncHandler(async (req, res) => {
  const { data: r, error } = await supabase.rpc('hubrise_couper_connexion', { p_connexion_id: req.params.id, p_par: 'winwin' });
  if (error) return res.status(500).json({ error: error.message });
  if (!r.ok) return res.status(404).json({ error: 'introuvable' });
  if (r.deja_coupee) return res.json({ ok: true, deja_coupee: true, revoque: false });
  // La connexion est coupée chez nous (jeton effacé) quoi qu'il arrive ensuite.
  let revoque = false;
  if (config.etat().ok) {
    const jeton = coffre.dechiffrer(r.jeton_chiffre, r.marchand_id, r.location_id);
    if (jeton) revoque = await hubrise.revoquer(jeton);
  }
  res.json({ ok: true, deja_coupee: false, revoque });
}));

module.exports = router;
