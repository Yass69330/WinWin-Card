// ════════════════════════════════════════════════════════════════════════════
// POST /api/v1/ventes — créditer une vente (contrat v1 §4, étape 2, 21/10)
//
// Même chemin que le comptoir : la transaction d'argent est crediter_scan
// (migration 051), appelée par crediter_vente (migration 067), qui marque la
// ligne de journal (canal « caisse », référence, montant en fils) dans la même
// transaction ; puis la carte est mise à jour (services/mise-a-jour-carte.js) et,
// après une remise, la demande d'avis Google est planifiée. PAS de parrainage
// (décision du pilotage : propre au comptoir).
//
// Idempotence : la clé t43 est DÉRIVÉE de la référence (UUID v5 de
// « marchand:référence » dans l'espace ESPACE_VENTES). La même vente renvoyée,
// même mille fois, retombe sur la même clé : rien n'est recrédité.
//
// Invariant (§0) : WinWin ne bloque jamais une vente. Toute réponse ici ne parle
// que de la fidélité ; la caisse encaisse quoi qu'il arrive.
//
// Pas encore (étape « téléphone ») : `telephone` est accepté mais pas traité
// (réponse « non_traite ») ; une vente sans `carte` est refusée (400).
// ════════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const { v5: uuidv5 } = require('uuid');
const supabase = require('../../services/supabase');
const asyncHandler = require('../../utils/asyncHandler');
const { suivre } = require('../../services/arret');
const { lireCanaux } = require('../../services/canal-google');
const { notifierMiseAJourPass, mettreAJourGoogleWallet } = require('../../services/mise-a-jour-carte');
const { COLONNES_MARCHAND_CARTE } = require('../../services/colonnes-carte');
const { notif } = require('../../i18n/messages');

// Espace fixe des clés de vente. NE JAMAIS LE CHANGER : une vente déjà créditée
// renvoyée après le changement serait créditée une seconde fois.
const ESPACE_VENTES = 'feaf209d-c24a-4578-888e-dc1490544243';
const RE_REFERENCE = /^[A-Za-z0-9._:/-]{1,64}$/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RE_CODE_COURT = /^[0-9a-f]{6}$/;
const RETARD_MAX_MS = 7 * 24 * 3600 * 1000;   // vente envoyée en retard : 7 jours au plus
const AVANCE_MAX_MS = 5 * 60 * 1000;          // horloge de la caisse en avance : 5 min au plus

const indisponible = (res, etape, error) => {
  console.error(`[api-v1] vente, ${etape} impossible :`, error.message);
  return res.set('Retry-After', '30').status(503).json({ error: 'service_indisponible' });
};

router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const invalide = champ => res.status(400).json({ error: 'corps_invalide', champ });

  // ── 1. Le corps ────────────────────────────────────────────────────────────
  if (typeof b.reference !== 'string' || !RE_REFERENCE.test(b.reference)) return invalide('reference');
  if (typeof b.carte !== 'string') return invalide('carte');
  const carte = b.carte.trim().toLowerCase();
  if (!RE_UUID.test(carte) && !RE_CODE_COURT.test(carte)) return invalide('carte');
  if (!Number.isInteger(b.montant) || b.montant <= 0) return invalide('montant');
  if (b.devise != null && b.devise !== 'AED') return invalide('devise');
  if (b.boutique != null && (typeof b.boutique !== 'string' || !RE_REFERENCE.test(b.boutique))) return invalide('boutique');
  if (b.telephone != null && (typeof b.telephone !== 'string' || b.telephone.length > 40)) return invalide('telephone');
  let venduLe = null;
  if (b.date_vente != null) {
    const t = typeof b.date_vente === 'string' ? Date.parse(b.date_vente) : NaN;
    if (Number.isNaN(t)) return invalide('date_vente');
    if (t < Date.now() - RETARD_MAX_MS || t > Date.now() + AVANCE_MAX_MS) return res.status(422).json({ error: 'date_vente_invalide' });
    venduLe = new Date(t).toISOString();
  }

  // ── 2. Le commerçant et ses boutiques (codes caisse) ───────────────────────
  const [{ data: marchand, error: errM }, { data: boutiques, error: errB }] = await Promise.all([
    supabase.from('marchands').select(`${COLONNES_MARCHAND_CARTE}, fils_par_point, plafond_vente_fils`)
      .eq('id', req.marchandId).single(),
    supabase.from('points_de_vente').select('id, code_externe, actif')
      .eq('marchand_id', req.marchandId).is('deleted_at', null).not('code_externe', 'is', null),
  ]);
  if (errM) return indisponible(res, 'lecture du commerçant', errM);
  if (errB) return indisponible(res, 'lecture des boutiques', errB);

  let pointDeVenteId = null;
  if (boutiques.length > 0) {
    // Réseau : la boutique est obligatoire, et doit être connue et ouverte.
    if (b.boutique == null) return invalide('boutique');
    const pdv = boutiques.find(x => x.code_externe === b.boutique);
    if (!pdv) return res.status(422).json({ error: 'boutique_inconnue' });
    if (!pdv.actif) return res.status(403).json({ error: 'boutique_fermee' });
    pointDeVenteId = pdv.id;
  }

  if (b.montant > marchand.plafond_vente_fils) return res.status(422).json({ error: 'montant_hors_plafond' });

  // ── 3. La carte (contenu du QR ou code court), comme au comptoir ───────────
  let requete = supabase.from('clients').select('id, prenom, stored_value, pass_serial_number')
    .eq('marchand_id', req.marchandId).is('deleted_at', null);
  requete = RE_UUID.test(carte) ? requete.eq('pass_serial_number', carte) : requete.ilike('pass_serial_number', '%' + carte);
  const { data: trouves, error: errC } = await requete.limit(2);
  if (errC) return indisponible(res, 'lecture de la carte', errC);
  if (trouves.length > 1) return res.status(409).json({ error: 'carte_ambigue' });
  if (trouves.length === 0) {
    const base = process.env.API_BASE_URL || 'https://app.winwin-card.com';
    return res.status(404).json({ error: 'carte_inconnue', lien_installation: `${base}/l/${marchand.slug}` });
  }
  const client = trouves[0];

  // ── 4. Conversion : points = montant ÷ fils_par_point (arrondi bas) ; tampons : 1
  const enPoints = marchand.type_programme === 'points';
  const programme = enPoints ? 'points' : 'tampons';
  const maxValue = marchand.max_value;
  const telephone = b.telephone != null ? 'non_traite' : null;
  const montant = enPoints ? Math.floor(b.montant / marchand.fils_par_point) : 1;
  if (montant === 0) {
    return res.json({ ok: true, reference: b.reference, enregistree: false, deja_enregistree: false, programme,
      points_credites: 0, solde: client.stored_value, seuil: maxValue, seuil_atteint: false, recompense_a_remettre: false, telephone });
  }

  // ── 5. Le crédit (une transaction) ─────────────────────────────────────────
  const lang = marchand.langue;
  const displayMax = marchand.display_max_value || maxValue;
  const { data: credit, error: errCredit } = await supabase.rpc('crediter_vente', {
    p_client_id: client.id, p_marchand_id: req.marchandId, p_point_de_vente_id: pointDeVenteId,
    p_max_value: maxValue, p_montant: montant, p_type_programme: marchand.type_programme || 'stamps',
    p_cle: uuidv5(`${req.marchandId}:${b.reference}`, ESPACE_VENTES),
    p_msg_remise: notif('passReset', lang, { prenom: client.prenom, max: displayMax }),
    p_msg_recompense: notif('passReward', lang, { prenom: client.prenom }),
    p_msg_progression: notif('passProgress', lang, { prenom: client.prenom, value: '{{solde}}', max: displayMax, amount: montant }),
    p_reference: b.reference, p_montant_fils: b.montant, p_vendu_le: venduLe,
  });
  if (errCredit) {
    // 23505 : la même référence vient d'être enregistrée pour une autre carte, au même instant.
    if (errCredit.code === '23505') return res.status(409).json({ error: 'reference_deja_utilisee' });
    return indisponible(res, 'crédit', errCredit);
  }
  if (!credit || credit.ok !== true) {
    const raison = credit && credit.reason;
    if (raison === 'client_introuvable') return res.status(404).json({ error: 'carte_inconnue' });
    if (raison === 'scan_annule') return res.status(409).json({ error: 'vente_annulee' });
    return res.status(409).json({ error: 'reference_deja_utilisee' });
  }

  const deja = credit.deja_enregistre === true;
  const avant = credit.stored_value_avant, apres = credit.stored_value_apres;
  const remise = credit.is_reset === true;
  const seuilAtteint = !remise && apres >= maxValue;
  res.json({
    ok: true, reference: b.reference, enregistree: true, deja_enregistree: deja, programme,
    // Une remise en tampons ne donne pas de tampon ; en points, le surplus est reporté.
    points_credites: remise ? (enPoints ? apres - avant + maxValue : 0) : apres - avant,
    solde: apres, seuil: maxValue, seuil_atteint: seuilAtteint, recompense_a_remettre: remise, telephone,
  });

  // ── 6. Après la réponse : la carte du client, puis l'avis (comme au comptoir)
  const serial = client.pass_serial_number;
  const message = remise
    ? (enPoints
        ? notif('passProgress', lang, { prenom: client.prenom, value: apres, max: displayMax, amount: montant })
        : notif('passReset', lang, { prenom: client.prenom, max: displayMax }))
    : seuilAtteint
      ? notif('passReward', lang, { prenom: client.prenom })
      : notif('passProgress', lang, { prenom: client.prenom, value: apres, max: displayMax, amount: montant });
  const canaux = lireCanaux(serial);
  suivre(notifierMiseAJourPass(serial, req.marchandId, canaux).catch(e => console.error('[api-v1] push Apple:', e.message)));
  suivre(mettreAJourGoogleWallet(serial, req.marchandId, apres, maxValue, displayMax, message, marchand.images_tiers, client.prenom,
    marchand.couleur_fond, marchand.couleur_fond_reward, marchand, { message: !deja, canaux })
    .catch(e => console.error('[api-v1] push Google:', e.message)));
  if (remise && !deja) require('../../services/avis').planifier({ marchand, prenom: client.prenom, serial });
}));

module.exports = router;
