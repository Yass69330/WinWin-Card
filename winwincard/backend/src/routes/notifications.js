const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { authMarchand } = require('../middleware/auth');
const { sendPushUpdate, isApnsConfigured }                    = require('../services/apns');
const { addMessageToLoyaltyObject, isConfigured: isGoogleConfigured } = require('../services/google-pass');

// POST /api/notifications — envoi push depuis le dashboard marchand
// Corps : { titre, message }
// Réponse : { apple: { envoyes, echecs, total, active }, google: { ... } }
router.post('/', authMarchand, async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message est requis' });
  }
  if (message.length > 500) {
    return res.status(400).json({ error: 'message max 500 chars' });
  }

  // Récupérer tokens Apple et passes Google en parallèle
  const [{ data: tokens, error: errT }, { data: passes }] = await Promise.all([
    supabase
      .from('device_tokens')
      .select('push_token')
      .eq('marchand_id', req.marchandId),
    supabase
      .from('passes')
      .select('serial_number')
      .eq('marchand_id', req.marchandId)
      .not('google_pass_url', 'is', null),
  ]);

  if (errT) return res.status(500).json({ error: errT.message });

  // Apple Wallet : stocker la notification dans le marchand, toucher les passes,
  // puis push silencieux. iOS re-télécharge le pass, détecte le champ modifié
  // et génère automatiquement une notification visible dans le centre de notifications.
  if (isApnsConfigured() && (tokens || []).length > 0) {
    await Promise.all([
      supabase.from('marchands')
        .update({ notification_titre: null, notification_message: message })
        .eq('id', req.marchandId),
      supabase.from('passes')
        .update({ updated_at: new Date().toISOString() })
        .eq('marchand_id', req.marchandId),
    ]);
  }

  const [appleResults, googleResults] = await Promise.all([
    isApnsConfigured()
      ? Promise.allSettled(
          (tokens || []).map(({ push_token }) => sendPushUpdate(push_token))
        )
      : Promise.resolve([]),

    isGoogleConfigured()
      ? Promise.allSettled(
          (passes || []).map(({ serial_number }) =>
            addMessageToLoyaltyObject(serial_number, titre, message)
          )
        )
      : Promise.resolve([]),
  ]);

  // Log des échecs pour diagnostic Railway
  appleResults.filter(r => r.status === 'rejected')
    .forEach(r => console.error('[notifications] APNs échec:', r.reason?.message));
  googleResults.filter(r => r.status === 'rejected')
    .forEach(r => console.error('[notifications] Google échec:', r.reason?.message));

  res.json({
    apple: {
      envoyes: appleResults.filter(r => r.status === 'fulfilled').length,
      echecs:  appleResults.filter(r => r.status === 'rejected').length,
      total:   (tokens || []).length,
      active:  isApnsConfigured(),
    },
    google: {
      envoyes: googleResults.filter(r => r.status === 'fulfilled').length,
      echecs:  googleResults.filter(r => r.status === 'rejected').length,
      total:   (passes || []).length,
      active:  isGoogleConfigured(),
    },
  });
});

module.exports = router;
