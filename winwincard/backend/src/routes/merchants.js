const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const supabase = require('../services/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { authMarchand } = require('../middleware/auth');

// POST /merchants/login — connexion marchand (email ou slug + password)
// remember_device: true → JWT 1 an (scanner PWA installée), false → 7j (dashboard)
router.post('/login', asyncHandler(async (req, res) => {
  const { email, slug, password, remember_device } = req.body;
  const identifier = slug || email;
  if (!identifier || !password) {
    return res.status(400).json({ error: 'slug (or email) and password required' });
  }

  const field = slug ? 'slug' : 'email_contact';
  const { data: marchand } = await supabase
    .from('marchands')
    .select('id, nom, slug, langue, type_programme, email_contact, password_hash, actif')
    .eq(field, identifier)
    .single();

  if (!marchand) return res.status(401).json({ error: 'Invalid credentials' });
  if (!marchand.actif) return res.status(403).json({ error: 'Account suspended' });

  const { comparePassword } = require('../services/auth-utils');
  const valid = await comparePassword(password, marchand.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const expiresIn = remember_device ? '365d' : '7d';
  const token = jwt.sign(
    { role: 'marchand', marchand_id: marchand.id, nom: marchand.nom },
    process.env.JWT_SECRET,
    { expiresIn }
  );

  res.json({ token, marchand_id: marchand.id, nom: marchand.nom, slug: marchand.slug, langue: marchand.langue, type_programme: marchand.type_programme });
}));

// GET /merchants/me — profil du marchand connecté
router.get('/me', authMarchand, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('marchands')
    .select('id, nom, slug, logo_url, couleur_fond, couleur_texte, couleur_label, image_strip_url, texte_landing, max_value, display_max_value, forfait, langue, type_programme, email_contact')
    .eq('id', req.marchandId)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}));

// GET /merchants/me/stats — stats du dashboard + analytics 30j
router.get('/me/stats', authMarchand, asyncHandler(async (req, res) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ count: totalClients }, { count: scansAujourdhui }, { data: scansRecent }] = await Promise.all([
    supabase.from('clients').select('*', { count: 'exact', head: true }).eq('marchand_id', req.marchandId).is('deleted_at', null),
    supabase.from('scans').select('*', { count: 'exact', head: true }).eq('marchand_id', req.marchandId).gte('date_scan', new Date().toISOString().split('T')[0]),
    supabase.from('scans').select('client_id').eq('marchand_id', req.marchandId).gte('date_scan', thirtyDaysAgo),
  ]);

  const ids = (scansRecent || []).map(s => s.client_id);
  const activeClients = new Set(ids).size;

  const countByClient = {};
  ids.forEach(id => { countByClient[id] = (countByClient[id] || 0) + 1; });
  const retained = Object.values(countByClient).filter(c => c >= 2).length;

  const retentionRate = totalClients > 0 ? Math.round(retained / totalClients * 100) : 0;
  const avgFrequency  = activeClients > 0 ? parseFloat((ids.length / activeClients).toFixed(1)) : 0;

  res.json({
    total_clients:       totalClients,
    scans_aujourdhui:    scansAujourdhui,
    active_clients_30d:  activeClients,
    retention_rate:      retentionRate,
    avg_frequency:       avgFrequency,
  });
}));

// GET /merchants/me/group-stats — agrégats du dashboard groupe (réseau).
// Délègue tout le GROUP BY à la fonction SQL group_stats (lecture seule) : Postgres
// agrège et renvoie un petit jsonb, ce qui évite la troncature PostgREST à 1000
// lignes qui fausserait un réseau. Renvoie tel quel le jsonb (réseau, boutiques,
// distribution, scans_non_attribues).
router.get('/me/group-stats', authMarchand, asyncHandler(async (req, res) => {
  const { data, error } = await supabase.rpc('group_stats', { p_marchand_id: req.marchandId });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || {});
}));

// GET /merchants/qrcode — QR code de la landing page du marchand
router.get('/me/qrcode', authMarchand, asyncHandler(async (req, res) => {
  const { data: marchand } = await supabase
    .from('marchands')
    .select('slug')
    .eq('id', req.marchandId)
    .single();

  if (!marchand) return res.status(404).json({ error: 'Merchant not found' });

  const QRCode = require('qrcode');
  const url = `${process.env.API_BASE_URL || 'https://app.winwin-card.com'}/l/${marchand.slug}`;
  const qr = await QRCode.toDataURL(url, { width: 400, margin: 2 });

  res.json({ url, qrcode: qr });
}));

// ── Points de vente (boutiques du réseau) — lecture + renommage (OWNER) ──────
// Multi-boutiques, étape 2. Le franchiseur LIT ses boutiques et peut les
// RENOMMER (neutre pour la facturation). Création et archivage = admin (ils
// changent le nombre facturé). Un mono-site n'a aucune ligne → liste vide,
// l'UI reste masquée côté dashboard.

// GET /merchants/me/points-de-vente — boutiques actives du réseau
router.get('/me/points-de-vente', authMarchand, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('points_de_vente')
    .select('id, nom, created_at, actif')
    .eq('marchand_id', req.marchandId)
    .is('deleted_at', null)
    .order('nom');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
}));

// PATCH /merchants/me/points-de-vente/:id — renommer une de SES boutiques
router.patch('/me/points-de-vente/:id', authMarchand, asyncHandler(async (req, res) => {
  const nom = typeof req.body.nom === 'string' ? req.body.nom.trim().slice(0, 80) : '';
  if (!nom) return res.status(400).json({ error: 'nom is required' });

  // Scope marchand_id : le propriétaire ne renomme QUE ses propres boutiques
  // actives. 23505 = l'index unique (marchand_id, lower(nom)) rejette un doublon.
  const { data, error } = await supabase
    .from('points_de_vente')
    .update({ nom })
    .eq('id', req.params.id)
    .eq('marchand_id', req.marchandId)
    .is('deleted_at', null)
    .select('id, nom')
    .single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Une boutique active porte déjà ce nom' });
    return res.status(404).json({ error: 'Boutique introuvable' });
  }
  res.json(data);
}));

// PATCH /merchants/me/points-de-vente/:id/actif — couper / rétablir l'accès
// scanner d'une boutique. Levier FRANCHISEUR, réversible, NEUTRE pour la
// facturation (≠ archivage). Effet immédiat : le scan relit `actif` en base à
// chaque passage → le scan suivant de la boutique coupée est refusé.
router.patch('/me/points-de-vente/:id/actif', authMarchand, asyncHandler(async (req, res) => {
  const actif = req.body.actif === true || req.body.actif === false ? req.body.actif : null;
  if (actif === null) return res.status(400).json({ error: 'actif (boolean) is required' });

  const { data, error } = await supabase
    .from('points_de_vente')
    .update({ actif })
    .eq('id', req.params.id)
    .eq('marchand_id', req.marchandId) // le propriétaire ne touche QUE ses boutiques
    .is('deleted_at', null)
    .select('id, nom, actif')
    .single();

  if (error) return res.status(404).json({ error: 'Boutique introuvable' });
  res.json(data);
}));

// GET /merchants/:slug/public — infos publiques pour la landing page
router.get('/:slug/public', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('marchands')
    .select('id, nom, slug, logo_url, icon_url, image_strip_url, texte_landing, couleur_fond, couleur_texte, max_value, actif, forfait, langue, type_programme, landing_premium, referral_enabled, referral_bonus_points')
    .eq('slug', req.params.slug)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Merchant not found' });
  if (!data.actif) return res.status(403).json({ error: 'Program suspended' });

  res.json(data);
}));

module.exports = router;
