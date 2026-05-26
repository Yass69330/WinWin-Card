const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const supabase = require('../services/supabase');
const { authAdmin } = require('../middleware/auth');

// POST /api/admin/login — authentification admin par mot de passe global
router.post('/login', async (req, res) => {
  const { password } = req.body;
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD non configuré côté serveur' });
  }
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }
  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '24h' });
  res.json({ token });
});

// GET /api/admin/marchands — liste complète avec stats par marchand
router.get('/marchands', authAdmin, async (req, res) => {
  const [
    { data: marchands, error },
    { data: clientRows },
    { data: scanRows },
  ] = await Promise.all([
    supabase
      .from('marchands')
      .select('id, nom, slug, forfait, actif, email_contact, couleur_fond, logo_url, max_value, created_at')
      .order('created_at', { ascending: false }),
    supabase.from('clients').select('marchand_id').is('deleted_at', null),
    supabase.from('scans').select('marchand_id').gte('date_scan', new Date().toISOString().split('T')[0]),
  ]);

  if (error) return res.status(500).json({ error: error.message });

  const clientsParMarchand = {};
  const scansParMarchand   = {};
  (clientRows || []).forEach(c => { clientsParMarchand[c.marchand_id] = (clientsParMarchand[c.marchand_id] || 0) + 1; });
  (scanRows   || []).forEach(s => { scansParMarchand[s.marchand_id]   = (scansParMarchand[s.marchand_id]   || 0) + 1; });

  res.json(marchands.map(m => ({
    ...m,
    total_clients:    clientsParMarchand[m.id] || 0,
    scans_aujourdhui: scansParMarchand[m.id]   || 0,
  })));
});

// GET /api/admin/marchands/:id — détail complet d'un marchand
router.get('/marchands/:id', authAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('marchands')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error || !data) return res.status(404).json({ error: 'Marchand introuvable' });
  res.json(data);
});

// POST /api/admin/marchands — créer un marchand
router.post('/marchands', authAdmin, async (req, res) => {
  const {
    nom, slug, email_contact, password, forfait,
    couleur_fond, couleur_texte, couleur_label,
    logo_url, image_strip_url, google_logo_url, google_hero_url,
    texte_landing, max_value, images_tiers,
  } = req.body;

  if (!nom || !slug || !email_contact || !password) {
    return res.status(400).json({ error: 'nom, slug, email_contact et password sont requis' });
  }

  const { data: existing } = await supabase.from('marchands').select('id').eq('slug', slug).single();
  if (existing) return res.status(409).json({ error: 'Ce slug est déjà utilisé' });

  const { hashPassword } = require('../services/auth-utils');
  const password_hash = await hashPassword(password);

  const { data, error } = await supabase
    .from('marchands')
    .insert({
      nom, slug, email_contact, password_hash,
      forfait:       ['basic', 'pro', 'pro_plus'].includes(forfait) ? forfait : 'pro',
      couleur_fond:  couleur_fond  || '#ffffff',
      couleur_texte: couleur_texte || '#000000',
      couleur_label: couleur_label || '#888888',
      logo_url, image_strip_url, google_logo_url, google_hero_url,
      texte_landing, images_tiers,
      max_value: max_value || 10,
      actif: true,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  const { createOrUpdateLoyaltyClass } = require('../services/google-pass');
  createOrUpdateLoyaltyClass(data).catch(e => console.error('[Google Wallet] classe:', e.message));

  res.status(201).json(data);
});

// PATCH /api/admin/marchands/:id — modifier un marchand
router.patch('/marchands/:id', authAdmin, async (req, res) => {
  const ALLOWED = [
    'nom', 'email_contact',
    'couleur_fond', 'couleur_texte', 'couleur_label',
    'logo_url', 'image_strip_url', 'images_tiers',
    'google_logo_url', 'google_hero_url',
    'texte_landing', 'max_value', 'forfait',
  ];

  const updates = {};
  for (const field of ALLOWED) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  // Réinitialisation du mot de passe (optionnel)
  if (req.body.new_password) {
    const { hashPassword } = require('../services/auth-utils');
    updates.password_hash = await hashPassword(req.body.new_password);
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Aucun champ valide à modifier' });
  }

  const { data, error } = await supabase
    .from('marchands').update(updates).eq('id', req.params.id).select().single();

  if (error) return res.status(500).json({ error: error.message });

  const { createOrUpdateLoyaltyClass } = require('../services/google-pass');
  createOrUpdateLoyaltyClass(data).catch(e => console.error('[Google Wallet] classe:', e.message));

  res.json(data);
});

// PATCH /api/admin/marchands/:id/suspension — bloquer ou débloquer
router.patch('/marchands/:id/suspension', authAdmin, async (req, res) => {
  const { actif } = req.body;
  if (typeof actif !== 'boolean') return res.status(400).json({ error: 'actif (boolean) requis' });

  const { data, error } = await supabase
    .from('marchands').update({ actif }).eq('id', req.params.id).select('id, nom, actif').single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/admin/stats — statistiques globales
router.get('/stats', authAdmin, async (req, res) => {
  const [
    { count: marchandsActifs },
    { count: totalClients },
    { count: totalScans },
  ] = await Promise.all([
    supabase.from('marchands').select('*', { count: 'exact', head: true }).eq('actif', true),
    supabase.from('clients').select('*',   { count: 'exact', head: true }).is('deleted_at', null),
    supabase.from('scans').select('*',     { count: 'exact', head: true }),
  ]);

  res.json({ marchands_actifs: marchandsActifs, total_clients: totalClients, total_scans: totalScans });
});

module.exports = router;
