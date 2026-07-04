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
    .select('id, prenom, stored_value, marchand_id, marchands(id, max_value, display_max_value, actif, nom, slug, forfait, langue, images_tiers, couleur_fond, couleur_fond_reward, logo_url, strip_mode, strip_theme, stamp_icon, strip_custom_background_url, strip_config_version, referral_enabled, referral_bonus_points)')
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
      .update({ notification_message: scanMessage, updated_at: new Date().toISOString() })
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
  mettreAJourGoogleWallet(serial_number, req.marchandId, apresScan, maxValue, displayMaxValue, scanMessage, client.marchands.images_tiers, client.prenom, client.marchands.couleur_fond, client.marchands.couleur_fond_reward, client.marchands).catch(e => console.error('[scan] push Google:', e.message));

  // Parrainage — premier tampon du filleul = +1 au parrain, fire-and-forget
  if (apresScan === 1 && client.marchands.referral_enabled) {
    creditReferrerIfApplicable(client.id, req.marchandId, client.marchands.referral_bonus_points || 1)
      .catch(e => console.error('[scan] referral credit:', e.message));
  }

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
    await sendPushUpdate(push_token).catch(e => console.error(`[scan] sendPushUpdate échoué (…${push_token.slice(-8)}):`, e.message));
  }
}

async function mettreAJourGoogleWallet(serialNumber, marchandId, storedValue, maxValue, displayMaxValue, scanMessage, imagesTiers, prenom, couleurFond, couleurFondReward, marchand) {
  const { updateLoyaltyObjectPoints, addMessageToLoyaltyObject } = require('../services/google-pass');
  await updateLoyaltyObjectPoints(serialNumber, marchandId, storedValue, maxValue, displayMaxValue, imagesTiers, prenom, couleurFond, couleurFondReward, marchand);
  addMessageToLoyaltyObject(serialNumber, null, scanMessage)
    .catch(e => console.error('[scan] Google addMessage:', e.message));
}

async function creditReferrerIfApplicable(filleulClientId, marchandId, bonusPoints) {
  // Récupérer le lien de parrainage du filleul
  const { data: filleul } = await supabase
    .from('clients')
    .select('referred_by_client_id')
    .eq('id', filleulClientId)
    .single();

  if (!filleul?.referred_by_client_id) return;
  const parrainClientId = filleul.referred_by_client_id;

  // Récupérer pass + infos du parrain (même marchand)
  const { data: parrain } = await supabase
    .from('clients')
    .select('prenom, pass_serial_number, marchands(id, max_value, display_max_value, images_tiers, couleur_fond, couleur_fond_reward, slug, forfait, langue, logo_url, strip_mode, strip_theme, stamp_icon, strip_custom_background_url, strip_config_version)')
    .eq('id', parrainClientId)
    .eq('marchand_id', marchandId)
    .single();

  if (!parrain?.pass_serial_number) return;

  // Crédit atomique — cap à max_value, jamais de reset
  const { data: credit, error } = await supabase.rpc('credit_referral', {
    p_parrain_client_id: parrainClientId,
    p_bonus_points:      bonusPoints,
  });

  if (error) throw new Error(`credit_referral: ${error.message}`);

  const row        = Array.isArray(credit) ? credit[0] : credit;
  const newValue   = row.stored_value_apres;
  const maxValue   = parrain.marchands.max_value;
  const displayMax = parrain.marchands.display_max_value || maxValue;
  const msg        = `+${bonusPoints} referral bonus — ${parrain.prenom}: ${newValue}/${displayMax} pts`;

  // Audit referral_credits
  supabase.from('referral_credits').insert({
    marchand_id:       marchandId,
    parrain_client_id: parrainClientId,
    filleul_client_id: filleulClientId,
    points_credited:   bonusPoints,
  }).then().catch(e => console.error('[scan] referral_credits insert:', e.message));

  // Mise à jour du pass parrain (notification + updated_at pour Apple)
  await supabase.from('passes')
    .update({ notification_message: msg, updated_at: new Date().toISOString() })
    .eq('serial_number', parrain.pass_serial_number)
    .eq('marchand_id', marchandId);

  // Push Apple + Google au parrain
  notifierMiseAJourPass(parrain.pass_serial_number)
    .catch(e => console.error('[scan] referral push Apple:', e.message));
  mettreAJourGoogleWallet(
    parrain.pass_serial_number, marchandId, newValue, maxValue, displayMax,
    msg, parrain.marchands.images_tiers, parrain.prenom,
    parrain.marchands.couleur_fond, parrain.marchands.couleur_fond_reward, parrain.marchands
  ).catch(e => console.error('[scan] referral push Google:', e.message));

  console.log(`[scan] referral credit OK parrain=${parrainClientId} +${bonusPoints}pts → ${newValue}/${maxValue}`);
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
