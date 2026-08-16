const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const supabase = require('../services/supabase');
const asyncHandler = require('../utils/asyncHandler');

// POST /api/scanner/login — login unifié de la PWA scanner (multi-boutiques, 3c)
//
// Essaie D'ABORD un login BOUTIQUE (scanner_login), puis retombe sur le login
// MARCHAND (mono-site). Sur un réseau provisionné, le login marchand est REFUSÉ
// (durcissement) — le mot de passe marchand a pu circuler, il ne doit pas être
// une porte d'entrée au scan d'un réseau.
//
// Codes d'erreur métier renvoyés à la PWA :
//   • access_disabled    → boutique coupée (actif=false) ou archivée
//   • use_boutique_login → réseau : le login marchand n'est pas accepté au scan
router.post('/login', asyncHandler(async (req, res) => {
  const { identifiant, password, remember_device } = req.body;
  const ident = typeof identifiant === 'string' ? identifiant.trim() : '';
  if (!ident || !password) {
    return res.status(400).json({ error: 'identifiant and password required' });
  }

  const { comparePassword } = require('../services/auth-utils');
  const expiresIn = remember_device ? '365d' : '7d';

  // ── 1) Login BOUTIQUE ──────────────────────────────────────────────────────
  // scanner_login est stocké en minuscules → match exact sûr (jamais d'ilike,
  // qui traiterait % et _ comme des jokers sur une saisie utilisateur).
  const { data: boutique } = await supabase
    .from('points_de_vente')
    .select('id, nom, marchand_id, scanner_password_hash, actif, deleted_at, marchands(slug, langue, type_programme, actif, nom)')
    .eq('scanner_login', ident.toLowerCase())
    .is('deleted_at', null)
    .maybeSingle();

  if (boutique && boutique.scanner_password_hash) {
    const valid = await comparePassword(password, boutique.scanner_password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    if (!boutique.actif)            return res.status(403).json({ error: 'access_disabled' });
    if (!boutique.marchands?.actif) return res.status(403).json({ error: 'Account suspended' });

    const token = jwt.sign(
      { role: 'scanner', marchand_id: boutique.marchand_id, point_de_vente_id: boutique.id, nom: boutique.nom },
      process.env.JWT_SECRET, { expiresIn }
    );
    return res.json({
      token,
      marchand_id: boutique.marchand_id,
      point_de_vente_id: boutique.id,
      nom: boutique.marchands?.nom,
      boutique: boutique.nom,
      slug: boutique.marchands?.slug,
      langue: boutique.marchands?.langue,
      type_programme: boutique.marchands?.type_programme,
    });
  }

  // ── 2) Repli login MARCHAND (mono-site) — par slug, puis par email ──────────
  let { data: marchand } = await supabase
    .from('marchands')
    .select('id, nom, slug, langue, type_programme, password_hash, actif')
    .eq('slug', ident)
    .maybeSingle();
  if (!marchand) {
    ({ data: marchand } = await supabase
      .from('marchands')
      .select('id, nom, slug, langue, type_programme, password_hash, actif')
      .eq('email_contact', ident)
      .maybeSingle());
  }

  if (!marchand) return res.status(401).json({ error: 'Invalid credentials' });
  const validM = await comparePassword(password, marchand.password_hash);
  if (!validM) return res.status(401).json({ error: 'Invalid credentials' });
  if (!marchand.actif) return res.status(403).json({ error: 'Account suspended' });

  // Durcissement : si ce marchand a AU MOINS une boutique provisionnée
  // (non archivée + login posé), le login marchand n'est pas accepté au scan.
  // S'appuie sur l'index partiel idx_points_de_vente_reseau_actif (migration 034).
  const { data: reseau } = await supabase
    .from('points_de_vente')
    .select('id')
    .eq('marchand_id', marchand.id)
    .is('deleted_at', null)
    .not('scanner_login', 'is', null)
    .limit(1);
  if (reseau && reseau.length > 0) {
    return res.status(403).json({ error: 'use_boutique_login' });
  }

  // Mono-site : token marchand, identique à /api/merchants/login.
  const token = jwt.sign(
    { role: 'marchand', marchand_id: marchand.id, nom: marchand.nom },
    process.env.JWT_SECRET, { expiresIn }
  );
  res.json({
    token,
    marchand_id: marchand.id,
    nom: marchand.nom,
    slug: marchand.slug,
    langue: marchand.langue,
    type_programme: marchand.type_programme,
  });
}));

module.exports = router;
