const express = require('express');
const router = express.Router();
const supabase = require('../services/supabase');

// GET /api/passes/:serialNumber/apple
// Route publique — premier téléchargement du pass (bouton "Ajouter à Apple Wallet")
router.get('/:serialNumber/apple', async (req, res) => {
  const { serialNumber } = req.params;

  const { data: pass } = await supabase
    .from('passes')
    .select('client_id, marchand_id')
    .eq('serial_number', serialNumber)
    .single();

  if (!pass) return res.status(404).json({ error: 'Pass introuvable' });

  const [{ data: client }, { data: marchand }] = await Promise.all([
    supabase.from('clients')
      .select('prenom, stored_value')
      .eq('id', pass.client_id)
      .is('deleted_at', null)
      .single(),
    supabase.from('marchands')
      .select('nom, couleur_fond, couleur_texte, couleur_label, logo_url, image_strip_url, images_tiers, max_value, display_max_value')
      .eq('id', pass.marchand_id)
      .eq('actif', true)
      .single()
  ]);

  if (!client || !marchand) return res.status(404).json({ error: 'Données introuvables' });

  const { generateApplePass } = require('../services/apple-pass');

  try {
    const buffer = await generateApplePass({ client, marchand, serialNumber });

    // Helm 7 ajoute Cross-Origin-Resource-Policy: same-origin et
    // Cross-Origin-Embedder-Policy: require-corp par défaut.
    // PassKit (framework natif iOS) n'est pas une "origine web" — ces headers
    // empêchent iOS de passer le fichier au Wallet. On les retire pour ce seul endpoint.
    res.removeHeader('Cross-Origin-Resource-Policy');
    res.removeHeader('Cross-Origin-Embedder-Policy');

    // res.end() au lieu de res.send() pour éviter toute transformation Express
    // sur le Content-Type ou l'encodage du Buffer binaire.
    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 200;
    res.end(buffer);
  } catch (err) {
    console.error('[passes] Erreur génération Apple pass :', err.message);
    res.status(500).json({ error: 'Erreur génération du pass' });
  }
});

module.exports = router;
