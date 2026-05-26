const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const supabase = require('../services/supabase');
const { authMarchand, authAdmin } = require('../middleware/auth');

// POST /api/clients — inscription client depuis la landing page
// Corps : { prenom, marchand_slug }
router.post('/', async (req, res) => {
  const { prenom, marchand_slug } = req.body;

  if (!prenom || !marchand_slug) {
    return res.status(400).json({ error: 'prenom et marchand_slug sont requis' });
  }
  const prenomPropre = prenom.trim().slice(0, 50);
  if (!prenomPropre) return res.status(400).json({ error: 'Prénom invalide' });

  // Récupérer le marchand complet (nécessaire pour Google Wallet)
  const { data: marchand, error: errMarchand } = await supabase
    .from('marchands')
    .select('id, nom, slug, max_value, display_max_value, actif, couleur_fond, couleur_texte, couleur_label, logo_url, image_strip_url, google_logo_url, google_hero_url, images_tiers')
    .eq('slug', marchand_slug)
    .single();

  if (errMarchand || !marchand) return res.status(404).json({ error: 'Marchand introuvable' });
  if (!marchand.actif) return res.status(403).json({ error: 'Ce programme de fidélité est suspendu' });

  const serialNumber = uuidv4();
  const clientData = { prenom: prenomPropre, stored_value: 0 };

  // Créer le client
  const { data: client, error: errClient } = await supabase
    .from('clients')
    .insert({ marchand_id: marchand.id, prenom: prenomPropre, pass_serial_number: serialNumber, stored_value: 0 })
    .select()
    .single();

  if (errClient) return res.status(500).json({ error: 'Erreur création client', detail: errClient.message });

  // Créer l'entrée passes
  await supabase.from('passes').insert({ client_id: client.id, marchand_id: marchand.id, serial_number: serialNumber });

  const apiBase = process.env.API_BASE_URL || 'https://api.winwincard.fr';
  const applePassUrl = `${apiBase}/api/passes/${serialNumber}/apple`;

  // Générer l'URL Google Wallet directement (retourner null si non configuré ou erreur)
  let googleWalletUrl = null;
  try {
    const { generateGoogleWalletUrl } = require('../services/google-pass');
    googleWalletUrl = await generateGoogleWalletUrl({ client: clientData, marchand, serialNumber });
    // Persister l'URL Google en base
    await supabase.from('passes').update({ google_pass_url: googleWalletUrl }).eq('serial_number', serialNumber);
  } catch {
    // Google Wallet non configuré ou erreur — on continue sans bloquer l'inscription
  }

  res.status(201).json({
    client_id:        client.id,
    serial_number:    serialNumber,
    prenom:           client.prenom,
    stored_value:     0,
    apple_pass_url:   applePassUrl,
    google_wallet_url: googleWalletUrl,
  });
});

// GET /api/clients — liste des clients du marchand connecté
router.get('/', authMarchand, async (req, res) => {
  const { data, error } = await supabase
    .from('clients')
    .select('id, prenom, stored_value, created_at, pass_serial_number')
    .eq('marchand_id', req.marchandId)
    .is('deleted_at', null)
    .order('stored_value', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/clients/:id — droit à l'effacement RGPD
router.delete('/:id', authMarchand, async (req, res) => {
  const { error } = await supabase.rpc('effacer_client', {
    p_client_id: req.params.id,
    p_marchand_id: req.marchandId
  });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// GET /api/clients/admin/all — vision globale admin
router.get('/admin/all', authAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('clients')
    .select('id, prenom, stored_value, created_at, marchand_id, marchands(nom)')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
