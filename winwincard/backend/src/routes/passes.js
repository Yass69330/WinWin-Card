const express = require('express');
const router = express.Router();
const supabase = require('../services/supabase');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/passes/:serialNumber/google — bouton « Google Wallet » de la landing
// (étape 23, règle D2). Note le premier clic (passes.google_ouvert_le), puis
// renvoie (302) vers le même lien Google qu'avant : pour le client, rien ne
// change. Ce signal fait servir le client côté Google même s'il a aussi une
// carte Apple (services/canal-google.js). Une écriture ratée ne bloque jamais
// le client : il est renvoyé vers Google quand même.
router.get('/:serialNumber/google', asyncHandler(async (req, res) => {
  const serial = String(req.params.serialNumber || '').toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(serial)) return res.status(404).json({ error: 'Carte introuvable' });

  const { data: pass, error } = await supabase
    .from('passes')
    .select('google_pass_url, google_ouvert_le')
    .eq('serial_number', serial)
    .maybeSingle();
  if (error) {
    console.error('[passes] google : lecture impossible :', error.message);
    return res.set('Retry-After', '30').status(503).json({ error: 'database_unavailable' });
  }
  if (!pass || !pass.google_pass_url) return res.status(404).json({ error: 'Carte introuvable' });

  if (!pass.google_ouvert_le) {
    const { error: errMaj } = await supabase
      .from('passes')
      .update({ google_ouvert_le: new Date().toISOString() })
      .eq('serial_number', serial)
      .is('google_ouvert_le', null);
    if (errMaj) console.error('[passes] google : clic non noté :', errMaj.message);
  }
  res.redirect(302, pass.google_pass_url);
}));

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
      .select('id, nom, slug, forfait, langue, type_programme, pass_display_name, how_it_works, couleur_fond, couleur_fond_reward, couleur_pastille_fond, couleur_pastille_contour, couleur_pastille_icone, couleur_label_strip, couleur_barre_principale, couleur_barre_secondaire,couleur_texte, couleur_label, logo_url, logo_reward_url, icon_url, image_strip_url, images_tiers, max_value, display_max_value, notification_titre, notification_message, referral_enabled, referral_bonus_points, telephone, adresse, strip_mode, strip_theme, strip_illustration, strip_produit, strip_vide, stamp_icon, strip_custom_background_url, strip_config_version, strip_label, lien_avis_google')
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
    res.setHeader('Content-Disposition', 'attachment; filename="pass.pkpass"');
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
