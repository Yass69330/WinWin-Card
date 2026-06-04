const express = require('express');
const router = express.Router();
const supabase = require('../services/supabase');
const asyncHandler = require('../utils/asyncHandler');

// GET /google-wallet/pass/:serialNumber — génère le lien "Add to Google Wallet"
router.get('/pass/:serialNumber', asyncHandler(async (req, res) => {
  const { serialNumber } = req.params;

  const { data: pass } = await supabase
    .from('passes')
    .select('client_id, marchand_id')
    .eq('serial_number', serialNumber)
    .single();

  if (!pass) return res.status(404).json({ error: 'Pass introuvable' });

  const [{ data: client }, { data: marchand }] = await Promise.all([
    supabase.from('clients').select('prenom, stored_value').eq('id', pass.client_id).single(),
    supabase.from('marchands').select('id, nom, slug, logo_url, couleur_fond, max_value, display_max_value').eq('id', pass.marchand_id).single()
  ]);

  if (!client || !marchand) return res.status(404).json({ error: 'Données introuvables' });

  const { generateGoogleWalletUrl } = require('../services/google-pass');

  try {
    const url = await generateGoogleWalletUrl({ client, marchand, serialNumber });

    // Mettre à jour l'URL en base si pas encore définie
    await supabase
      .from('passes')
      .update({ google_pass_url: url })
      .eq('serial_number', serialNumber);

    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: 'Erreur génération Google Wallet', detail: err.message });
  }
}));

module.exports = router;
