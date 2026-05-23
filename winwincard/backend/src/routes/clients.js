const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const supabase = require('../services/supabase');
const { authMarchand, authAdmin } = require('../middleware/auth');

// POST /clients — inscription client depuis la landing page
// Corps : { prenom, marchand_slug }
router.post('/', async (req, res) => {
  const { prenom, marchand_slug } = req.body;

  if (!prenom || !marchand_slug) {
    return res.status(400).json({ error: 'prenom et marchand_slug sont requis' });
  }

  const prenomPropre = prenom.trim().slice(0, 50);
  if (!prenomPropre) {
    return res.status(400).json({ error: 'Prénom invalide' });
  }

  // Récupérer le marchand actif
  const { data: marchand, error: errMarchand } = await supabase
    .from('marchands')
    .select('id, nom, max_value, actif')
    .eq('slug', marchand_slug)
    .single();

  if (errMarchand || !marchand) {
    return res.status(404).json({ error: 'Marchand introuvable' });
  }
  if (!marchand.actif) {
    return res.status(403).json({ error: 'Ce programme de fidélité est suspendu' });
  }

  const serialNumber = uuidv4();

  // Créer le client
  const { data: client, error: errClient } = await supabase
    .from('clients')
    .insert({
      marchand_id: marchand.id,
      prenom: prenomPropre,
      pass_serial_number: serialNumber,
      stored_value: 0
    })
    .select()
    .single();

  if (errClient) {
    return res.status(500).json({ error: 'Erreur création client', detail: errClient.message });
  }

  // Créer l'entrée passes (les URLs seront remplies par apple-wallet.js et google-wallet.js)
  await supabase.from('passes').insert({
    client_id: client.id,
    marchand_id: marchand.id,
    serial_number: serialNumber
  });

  res.status(201).json({
    client_id: client.id,
    serial_number: serialNumber,
    prenom: client.prenom,
    stored_value: 0,
    marchand_id: marchand.id
  });
});

// GET /clients — liste des clients du marchand connecté
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

// DELETE /clients/:id — droit à l'effacement RGPD
router.delete('/:id', authMarchand, async (req, res) => {
  const { error } = await supabase.rpc('effacer_client', {
    p_client_id: req.params.id,
    p_marchand_id: req.marchandId
  });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// GET /clients/admin — vision globale (admin uniquement)
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
