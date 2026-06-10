const express = require('express');
const router = express.Router();
const supabase = require('../services/supabase');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/passes/:serialNumber/apple
// Route publique — premier téléchargement du pass (bouton "Ajouter à Apple Wallet")
router.get('/:serialNumber/apple', asyncHandler(async (req, res) => {
  const { serialNumber } = req.params;

  const { data: pass, error: errPass } = await supabase
    .from('passes')
    .select('client_id, marchand_id, notification_message')
    .eq('serial_number', serialNumber)
    .single();

  if (errPass) {
    console.error('[passes] Erreur SELECT pass:', errPass.message);
    return res.status(404).json({ error: 'Pass introuvable' });
  }
  if (!pass) return res.status(404).json({ error: 'Pass introuvable' });

  const [{ data: client }, { data: marchand }] = await Promise.all([
    supabase.from('clients')
      .select('prenom, stored_value')
      .eq('id', pass.client_id)
      .is('deleted_at', null)
      .single(),
    supabase.from('marchands')
      .select('nom, slug, pass_display_name, how_it_works, couleur_fond, couleur_fond_reward, couleur_texte, couleur_label, logo_url, icon_url, image_strip_url, images_tiers, max_value, display_max_value, notification_titre, notification_message, referral_enabled, referral_bonus_points, telephone, adresse')
      .eq('id', pass.marchand_id)
      .eq('actif', true)
      .single()
  ]);

  if (!client || !marchand) return res.status(404).json({ error: 'Données introuvables' });

  const { generateApplePass } = require('../services/apple-pass');

  try {
    const buffer = await generateApplePass({ client, marchand, serialNumber, passNotification: pass.notification_message });

    // Validation : un .pkpass est un ZIP — doit commencer par PK\x03\x04 (50 4B 03 04)
    const magic = buffer.slice(0, 4).toString('hex');
    const isValidZip = magic === '504b0304';
    console.log(`[passes] serial=${serialNumber} size=${buffer.length} magic=${magic} zip=${isValidZip} marchand=${marchand.nom}`);

    if (!isValidZip) {
      console.error('[passes] BUFFER INVALIDE — pas un ZIP. Premiers 32 bytes:', buffer.slice(0, 32).toString('hex'));
      return res.status(500).json({ error: 'Pass généré invalide' });
    }

    res.removeHeader('Cross-Origin-Resource-Policy');
    res.removeHeader('Cross-Origin-Embedder-Policy');
    res.removeHeader('Cross-Origin-Opener-Policy');
    res.removeHeader('X-Download-Options');

    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 200;
    res.end(buffer);
  } catch (err) {
    console.error('[passes] Erreur génération Apple pass :', err.message, err.stack);
    res.status(500).json({ error: 'Erreur génération du pass' });
  }
}));

module.exports = router;
