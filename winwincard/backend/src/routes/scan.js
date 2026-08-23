const express = require('express');
const router = express.Router();
const supabase = require('../services/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { authScanner, authMarchand } = require('../middleware/auth');
const { notif } = require('../i18n/messages');

// POST /scan — scan d'un pass en caisse
// Corps : { serial_number }
//   ⚠️ Le champ `serial_number` du body n'est PAS forcément un serial : c'est
//   une ENTRÉE à résoudre — soit un UUID complet (caméra), soit un code de
//   secours 6 caractères (saisie manuelle). D'où le nom local `serial_input`.
//   Ne JAMAIS s'en servir pour agir sur une entité (passes, device_tokens,
//   objet Google) : utiliser `client.pass_serial_number` (le serial résolu).
router.post('/', authScanner, asyncHandler(async (req, res) => {
  const { serial_number: serial_input, points } = req.body;

  if (!serial_input) {
    return res.status(400).json({ error: 'serial_number required' });
  }

  // ── Multi-boutiques (3c) : attribution + coupure + durcissement ────────────
  // On statue AVANT toute écriture. Le statut de la boutique est TOUJOURS relu
  // en base (jamais présumé depuis le JWT) → c'est ce qui rend la coupure
  // effective au scan suivant.
  let pointDeVenteId = null;
  if (req.scannerRole === 'scanner') {
    const { data: pdv } = await supabase
      .from('points_de_vente')
      .select('id, actif, deleted_at')
      .eq('id', req.pointDeVenteId)
      .eq('marchand_id', req.marchandId)
      .maybeSingle();
    // Coupée (actif=false), archivée (deleted_at), ou introuvable → refus.
    if (!pdv || pdv.deleted_at || !pdv.actif) {
      return res.status(403).json({ error: 'access_disabled' });
    }
    pointDeVenteId = pdv.id;
  } else {
    // Token marchand : refusé si le réseau a AU MOINS une boutique provisionnée
    // (index partiel idx_points_de_vente_reseau_actif). Sinon mono-site → autorisé,
    // point_de_vente_id reste NULL, comportement identique à aujourd'hui.
    const { data: reseau } = await supabase
      .from('points_de_vente')
      .select('id')
      .eq('marchand_id', req.marchandId)
      .is('deleted_at', null)
      .not('scanner_login', 'is', null)
      .limit(1);
    if (reseau && reseau.length > 0) {
      return res.status(403).json({ error: 'use_boutique_login' });
    }
  }

  // Résolution du client — deux formats acceptés, toujours scopés au marchand :
  //   • UUID complet (36 car.) → scan caméra ou collage manuel → match exact
  //   • Backup code (6 derniers caractères du serial) → filet de secours caisse
  //     → match par suffixe insensible à la casse
  // L'incrément passe ensuite par le même RPC atomique, quel que soit le format.
  const SELECT_CLIENT = 'id, prenom, stored_value, marchand_id, pass_serial_number, marchands(id, max_value, display_max_value, actif, nom, slug, forfait, langue, type_programme, images_tiers, couleur_fond, couleur_fond_reward, couleur_pastille_fond, couleur_pastille_contour, couleur_pastille_icone, couleur_label_strip,logo_url, strip_mode, strip_theme, stamp_icon, strip_custom_background_url, strip_config_version, referral_enabled, referral_bonus_points)';
  const raw = String(serial_input).trim().toLowerCase();
  let client = null;

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(raw)) {
    const { data } = await supabase
      .from('clients').select(SELECT_CLIENT)
      .eq('pass_serial_number', raw)
      .eq('marchand_id', req.marchandId)
      .is('deleted_at', null)
      .single();
    client = data || null;
  } else if (/^[0-9a-f]{6}$/.test(raw)) {
    const { data: matches } = await supabase
      .from('clients').select(SELECT_CLIENT)
      .eq('marchand_id', req.marchandId)
      .is('deleted_at', null)
      .ilike('pass_serial_number', '%' + raw);
    if (matches && matches.length > 1) {
      // Collision (ultra-rare) : jamais de tampon aveugle → on renvoie les
      // candidats pour désambiguïsation d'un tap côté caisse.
      return res.status(409).json({
        error: 'ambiguous',
        candidates: matches.map(m => ({ prenom: m.prenom, serial: m.pass_serial_number })),
      });
    }
    client = (matches && matches[0]) || null;
  } else {
    return res.status(400).json({ error: 'Invalid code — enter the full pass ID or the 6-character backup code' });
  }

  if (!client) {
    return res.status(404).json({ error: 'Pass not found or unauthorized' });
  }
  if (!client.marchands.actif) {
    return res.status(403).json({ error: 'Merchant account suspended' });
  }

  const maxValue = client.marchands.max_value;
  const displayMaxValue = client.marchands.display_max_value || maxValue;

  // Montant ajouté par ce scan — dépend du mode du marchand :
  //   • 'stamps' (défaut) → toujours +1, quoi que le corps contienne (défense
  //     en profondeur : un marchand en tampons ne peut jamais recevoir un
  //     montant variable, même si un client malveillant envoie "points").
  //   • 'points' → montant saisi en caisse, validé (entier positif, borné).
  const isPointsMode = client.marchands.type_programme === 'points';
  let amount = 1;
  if (isPointsMode) {
    const parsed = Number(points);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 100000) {
      return res.status(400).json({ error: 'points must be a positive integer (max 100000)' });
    }
    amount = parsed;
  }

  // Incrément atomique côté Postgres (SELECT … FOR UPDATE) — évite la perte de
  // points si deux scans simultanés lisent puis écrivent la même valeur.
  // p_type_programme : mode tampons (défaut) → v_apres reset à 0 comme avant,
  // strictement inchangé. Mode points → le scan de redemption reporte le
  // surplus au lieu de repartir à 0 (migration_022_points_report.sql).
  const { data: incr, error: errIncr } = await supabase.rpc('increment_stored_value', {
    p_client_id: client.id,
    p_max_value: maxValue,
    p_amount: amount,
    p_type_programme: client.marchands.type_programme || 'stamps',
  });

  if (errIncr) return res.status(500).json({ error: errIncr.message });

  const row = Array.isArray(incr) ? incr[0] : incr;
  if (!row) return res.status(500).json({ error: 'Increment failed' });

  const avantScan  = row.stored_value_avant;
  const apresScan  = row.stored_value_apres;
  const isReset    = row.is_reset;
  const recompense = !isReset && apresScan >= maxValue;

  // Colonnes de mesure (migration_031) — remplies ICI, jamais dans la RPC
  // (increment_stored_value reste intacte → hors du mode d'échec de juillet).
  //   • montant_credite : points/tampons réellement AJOUTÉS par ce scan, jamais
  //     négatif. 0 sur une redemption en tampons (reset, rien n'est ajouté) ;
  //     amount sinon — en points, une redemption crédite bien amount, le surplus
  //     étant reporté (migration_022). Sommer = total distribué propre, sans les
  //     négatifs des resets.
  //   • recompense_distribuee : TRUE sur le scan de REDEMPTION (is_reset) — le
  //     moment où la boutique remet le cadeau. C'est l'événement « récompense
  //     distribuée » ; c'est cette boutique qui en est créditée.
  const montantCredite       = (isReset && !isPointsMode) ? 0 : amount;
  const recompenseDistribuee = isReset;

  const lang = client.marchands.langue;
  // isReset : mode tampons → vraie remise à 0, message passReset inchangé.
  // Mode points → "redemption" avec report (apresScan = surplus, jamais 0) :
  // passReset dirait littéralement "0/max" (faux, surtout le texte FR "remise
  // à zéro"). On envoie passProgress avec la vraie valeur reportée à la
  // place — le client voit "+100 — Sarah : 130/500", jamais un mensonge.
  const scanMessage = isReset
    ? (isPointsMode
        ? notif('passProgress', lang, { prenom: client.prenom, value: apresScan, max: displayMaxValue, amount })
        : notif('passReset',    lang, { prenom: client.prenom, max: displayMaxValue }))
    : recompense
      ? notif('passReward',   lang, { prenom: client.prenom })
      : notif('passProgress', lang, { prenom: client.prenom, value: apresScan, max: displayMaxValue, amount });

  // Message de notification du pass + log du scan en parallèle.
  // On agit sur le serial RÉSOLU (client.pass_serial_number), jamais sur
  // l'entrée brute : sinon un scan par code de secours ne matcherait aucune ligne.
  const serial = client.pass_serial_number;
  await Promise.all([
    supabase.from('passes')
      .update({ notification_message: scanMessage, updated_at: new Date().toISOString() })
      .eq('serial_number', serial)
      .eq('marchand_id', req.marchandId),
    supabase.from('scans').insert({
      client_id: client.id,
      marchand_id: req.marchandId,
      stored_value_avant: avantScan,
      stored_value_apres: apresScan,
      montant_credite:       montantCredite,
      recompense_distribuee: recompenseDistribuee,
      point_de_vente_id:     pointDeVenteId,
    }),
  ]);

  // Mises à jour Apple + Google Wallet en parallèle, sans bloquer la réponse
  notifierMiseAJourPass(serial).catch(e => console.error('[scan] push Apple:', e.message));
  mettreAJourGoogleWallet(serial, req.marchandId, apresScan, maxValue, displayMaxValue, scanMessage, client.marchands.images_tiers, client.prenom, client.marchands.couleur_fond, client.marchands.couleur_fond_reward, client.marchands).catch(e => console.error('[scan] push Google:', e.message));

  // Parrainage — crédit au parrain au premier tampon/point du filleul, UNE
  // SEULE FOIS à vie. avantScan === 0 est le déclencheur (plutôt que
  // apresScan === 1, faux en mode points où le premier scan peut valoir +N) ;
  // il redevient vrai à chaque cycle en tampons (reset) et après une remise à
  // zéro manuelle — ces re-déclenchements sont refusés par le ticket unique
  // posé dans creditReferrerIfApplicable (index referral_credits_filleul_unique,
  // migration_024), jamais re-crédités.
  if (avantScan === 0 && client.marchands.referral_enabled) {
    creditReferrerIfApplicable(client.id, req.marchandId, client.marchands.referral_bonus_points || 1)
      .catch(e => console.error('[scan] referral credit:', e.message));
  }

  res.json({
    prenom: client.prenom,
    stored_value_avant: avantScan,
    stored_value_apres: apresScan,
    max_value: maxValue,
    display_max_value: displayMaxValue,
    amount,
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
    .select('prenom, pass_serial_number, marchands(id, max_value, display_max_value, images_tiers, couleur_fond, couleur_fond_reward, couleur_pastille_fond, couleur_pastille_contour, couleur_pastille_icone, couleur_label_strip,slug, forfait, langue, type_programme, logo_url, strip_mode, strip_theme, stamp_icon, strip_custom_background_url, strip_config_version)')
    .eq('id', parrainClientId)
    .eq('marchand_id', marchandId)
    .single();

  if (!parrain?.pass_serial_number) return;

  // LE TICKET, avant le crédit. L'index unique referral_credits_filleul_unique
  // (migration_024) fait respecter la règle métier par la base elle-même : un
  // filleul ne génère qu'un crédit, à vie. Si la ligne existe déjà, l'insert
  // échoue en 23505 (unique_violation) → déjà crédité → on s'arrête sans bruit.
  // Ticket AVANT crédit : un échec entre les deux fait rater un crédit
  // (rattrapable), jamais le doubler. L'erreur est LUE (supabase-js ne rejette
  // jamais : l'ancien .then().catch() jetait la réponse sans la regarder).
  const { error: errTicket } = await supabase.from('referral_credits').insert({
    marchand_id:       marchandId,
    parrain_client_id: parrainClientId,
    filleul_client_id: filleulClientId,
    points_credited:   bonusPoints,
  });
  if (errTicket) {
    if (errTicket.code === '23505') return; // parrain déjà crédité pour ce filleul
    throw new Error(`referral_credits insert: ${errTicket.message}`);
  }

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
  const msg        = notif('referral', parrain.marchands.langue, { prenom: parrain.prenom, bonus: bonusPoints, value: newValue, max: displayMax });

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

// GET /api/scan — historique des scans (100 derniers).
// authScanner (et non authMarchand) : un token BOUTIQUE (role scanner) doit
// pouvoir lire son historique — sinon la caissière de réseau a un écran vide
// (bug live depuis l'étape 3). authScanner accepte aussi le token marchand,
// donc le dashboard (mono-site + owner) reste inchangé.
router.get('/', authScanner, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 200);
  let query = supabase
    .from('scans')
    .select('id, date_scan, stored_value_avant, stored_value_apres, annule_le, clients(id, prenom)')
    .eq('marchand_id', req.marchandId);
  // Token boutique → historique scopé à SA boutique. Token marchand → tout le
  // marchand (comportement actuel, mono-site et dashboard).
  if (req.scannerRole === 'scanner' && req.pointDeVenteId) {
    query = query.eq('point_de_vente_id', req.pointDeVenteId);
  }
  const { data, error } = await query
    .order('date_scan', { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
}));

// POST /api/scan/:id/annuler — annuler le dernier scan D'UN CLIENT (étape 5).
// Délègue à la fonction atomique annuler_scan (verrou par carte, restaure le
// solde, marque le scan). Refus propre (409) si ce n'est pas le dernier scan
// actif du client, si le solde est incohérent, ou s'il est déjà annulé.
router.post('/:id/annuler', authScanner, asyncHandler(async (req, res) => {
  // Token boutique : ne peut annuler QUE les scans de SA boutique (isolation
  // réseau, cohérent avec l'étape 3). Contrôle d'autorisation ; la RPC revalide
  // l'intégrité de façon atomique juste après.
  if (req.scannerRole === 'scanner' && req.pointDeVenteId) {
    const { data: sc } = await supabase
      .from('scans').select('point_de_vente_id')
      .eq('id', req.params.id).eq('marchand_id', req.marchandId).maybeSingle();
    if (!sc || sc.point_de_vente_id !== req.pointDeVenteId) {
      return res.status(403).json({ ok: false, reason: 'autre_boutique' });
    }
  }

  const { data, error } = await supabase.rpc('annuler_scan', {
    p_scan_id: req.params.id,
    p_marchand_id: req.marchandId,
  });
  if (error) return res.status(500).json({ error: error.message });
  if (!data || data.ok !== true) {
    return res.status(409).json({ ok: false, reason: (data && data.reason) || 'refus' });
  }

  // Solde restauré → resync du pass (Apple + Google). Réutilise le chemin de
  // l'ajustement manuel pour un message client cohérent. Fire-and-forget.
  const { data: client } = await supabase
    .from('clients').select('prenom').eq('id', data.client_id).single();
  const { syncPassAfterAdjustment } = require('./clients');
  syncPassAfterAdjustment(data.serial, req.marchandId, client?.prenom || '', data.stored_value)
    .catch(e => console.error('[scan] annulation resync:', e.message));

  res.json({ ok: true, stored_value: data.stored_value });
}));

module.exports = router;
