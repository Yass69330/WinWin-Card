// ════════════════════════════════════════════════════════════════════════════
// Hubrise dans l'admin WinWin (H1a) — authAdmin
//
//   GET  /api/admin/marchands/:id/hubrise          { configure, connexions: [...] }
//        (jamais le jeton, ni chiffré ni en clair)
//   POST /api/admin/marchands/:id/hubrise/lien     → 201 { url, expire_le } : lien de
//        connexion signé, usage unique, 30 min, à ouvrir sur place ou envoyer au marchand
//   POST /api/admin/hubrise/connexions/:id/couper  coupe la connexion (jeton effacé
//        en base), puis retire l'abonnement aux ventes et révoque le jeton chez
//        Hubrise, au mieux → { ok, desabonne, revoque }
//   POST /api/admin/hubrise/connexions/:id/abonner (H1b) abonne la location aux
//        ventes (idempotent) → { ok } | 409 { error: 'jeton_mort' } (connexion coupée
//        par Hubrise) | 502 { error: 'hubrise_…' }
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
const abonnement = require('./abonnement');

const FORME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const siUuid = (req, res, next) => (FORME_UUID.test(req.params.id) ? next() : res.status(404).json({ error: 'introuvable' }));
const COLONNES = 'id, account_id, location_id, nom_location, cree_le, coupee_le, coupee_par, dernier_evenement_le, callback_id';

router.get('/marchands/:id/hubrise', authAdmin, siUuid, asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from('hubrise_connexions').select(COLONNES)
    .eq('marchand_id', req.params.id).order('cree_le', { ascending: false }).limit(20);
  if (error) return res.status(500).json({ error: error.message });
  // callback_id (identifiant d'abonnement chez Hubrise) n'est rendu que sous la
  // forme « abonné : oui / non ».
  const connexions = (data || []).map(({ callback_id, ...c }) => ({ ...c, abonne: !c.coupee_le && !!callback_id }));
  res.json({ configure: config.etat().ok, connexions });
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
  // La connexion est coupée chez nous (jeton effacé) quoi qu'il arrive ensuite :
  // les ventes reçues pour cette location sont ignorées dès maintenant. Puis,
  // avec le jeton déchiffré une dernière fois : désabonnement, puis révocation.
  let desabonne = false, revoque = false;
  if (config.etat().ok) {
    const jeton = coffre.dechiffrer(r.jeton_chiffre, r.marchand_id, r.location_id);
    if (jeton) {
      desabonne = await hubrise.desabonner(jeton);
      revoque = await hubrise.revoquer(jeton);
    }
  }
  res.json({ ok: true, deja_coupee: false, desabonne, revoque });
}));

router.post('/hubrise/connexions/:id/abonner', authAdmin, siUuid, asyncHandler(async (req, res) => {
  const e = config.etat();
  if (!e.ok) return res.status(503).json({ error: 'hubrise_non_configure', manquants: e.manquants });
  const { data: c, error } = await supabase.from('hubrise_connexions')
    .select('id, marchand_id, location_id, jeton_chiffre, coupee_le').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!c) return res.status(404).json({ error: 'introuvable' });
  if (c.coupee_le) return res.status(409).json({ error: 'connexion_coupee' });
  const jeton = coffre.dechiffrer(c.jeton_chiffre, c.marchand_id, c.location_id);
  if (!jeton) return res.status(500).json({ error: 'jeton_illisible' });   // clé changée : reconnecter
  const r = await abonnement.abonner(c, jeton);
  if (r.ok) return res.json({ ok: true });
  if (r.raison === 'jeton_mort') return res.status(409).json({ error: 'jeton_mort' });
  return res.status(r.raison === 'base' ? 500 : 502).json({ error: r.raison });
}));

module.exports = router;
