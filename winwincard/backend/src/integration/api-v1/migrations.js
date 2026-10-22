// ════════════════════════════════════════════════════════════════════════════
// POST /api/v1/migrations — reverser les points d'avant (contrat v1 §6 bis,
// étape 4, 22/10)
//
// La caisse du commerçant cumule déjà des points sous le numéro de ses clients ;
// quand un client installe sa carte WinWin, ils y sont reversés UNE SEULE FOIS.
// L'API reçoit des points DÉJÀ CONVERTIS : aucun taux ici (décision métier,
// réglée plus tard avec les décisionnaires).
//
// Chemin : crediter_migration (migration 069), une transaction sous le verrou de
// la carte, tracée dans le journal des AJUSTEMENTS — jamais dans les scans :
// une migration ne compte nulle part comme un passage (statistiques, segments,
// relances). Puis la carte est mise à jour dans le téléphone, comme après une
// vente. NI demande d'avis, NI parrainage. Correction : ajustement depuis le
// dashboard (pas d'annulation par l'API).
// ════════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const supabase = require('../../services/supabase');
const asyncHandler = require('../../utils/asyncHandler');
const { suivre } = require('../../services/arret');
const { lireCanaux } = require('../../services/canal-google');
const { notifierMiseAJourPass, mettreAJourGoogleWallet } = require('../../services/mise-a-jour-carte');
const { COLONNES_MARCHAND_CARTE } = require('../../services/colonnes-carte');
const { notif } = require('../../i18n/messages');
const { lireIdentifiant, trouverCarte } = require('./identification');
const { lireBoutiques, choisirBoutique } = require('./boutiques');

const indisponible = (res, etape, error) => {
  console.error(`[api-v1] migration, ${etape} impossible :`, error.message);
  return res.set('Retry-After', '30').status(503).json({ error: 'service_indisponible' });
};

router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const invalide = champ => res.status(400).json({ error: 'corps_invalide', champ });

  // ── 1. Le corps ────────────────────────────────────────────────────────────
  const ident = lireIdentifiant(b);
  if (ident.champ) return invalide(ident.champ);
  if (!Number.isInteger(b.points) || b.points < 1 || b.points > 100000) return invalide('points');
  if (b.boutique != null && (typeof b.boutique !== 'string' || !/^[A-Za-z0-9._:/-]{1,64}$/.test(b.boutique))) return invalide('boutique');

  // ── 2. Le commerçant, la boutique, la carte ────────────────────────────────
  const [{ data: marchand, error: errM }, { data: boutiques, error: errB }] = await Promise.all([
    supabase.from('marchands').select(COLONNES_MARCHAND_CARTE).eq('id', req.marchandId).single(),
    lireBoutiques(req.marchandId),
  ]);
  if (errM) return indisponible(res, 'lecture du commerçant', errM);
  if (errB) return indisponible(res, 'lecture des boutiques', errB);
  const boutique = choisirBoutique(boutiques, b.boutique);
  if (boutique.statut) return res.status(boutique.statut).json(boutique.corps);

  const trouve = await trouverCarte(req.marchandId, marchand.slug, ident, b.telephone);
  if (trouve.erreur) return indisponible(res, 'lecture de la carte', trouve.erreur);
  if (trouve.statut) return res.status(trouve.statut).json(trouve.corps);
  const { client } = trouve;

  // ── 3. Le crédit unique ────────────────────────────────────────────────────
  const lang = marchand.langue;
  const maxValue = marchand.max_value;
  const displayMax = marchand.display_max_value || maxValue;
  const { data: r, error } = await supabase.rpc('crediter_migration', {
    p_client_id: client.id, p_marchand_id: req.marchandId, p_point_de_vente_id: boutique.id,
    p_points: b.points, p_max_value: maxValue, p_type_programme: marchand.type_programme || 'stamps',
    p_msg_recompense: notif('passReward', lang, { prenom: client.prenom }),
    p_msg_progression: notif('passProgress', lang, { prenom: client.prenom, value: '{{solde}}', max: displayMax, amount: b.points }),
  });
  if (error) {
    // 23505 : une autre migration de cette carte vient d'être écrite au même instant.
    if (error.code === '23505') return res.status(409).json({ error: 'migration_deja_faite' });
    return indisponible(res, 'crédit', error);
  }
  if (!r || r.ok !== true) {
    const raison = r && r.reason;
    if (raison === 'client_introuvable') return res.status(404).json({ error: 'carte_inconnue' });
    if (raison === 'points_hors_bornes') return res.status(422).json({ error: 'points_hors_bornes' });
    if (raison === 'recompense_en_attente') return res.status(409).json({ error: 'recompense_en_attente' });
    return res.status(409).json({ error: 'migration_deja_faite' });
  }

  const deja = r.deja_migree === true;
  const apres = r.stored_value_apres;
  res.json({
    ok: true, deja_migree: deja, points_credites: apres - r.stored_value_avant,
    solde: apres, seuil: maxValue, seuil_atteint: apres >= maxValue,
  });

  // ── 4. Après la réponse : la carte du client (ni avis, ni parrainage) ──────
  const serial = client.pass_serial_number;
  const message = apres >= maxValue
    ? notif('passReward', lang, { prenom: client.prenom })
    : notif('passProgress', lang, { prenom: client.prenom, value: apres, max: displayMax, amount: b.points });
  const canaux = lireCanaux(serial);
  suivre(notifierMiseAJourPass(serial, req.marchandId, canaux).catch(e => console.error('[api-v1] push Apple:', e.message)));
  suivre(mettreAJourGoogleWallet(serial, req.marchandId, apres, maxValue, displayMax, message, marchand.images_tiers, client.prenom,
    marchand.couleur_fond, marchand.couleur_fond_reward, marchand, { message: !deja, canaux })
    .catch(e => console.error('[api-v1] push Google:', e.message)));
}));

module.exports = router;
