const express = require('express');
const router = express.Router();
const supabase = require('../services/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { suivre } = require('../services/arret');   // envois après la réponse, attendus à l'arrêt (étape 14a)
const { authScanner, authMarchand } = require('../middleware/auth');
const { notif } = require('../i18n/messages');

// Clé d'idempotence (étape 11) : un identifiant par scan voulu, fourni par
// l'écran. FACULTATIVE pendant la transition (un écran ouvert depuis avant 11b
// n'en envoie pas) ; présente, elle doit être un UUID.
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// POST /scan — scan d'un pass en caisse
// Corps : { serial_number, points?, cle_idempotence? }
//   ⚠️ Le champ `serial_number` du body n'est PAS forcément un serial : c'est
//   une ENTRÉE à résoudre — soit un UUID complet (caméra), soit un code de
//   secours 6 caractères (saisie manuelle). D'où le nom local `serial_input`.
//   Ne JAMAIS s'en servir pour agir sur une entité (passes, device_tokens,
//   objet Google) : utiliser `client.pass_serial_number` (le serial résolu).
router.post('/', authScanner, asyncHandler(async (req, res) => {
  const { serial_number: serial_input, points, cle_idempotence } = req.body;

  if (!serial_input) {
    return res.status(400).json({ error: 'serial_number required' });
  }
  let cle = null;
  if (cle_idempotence !== undefined && cle_idempotence !== null && cle_idempotence !== '') {
    cle = String(cle_idempotence).trim().toLowerCase();
    if (!RE_UUID.test(cle)) {
      return res.status(400).json({ error: 'cle_idempotence must be a UUID' });
    }
  }

  // ── Multi-boutiques (3c) : attribution + coupure + durcissement ────────────
  // On statue AVANT toute écriture. Le statut de la boutique est TOUJOURS relu
  // en base (jamais présumé depuis le JWT) → c'est ce qui rend la coupure
  // effective au scan suivant.
  // Étape 16 : une lecture en erreur (base lente, coupée au délai, ou en panne)
  // répond 503, jamais 403 access_disabled ni 404 : la caisse y voit un
  // incident de connexion (nouvel essai, clé gardée), pas une déconnexion ni
  // une carte inconnue.
  const baseIndisponible = (etape, error) => {
    console.error(`[scan] lecture ${etape} impossible :`, error.message);
    return res.status(503).json({ error: 'database_unavailable' });
  };

  let pointDeVenteId = null;
  if (req.scannerRole === 'scanner') {
    const { data: pdv, error: errPdv } = await supabase
      .from('points_de_vente')
      .select('id, actif, deleted_at')
      .eq('id', req.pointDeVenteId)
      .eq('marchand_id', req.marchandId)
      .maybeSingle();
    if (errPdv) return baseIndisponible('boutique', errPdv);
    // Coupée (actif=false), archivée (deleted_at), ou introuvable → refus.
    if (!pdv || pdv.deleted_at || !pdv.actif) {
      return res.status(403).json({ error: 'access_disabled' });
    }
    pointDeVenteId = pdv.id;
  } else {
    // Token marchand : refusé si le réseau a AU MOINS une boutique provisionnée
    // (index partiel idx_points_de_vente_reseau_actif). Sinon mono-site → autorisé,
    // point_de_vente_id reste NULL, comportement identique à aujourd'hui.
    const { data: reseau, error: errReseau } = await supabase
      .from('points_de_vente')
      .select('id')
      .eq('marchand_id', req.marchandId)
      .is('deleted_at', null)
      .not('scanner_login', 'is', null)
      .limit(1);
    if (errReseau) return baseIndisponible('réseau', errReseau);
    if (reseau && reseau.length > 0) {
      return res.status(403).json({ error: 'use_boutique_login' });
    }
  }

  // Résolution du client — deux formats acceptés, toujours scopés au marchand :
  //   • UUID complet (36 car.) → scan caméra ou collage manuel → match exact
  //   • Backup code (6 derniers caractères du serial) → filet de secours caisse
  //     → match par suffixe insensible à la casse
  // L'incrément passe ensuite par le même RPC atomique, quel que soit le format.
  const SELECT_CLIENT = 'id, prenom, stored_value, marchand_id, pass_serial_number, marchands(id, max_value, display_max_value, actif, nom, slug, forfait, langue, type_programme, images_tiers, couleur_fond, couleur_fond_reward, couleur_pastille_fond, couleur_pastille_contour, couleur_pastille_icone, couleur_label_strip, couleur_barre_principale, couleur_barre_secondaire,logo_url, strip_mode, strip_theme, strip_illustration, strip_produit, strip_vide, stamp_icon, strip_custom_background_url, strip_config_version, referral_enabled, referral_bonus_points, lien_avis_google)';
  const raw = String(serial_input).trim().toLowerCase();
  let client = null;

  if (RE_UUID.test(raw)) {
    const { data, error } = await supabase
      .from('clients').select(SELECT_CLIENT)
      .eq('pass_serial_number', raw)
      .eq('marchand_id', req.marchandId)
      .is('deleted_at', null)
      .single();
    // PGRST116 : aucune ligne (ou plusieurs) pour .single() → carte inconnue.
    if (error && error.code !== 'PGRST116') return baseIndisponible('client', error);
    client = data || null;
  } else if (/^[0-9a-f]{6}$/.test(raw)) {
    const { data: matches, error } = await supabase
      .from('clients').select(SELECT_CLIENT)
      .eq('marchand_id', req.marchandId)
      .is('deleted_at', null)
      .ilike('pass_serial_number', '%' + raw);
    if (error) return baseIndisponible('code de secours', error);
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

  // Message de la carte selon l'issue du scan. isReset : mode tampons → vraie
  // remise à 0, message passReset. Mode points → remise avec report (le solde
  // après vaut le surplus, jamais 0) : passReset dirait « 0/max », faux ; on
  // envoie passProgress avec la vraie valeur reportée — « +100 — Sarah : 130/500 ».
  const lang = client.marchands.langue;
  const messageScan = (reset, recomp, valeur) => reset
    ? (isPointsMode
        ? notif('passProgress', lang, { prenom: client.prenom, value: valeur, max: displayMaxValue, amount })
        : notif('passReset',    lang, { prenom: client.prenom, max: displayMaxValue }))
    : recomp
      ? notif('passReward',   lang, { prenom: client.prenom })
      : notif('passProgress', lang, { prenom: client.prenom, value: valeur, max: displayMaxValue, amount });

  // Crédit, ligne de journal et carte en UNE transaction (crediter_scan,
  // migration 051) : tout ou rien. Plus de solde crédité sans ligne, plus de
  // lignes dans le désordre, et une clé déjà enregistrée rend le premier
  // résultat au lieu de recréditer. La règle (report, remise, seuil) reste dans
  // increment_stored_value, que la fonction appelle telle quelle.
  // Les trois messages possibles sont préparés ici (les textes vivent dans
  // i18n) ; la base pose celui de l'issue réelle, « {{solde}} » remplacé par le
  // solde après le scan.
  const { data: credit, error: errCredit } = await supabase.rpc('crediter_scan', {
    p_client_id:         client.id,
    p_marchand_id:       req.marchandId,
    p_point_de_vente_id: pointDeVenteId,
    p_max_value:         maxValue,
    p_montant:           amount,
    p_type_programme:    client.marchands.type_programme || 'stamps',
    p_cle:               cle,
    p_msg_remise:        notif('passReset',    lang, { prenom: client.prenom, max: displayMaxValue }),
    p_msg_recompense:    notif('passReward',   lang, { prenom: client.prenom }),
    p_msg_progression:   notif('passProgress', lang, { prenom: client.prenom, value: '{{solde}}', max: displayMaxValue, amount }),
  });

  if (errCredit) {
    // 23505 : la même clé vient d'être enregistrée pour un AUTRE client, au
    // même instant. La transaction entière est annulée : rien n'est écrit.
    if (errCredit.code === '23505') return res.status(409).json({ error: 'idempotency_conflict' });
    // Toute autre erreur vient de la base (coupure à 5 s, panne) : 503, comme les
    // lectures (étape 16). La transaction a pu aboutir quand même (PostgREST la
    // finit, §15 tervicies) : l'écran garde la clé, le renvoi rend le premier
    // résultat sans recréditer.
    console.error('[scan] écriture crediter_scan impossible :', errCredit.message);
    return res.status(503).json({ error: 'database_unavailable' });
  }
  if (!credit || credit.ok !== true) {
    const raison = credit && credit.reason;
    if (raison === 'client_introuvable') return res.status(404).json({ error: 'Pass not found or unauthorized' });
    // Clé déjà enregistrée pour un scan annulé depuis : jamais recrédité.
    if (raison === 'scan_annule') return res.status(409).json({ error: 'scan_cancelled' });
    // Clé déjà enregistrée pour une autre carte ou un autre montant.
    return res.status(409).json({ error: 'idempotency_conflict' });
  }

  // deja_enregistre : renvoi d'une demande déjà créditée (même clé). Même
  // réponse que la première fois, rien de recrédité.
  const dejaEnregistre = credit.deja_enregistre === true;
  const avantScan  = credit.stored_value_avant;
  const apresScan  = credit.stored_value_apres;
  const isReset    = credit.is_reset === true;
  const recompense = !isReset && apresScan >= maxValue;
  const scanMessage = messageScan(isReset, recompense, apresScan);
  // Serial RÉSOLU (client.pass_serial_number), jamais l'entrée brute : sinon un
  // scan par code de secours ne correspondrait à aucune carte.
  const serial = client.pass_serial_number;

  // Mises à jour Apple + Google Wallet en parallèle, sans bloquer la réponse.
  // Aussi sur un renvoi : le premier envoi a pu ne jamais partir (réponse de la
  // base perdue → 500, audit 02 §3.2 ligne c). Les deux sont sans effet si la
  // carte est déjà à jour — sauf le message Google, qui s'afficherait deux fois
  // sur Android : il n'est envoyé qu'au premier passage.
  suivre(notifierMiseAJourPass(serial, req.marchandId).catch(e => console.error('[scan] push Apple:', e.message)));
  suivre(mettreAJourGoogleWallet(serial, req.marchandId, apresScan, maxValue, displayMaxValue, scanMessage, client.marchands.images_tiers, client.prenom, client.marchands.couleur_fond, client.marchands.couleur_fond_reward, client.marchands, { message: !dejaEnregistre }).catch(e => console.error('[scan] push Google:', e.message)));

  // Parrainage — crédit au parrain au premier tampon/point du filleul, UNE
  // SEULE FOIS à vie. avantScan === 0 est le déclencheur (plutôt que
  // apresScan === 1, faux en mode points où le premier scan peut valoir +N) ;
  // il redevient vrai à chaque cycle en tampons (reset) et après une remise à
  // zéro manuelle — ces re-déclenchements sont refusés par le ticket unique
  // posé dans creditReferrerIfApplicable (index referral_credits_filleul_unique,
  // migration_024), jamais re-crédités.
  if (!dejaEnregistre && avantScan === 0 && client.marchands.referral_enabled) {
    suivre(creditReferrerIfApplicable(client.id, req.marchandId, client.marchands.referral_bonus_points || 1)
      .catch(e => console.error('[scan] referral credit:', e.message)));
  }

  res.json({
    prenom: client.prenom,
    stored_value_avant: avantScan,
    stored_value_apres: apresScan,
    max_value: maxValue,
    display_max_value: displayMaxValue,
    amount,
    // recompense : le SEUIL vient d'être franchi. La récompense est acquise mais
    // n'est PAS à remettre maintenant — elle se donne au passage suivant.
    recompense,
    // is_reset : CE scan est celui de la remise. C'est le seul moment où le
    // caissier doit donner la récompense. Le front ne pouvait pas le déduire :
    // en mode points le solde après remise vaut le surplus reporté, jamais 0,
    // donc l'heuristique « solde === 0 » du dashboard était aveugle.
    is_reset: isReset,
    message: scanMessage,
    // deja_enregistre : cette demande avait déjà été créditée (même clé) ; la
    // réponse est celle du premier passage, rien n'a été recrédité.
    deja_enregistre: dejaEnregistre,
  });

  // ── Demande d'avis Google, 30 min plus tard ─────────────────────────────
  // APRÈS res.json() : la caisse a déjà sa réponse, rien de ce qui suit ne peut
  // la ralentir. ZÉRO REQUÊTE AJOUTÉE AU SCAN — lien_avis_google, la langue et
  // le prénom sont déjà en main (SELECT_CLIENT, lu une seule fois plus haut).
  //
  // isReset et non `recompense` : le déclencheur est la récompense REMISE, pas le
  // franchissement du seuil. Même signal dans les deux modes (tampons et points).
  //
  // planifier() est synchrone, ne lit rien et ne lève jamais ; elle rend false
  // (sans bruit) si le marchand n'a pas de lien d'avis — l'unique interrupteur.
  // Pas sur un renvoi : la demande d'avis du premier passage est déjà planifiée.
  if (isReset && !dejaEnregistre) {
    require('../services/avis').planifier({
      marchand: client.marchands,
      prenom:   client.prenom,
      serial,
    });
  }
}));

async function notifierMiseAJourPass(serialNumber, marchandId) {
  const { data: tokens } = await supabase
    .from('device_tokens')
    .select('push_token')
    .eq('serial_number', serialNumber);

  if (!tokens || tokens.length === 0) return;

  const registre = require('../services/notif-registre');
  const lot = registre.creerLot('scan', marchandId);

  const { sendPushUpdate } = require('../services/apns');
  for (const { push_token } of tokens) {
    let erreur = null;
    await sendPushUpdate(push_token).catch(e => { erreur = e; console.error(`[scan] sendPushUpdate échoué (…${push_token.slice(-8)}):`, e.message); });
    lot.ajouter({ plateforme: 'apple', serialNumber, pushToken: push_token, erreur });
  }
  // Après les envois : ne retarde rien. Un appareil porte typiquement 1 jeton
  // par carte, donc 1 ligne — le lot reste un insert unique par scan.
  await lot.ecrire();
}

// options.message = false : met à jour l'objet (solde, visuel) sans ajouter de
// message — renvoi d'un scan déjà enregistré (le message s'afficherait deux fois).
async function mettreAJourGoogleWallet(serialNumber, marchandId, storedValue, maxValue, displayMaxValue, scanMessage, imagesTiers, prenom, couleurFond, couleurFondReward, marchand, { message = true } = {}) {
  const { updateLoyaltyObjectPoints, addMessageToLoyaltyObject } = require('../services/google-pass');
  const registre = require('../services/notif-registre');
  const lot = registre.creerLot('scan', marchandId);

  // updateLoyaltyObjectPoints NE LEVAIT PAS sur un statut non-200 (le statut
  // n'était pas lu) ; il le fait désormais. Sans ce catch, l'exception
  // sauterait l'addMessage qui suit et le message Android ne partirait plus —
  // ce serait un changement de comportement visible, hors périmètre de ce lot.
  let errUpd = null;
  await updateLoyaltyObjectPoints(serialNumber, marchandId, storedValue, maxValue, displayMaxValue, imagesTiers, prenom, couleurFond, couleurFondReward, marchand)
    .catch(e => { errUpd = e; console.error('[scan] Google updateObject:', e.message); });
  lot.ajouter({ plateforme: 'google', serialNumber, erreur: errUpd });

  if (message) {
    let errMsg = null;
    await addMessageToLoyaltyObject(serialNumber, null, scanMessage)
      .catch(e => { errMsg = e; console.error('[scan] Google addMessage:', e.message); });
    lot.ajouter({ plateforme: 'google', serialNumber, erreur: errMsg });
  }

  await lot.ecrire();
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
    .select('prenom, pass_serial_number, marchands(id, max_value, display_max_value, images_tiers, couleur_fond, couleur_fond_reward, couleur_pastille_fond, couleur_pastille_contour, couleur_pastille_icone, couleur_label_strip, couleur_barre_principale, couleur_barre_secondaire,slug, forfait, langue, type_programme, logo_url, strip_mode, strip_theme, strip_illustration, strip_produit, strip_vide, stamp_icon, strip_custom_background_url, strip_config_version, lien_avis_google)')
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

  // Crédit atomique (migration 053) : jamais de baisse ni de reset ; plafond au
  // seuil en tampons, bonus entier en points ; seul le parrain est verrouillé.
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
  suivre(notifierMiseAJourPass(parrain.pass_serial_number, marchandId)
    .catch(e => console.error('[scan] referral push Apple:', e.message)));
  suivre(mettreAJourGoogleWallet(
    parrain.pass_serial_number, marchandId, newValue, maxValue, displayMax,
    msg, parrain.marchands.images_tiers, parrain.prenom,
    parrain.marchands.couleur_fond, parrain.marchands.couleur_fond_reward, parrain.marchands
  ).catch(e => console.error('[scan] referral push Google:', e.message)));

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
  suivre(syncPassAfterAdjustment(data.serial, req.marchandId, client?.prenom || '', data.stored_value, 'annulation')
    .catch(e => console.error('[scan] annulation resync:', e.message)));

  res.json({ ok: true, stored_value: data.stored_value });
}));

module.exports = router;
