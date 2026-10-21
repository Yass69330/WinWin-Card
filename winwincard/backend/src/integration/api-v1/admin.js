// ════════════════════════════════════════════════════════════════════════════
// Administration de l'API des caisses — admin WinWin seulement (authAdmin)
//
// Clés d'API :
//   GET  /api/admin/marchands/:id/cles-api        liste (jamais la clé ni son empreinte)
//   POST /api/admin/marchands/:id/cles-api        { environnement: 'live' | 'test' }
//        → 201 { cle, … } : la SEULE fois où la clé est visible
//   POST /api/admin/cles-api/:cleId/revoquer      révocation (immédiate sur ce serveur,
//        60 s au plus ailleurs, voir cle.js)
// Boutiques (étape 2, 21/10) :
//   PATCH /api/admin/points-de-vente/:id/code-caisse  { code_externe }  code du magasin
//        dans la caisse du commerçant (champ `boutique` des ventes) ; vide = retiré
// ════════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const supabase = require('../../services/supabase');
const asyncHandler = require('../../utils/asyncHandler');
const { authAdmin } = require('../../middleware/auth');
const cle = require('./cle');

const FORME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COLONNES = 'id, environnement, prefixe, cree_le, revoquee_le, derniere_utilisation_le';
const siUuid = nom => (req, res, next) => (FORME_UUID.test(req.params[nom]) ? next() : res.status(404).json({ error: 'introuvable' }));

router.get('/marchands/:id/cles-api', authAdmin, siUuid('id'), asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from('api_cles').select(COLONNES)
    .eq('marchand_id', req.params.id).order('cree_le', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
}));

router.post('/marchands/:id/cles-api', authAdmin, siUuid('id'), asyncHandler(async (req, res) => {
  const environnement = req.body.environnement === 'test' ? 'test' : req.body.environnement === 'live' ? 'live' : null;
  if (!environnement) return res.status(400).json({ error: 'environnement : live ou test' });
  const { data: m, error: errM } = await supabase.from('marchands').select('id').eq('id', req.params.id).maybeSingle();
  if (errM) return res.status(500).json({ error: errM.message });
  if (!m) return res.status(404).json({ error: 'Marchand introuvable' });
  const n = cle.nouvelleCle(environnement);
  const { data, error } = await supabase.from('api_cles')
    .insert({ marchand_id: m.id, environnement, prefixe: n.prefixe, empreinte: n.empreinte })
    .select(COLONNES).single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ ...data, cle: n.cle });
}));

router.post('/cles-api/:cleId/revoquer', authAdmin, siUuid('cleId'), asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from('api_cles')
    .update({ revoquee_le: new Date().toISOString() })
    .eq('id', req.params.cleId).is('revoquee_le', null)
    .select(COLONNES).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  cle.oublier(req.params.cleId);
  if (data) return res.json(data);
  // Déjà révoquée (ou inconnue) : on le dit sans rien changer.
  const { data: deja } = await supabase.from('api_cles').select(COLONNES).eq('id', req.params.cleId).maybeSingle();
  if (!deja) return res.status(404).json({ error: 'Clé introuvable' });
  res.json(deja);
}));

// Code caisse d'une boutique : unique par commerçant parmi ses boutiques actives
// (index de la migration 067). Dès qu'une boutique a un code, toute vente de ce
// commerçant doit porter un code de boutique connu.
router.patch('/points-de-vente/:id/code-caisse', authAdmin, siUuid('id'), asyncHandler(async (req, res) => {
  const brut = req.body.code_externe;
  const code = brut == null || String(brut).trim() === '' ? null : String(brut).trim();
  if (code !== null && !/^[A-Za-z0-9._:/-]{1,64}$/.test(code)) {
    return res.status(400).json({ error: 'Code caisse : 1 à 64 caractères parmi lettres, chiffres et . _ - : /' });
  }
  const { data, error } = await supabase.from('points_de_vente').update({ code_externe: code })
    .eq('id', req.params.id).is('deleted_at', null).select('id, nom, code_externe').maybeSingle();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Une autre boutique de ce marchand porte déjà ce code' });
    return res.status(500).json({ error: error.message });
  }
  if (!data) return res.status(404).json({ error: 'Boutique introuvable' });
  res.json(data);
}));

module.exports = router;
