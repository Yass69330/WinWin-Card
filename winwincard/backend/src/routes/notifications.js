const express  = require('express');
const router   = express.Router();
const supabase = require('../services/supabase');
const { authMarchand } = require('../middleware/auth');
const { sendPushUpdate, isApnsConfigured }                    = require('../services/apns');
const { addMessageToLoyaltyObject, isConfigured: isGoogleConfigured } = require('../services/google-pass');

const NOTIF_LIMITS = { basic: 0, pro: 10, pro_plus: 50 };

function startOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

// GET /api/notifications — historique + quota du mois
router.get('/', authMarchand, async (req, res) => {
  const [logsResult, meResult, countResult] = await Promise.all([
    supabase
      .from('notification_logs')
      .select('id, message, envoyes_apple, envoyes_google, total_apple, total_google, created_at')
      .eq('marchand_id', req.marchandId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('marchands').select('forfait').eq('id', req.marchandId).single(),
    supabase.from('notification_logs')
      .select('*', { count: 'exact', head: true })
      .eq('marchand_id', req.marchandId)
      .gte('created_at', startOfMonth()),
  ]);

  if (logsResult.error) return res.status(500).json({ error: logsResult.error.message });

  const forfait = meResult.data?.forfait || 'pro';
  const limit   = NOTIF_LIMITS[forfait] ?? 10;
  res.json({
    logs:  logsResult.data || [],
    quota: { used: countResult.count || 0, limit, forfait },
  });
});

// POST /api/notifications — envoi push depuis le dashboard marchand
// Corps : { titre, message }
// Réponse : { apple: { envoyes, echecs, total, active }, google: { ... } }
router.post('/', authMarchand, async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }
  if (message.length > 500) {
    return res.status(400).json({ error: 'message max 500 chars' });
  }

  // Vérification quota selon forfait
  const { data: me } = await supabase.from('marchands').select('forfait').eq('id', req.marchandId).single();
  const forfait = me?.forfait || 'pro';
  const limit   = NOTIF_LIMITS[forfait] ?? 10;

  if (limit === 0) {
    return res.status(403).json({ error: 'Push notifications are not available on the Basic plan.', upgrade: true });
  }

  const { count: usedThisMonth } = await supabase
    .from('notification_logs')
    .select('*', { count: 'exact', head: true })
    .eq('marchand_id', req.marchandId)
    .gte('created_at', startOfMonth());

  if (usedThisMonth >= limit) {
    return res.status(429).json({
      error: `Monthly limit reached — ${usedThisMonth}/${limit} notifications used this month.`,
      used: usedThisMonth, limit, upgrade: true,
    });
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
      // Met à jour notification_message sur chaque pass pour que changeMessage détecte le changement
      supabase.from('passes')
        .update({ notification_message: message })
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
            addMessageToLoyaltyObject(serial_number, null, message)
          )
        )
      : Promise.resolve([]),
  ]);

  // Log des échecs pour diagnostic Railway
  appleResults.filter(r => r.status === 'rejected')
    .forEach(r => console.error('[notifications] APNs échec:', r.reason?.message));
  googleResults.filter(r => r.status === 'rejected')
    .forEach(r => console.error('[notifications] Google échec:', r.reason?.message));

  // Log fire-and-forget
  supabase.from('notification_logs').insert({
    marchand_id:    req.marchandId,
    message,
    envoyes_apple:  appleResults.filter(r => r.status === 'fulfilled').length,
    envoyes_google: googleResults.filter(r => r.status === 'fulfilled').length,
    total_apple:    (tokens || []).length,
    total_google:   (passes || []).length,
  }).then().catch(e => console.error('[notifications] log:', e.message));

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
