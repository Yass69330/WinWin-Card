const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const supabase = require('../services/supabase');
const { authMarchand } = require('../middleware/auth');

// POST /merchants/login — connexion marchand (email ou slug + password)
// remember_device: true → JWT 1 an (scanner PWA installée), false → 7j (dashboard)
router.post('/login', async (req, res) => {
  const { email, slug, password, remember_device } = req.body;
  const identifier = slug || email;
  if (!identifier || !password) {
    return res.status(400).json({ error: 'slug (or email) and password required' });
  }

  const field = slug ? 'slug' : 'email_contact';
  const { data: marchand } = await supabase
    .from('marchands')
    .select('id, nom, slug, email_contact, password_hash, actif')
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

  res.json({ token, marchand_id: marchand.id, nom: marchand.nom, slug: marchand.slug });
});

// GET /merchants/me — profil du marchand connecté
router.get('/me', authMarchand, async (req, res) => {
  const { data, error } = await supabase
    .from('marchands')
    .select('id, nom, slug, logo_url, couleur_fond, couleur_texte, couleur_label, image_strip_url, texte_landing, max_value, display_max_value, forfait, email_contact')
    .eq('id', req.marchandId)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /merchants/me/stats — stats du dashboard
router.get('/me/stats', authMarchand, async (req, res) => {
  const [{ count: totalClients }, { count: scansAujourdhui }] = await Promise.all([
    supabase
      .from('clients')
      .select('*', { count: 'exact', head: true })
      .eq('marchand_id', req.marchandId)
      .is('deleted_at', null),
    supabase
      .from('scans')
      .select('*', { count: 'exact', head: true })
      .eq('marchand_id', req.marchandId)
      .gte('date_scan', new Date().toISOString().split('T')[0])
  ]);

  res.json({ total_clients: totalClients, scans_aujourdhui: scansAujourdhui });
});

// GET /merchants/qrcode — QR code de la landing page du marchand
router.get('/me/qrcode', authMarchand, async (req, res) => {
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
});

// GET /merchants/:slug/public — infos publiques pour la landing page
router.get('/:slug/public', async (req, res) => {
  const { data, error } = await supabase
    .from('marchands')
    .select('id, nom, slug, logo_url, icon_url, image_strip_url, texte_landing, couleur_fond, couleur_texte, max_value, actif, forfait')
    .eq('slug', req.params.slug)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Merchant not found' });
  if (!data.actif) return res.status(403).json({ error: 'Program suspended' });

  res.json(data);
});

module.exports = router;
