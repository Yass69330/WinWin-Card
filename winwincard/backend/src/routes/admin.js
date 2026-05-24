const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../services/supabase');
const { authAdmin } = require('../middleware/auth');

// POST /admin/login
router.post('/login', async (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }

  const token = jwt.sign(
    { role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({ token });
});

// GET /admin/marchands — liste tous les marchands
router.get('/marchands', authAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('marchands')
    .select('id, nom, slug, forfait, actif, email_contact, created_at')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /admin/marchands — créer un marchand
router.post('/marchands', authAdmin, async (req, res) => {
  const {
    nom, slug, email_contact, password,
    couleur_fond, couleur_texte, couleur_label,
    texte_landing, max_value,
    logo_url, image_strip_url
  } = req.body;

  if (!nom || !slug || !email_contact || !password) {
    return res.status(400).json({ error: 'nom, slug, email_contact et password sont requis' });
  }

  // Vérifier unicité du slug
  const { data: existing } = await supabase
    .from('marchands')
    .select('id')
    .eq('slug', slug)
    .single();

  if (existing) return res.status(409).json({ error: 'Ce slug est déjà utilisé' });

  const { hashPassword } = require('../services/auth-utils');
  const password_hash = await hashPassword(password);

  const { data, error } = await supabase
    .from('marchands')
    .insert({
      nom,
      slug,
      email_contact,
      password_hash,
      couleur_fond: couleur_fond || '#ffffff',
      couleur_texte: couleur_texte || '#000000',
      couleur_label: couleur_label || '#888888',
      texte_landing,
      max_value: max_value || 10,
      forfait: 'pro',
      logo_url,
      image_strip_url,
      actif: true
    })
    .select('id, nom, slug, email_contact')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Créer la LoyaltyClass Google Wallet pour ce marchand (async, non bloquant)
  const { createOrUpdateLoyaltyClass } = require('../services/google-pass');
  createOrUpdateLoyaltyClass(data).catch(err =>
    console.error('[Google Wallet] Erreur création classe :', err.message)
  );

  res.status(201).json(data);
});

// PATCH /admin/marchands/:id — modifier un marchand
router.patch('/marchands/:id', authAdmin, async (req, res) => {
  const allowedFields = [
    'nom', 'couleur_fond', 'couleur_texte', 'couleur_label',
    'logo_url', 'image_strip_url', 'images_tiers',
    'texte_landing', 'max_value'
  ];

  const updates = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Aucun champ valide à modifier' });
  }

  const { data, error } = await supabase
    .from('marchands')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Synchroniser la LoyaltyClass Google Wallet si les visuels ont changé
  const { createOrUpdateLoyaltyClass } = require('../services/google-pass');
  createOrUpdateLoyaltyClass(data).catch(err =>
    console.error('[Google Wallet] Erreur mise à jour classe :', err.message)
  );

  res.json(data);
});

// PATCH /admin/marchands/:id/suspension — bloquer ou débloquer
router.patch('/marchands/:id/suspension', authAdmin, async (req, res) => {
  const { actif } = req.body;
  if (typeof actif !== 'boolean') {
    return res.status(400).json({ error: 'actif (boolean) requis' });
  }

  const { data, error } = await supabase
    .from('marchands')
    .update({ actif })
    .eq('id', req.params.id)
    .select('id, nom, actif')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /admin/stats — vue globale
router.get('/stats', authAdmin, async (req, res) => {
  const [
    { count: totalMarchands },
    { count: totalClients },
    { count: totalScans }
  ] = await Promise.all([
    supabase.from('marchands').select('*', { count: 'exact', head: true }).eq('actif', true),
    supabase.from('clients').select('*', { count: 'exact', head: true }).is('deleted_at', null),
    supabase.from('scans').select('*', { count: 'exact', head: true })
  ]);

  res.json({
    marchands_actifs: totalMarchands,
    total_clients: totalClients,
    total_scans: totalScans
  });
});

module.exports = router;
