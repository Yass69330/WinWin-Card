const express = require('express');
const router = express.Router();
const supabase = require('../services/supabase');
const { authScanner, authMarchand } = require('../middleware/auth');

// POST /scan — scan d'un pass en caisse
// Corps : { serial_number }
router.post('/', authScanner, async (req, res) => {
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
  const avantScan = client.stored_value;
  let apresScan;
  let recompense = false;
  let isReset = false;

  if (avantScan >= maxValue) {
    apresScan = 0;
    isReset = true;
  } else {
    apresScan = avantScan + 1;
    recompense = apresScan >= maxValue;
  }

  const scanMessage = isReset
    ? `Card updated — ${client.prenom}: 0/${displayMaxValue} pts`
    : recompense
      ? `Congrats ${client.prenom}! Reward unlocked 🎉`
      : `+1 — ${client.prenom}: ${apresScan}/${displayMaxValue} pts`;

  // Mise à jour client + message de notification du pass en parallèle
  const [{ error: errUpdate }] = await Promise.all([
    supabase.from('clients').update({ stored_value: apresScan }).eq('id', client.id),
    supabase.from('passes')
      .update({ notification_message: scanMessage })
      .eq('serial_number', serial_number)
      .eq('marchand_id', req.marchandId),
  ]);

  if (errUpdate) return res.status(500).json({ error: errUpdate.message });

  // Log du scan
  await supabase.from('scans').insert({
    client_id: client.id,
    marchand_id: req.marchandId,
    stored_value_avant: avantScan,
    stored_value_apres: apresScan
  });

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
});

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
router.get('/', authMarchand, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 200);
  try {
    const { data, error } = await supabase
      .from('scans')
      .select('id, date_scan, stored_value_avant, stored_value_apres, clients(id, prenom)')
      .eq('marchand_id', req.marchandId)
      .order('date_scan', { ascending: false })
      .limit(limit);

    if (error) return res.status(500).json({ error: error.message });
    res.json(data ?? []);
  } catch (e) {
    console.error('[scan] GET error:', e.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
