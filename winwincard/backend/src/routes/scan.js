const express = require('express');
const router = express.Router();
const supabase = require('../services/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { authScanner, authMarchand } = require('../middleware/auth');

// POST /scan — scan d'un pass en caisse
// Corps : { serial_number }
router.post('/', authScanner, asyncHandler(async (req, res) => {
  const { serial_number } = req.body;

  if (!serial_number) {
    return res.status(400).json({ error: 'serial_number required' });
  }

  // Récupérer le client avec son marchand
  const { data: client, error: errClient } = await supabase
    .from('clients')
    .select('id, prenom, stored_value, marchand_id, marchands(max_value, display_max_value, actif, nom, images_tiers)')
    .eq('pass_serial_number', serial_number)
    .eq('marchand_id', req.marchandId)
    .is('deleted_at', null)
    .single();

  if (errClient || !client) {
    return res.status(404).json({ error: 'Pass not found or unauthorized' });
  }
  if (!client.marchands.actif) {
    return res.status(403).json({ error: 'Merchant account suspended' });
  }

  const maxValue = client.marchands.max_value;
  const displayMaxValue = client.marchands.display_max_value || maxValue;

  // Incrément atomique côté Postgres (SELECT … FOR UPDATE) — évite la perte de
  // points si deux scans simultanés lisent puis écrivent la même valeur.
  const { data: incr, error: errIncr } = await supabase.rpc('increment_stored_value', {
    p_client_id: client.id,
    p_max_value: maxValue,
  });

  if (errIncr) return res.status(500).json({ error: errIncr.message });

  const row = Array.isArray(incr) ? incr[0] : incr;
  if (!row) return res.status(500).json({ error: 'Increment failed' });

  const avantScan  = row.stored_value_avant;
  const apresScan  = row.stored_value_apres;
  const isReset    = row.is_reset;
  const recompense = !isReset && apresScan >= maxValue;

  const scanMessage = isReset
    ? `Card updated — ${client.prenom}: 0/${displayMaxValue} pts`
    : recompense
      ? `Congrats ${client.prenom}! Reward unlocked 🎉`
      : `+1 — ${client.prenom}: ${apresScan}/${displayMaxValue} pts`;

  // Message de notification du pass + log du scan en parallèle
  await Promise.all([
    supabase.from('passes')
      .update({ notification_message: scanMessage })
      .eq('serial_number', serial_number)
      .eq('marchand_id', req.marchandId),
    supabase.from('scans').insert({
      client_id: client.id,
      marchand_id: req.marchandId,
      stored_value_avant: avantScan,
      stored_value_apres: apresScan,
    }),
  ]);

  // Mises à jour Apple + Google Wallet en parallèle, sans bloquer la réponse
  notifierMiseAJourPass(serial_number).catch(e => console.error('[scan] push Apple:', e.message));
  mettreAJourGoogleWallet(serial_number, req.marchandId, apresScan, maxValue, displayMaxValue, scanMessage, client.marchands.images_tiers, client.prenom).catch(e => console.error('[scan] push Google:', e.message));

  res.json({
    prenom: client.prenom,
    stored_value_avant: avantScan,
    stored_value_apres: apresScan,
    max_value: maxValue,
    display_max_value: displayMaxValue,
    recompense,
    message: scanMessage,
  });
}));

async function notifierMiseAJourPass(serialNumber) {
  const { data: tokens } = await supabase
    .from('device_tokens')
    .select('push_token')
    .eq('serial_number', serialNumber);

  if (!tokens || tokens.length === 0) return;

  const { sendPushUpdate } = require('../services/apns');
  for (const { push_token } of tokens) {
    await sendPushUpdate(push_token).catch(() => {});
  }
}

async function mettreAJourGoogleWallet(serialNumber, marchandId, storedValue, maxValue, displayMaxValue, scanMessage, imagesTiers, prenom) {
  const { updateLoyaltyObjectPoints, addMessageToLoyaltyObject } = require('../services/google-pass');
  await updateLoyaltyObjectPoints(serialNumber, marchandId, storedValue, maxValue, displayMaxValue, imagesTiers, prenom);
  addMessageToLoyaltyObject(serialNumber, null, scanMessage)
    .catch(e => console.error('[scan] Google addMessage:', e.message));
}

// GET /api/scans — historique des scans du marchand (100 derniers)
router.get('/', authMarchand, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 200);
  const { data, error } = await supabase
    .from('scans')
    .select('id, date_scan, stored_value_avant, stored_value_apres, clients(id, prenom)')
    .eq('marchand_id', req.marchandId)
    .order('date_scan', { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
}));

module.exports = router;
