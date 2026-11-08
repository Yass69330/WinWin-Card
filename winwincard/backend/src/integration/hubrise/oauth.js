// ════════════════════════════════════════════════════════════════════════════
// Connexion OAuth d'un marchand à Hubrise (H1a, docs/hubrise/02-h1-connexion.md §1)
//
//   GET /integrations/hubrise/connexion?l=<lien signé>
//       vérifie le lien (signature, 30 min, pas encore utilisé, marchand actif),
//       puis redirige vers l'écran d'autorisation Hubrise (state = le lien).
//   GET /integrations/hubrise/retour?code=…&state=…   (ou ?error=…)
//       1. state → marchand ; nonce CONSOMMÉ (usage unique, avant tout appel) ;
//       2. échange du code (serveur à serveur, Basic) ;
//       3. jeton chiffré (coffre.js), connexion écrite en un appel SQL
//          (hubrise_enregistrer_connexion : refus si la location est active chez
//          un autre marchand ; alors le jeton obtenu est révoqué, rien n'est gardé) ;
//       4. (H1b) abonnement aux ventes de la location (abonnement.js) ; un échec
//          garde la connexion, l'admin propose « Abonner aux ventes ».
// Le marchand ne vient JAMAIS d'un paramètre d'adresse, seulement du lien signé.
// Jamais de jeton dans une réponse ni un journal.
// ════════════════════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const router = express.Router();
const supabase = require('../../services/supabase');
const asyncHandler = require('../../utils/asyncHandler');
const config = require('./config');
const lien = require('./lien');
const coffre = require('./coffre');
const hubrise = require('./api-hubrise');
const abonnement = require('./abonnement');
const { page } = require('./page');

const RE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MESSAGES = {
  lien_invalide: ['Lien invalide', 'Ce lien de connexion n\'est pas valable. Demandez-en un nouveau à WinWin.'],
  lien_expire: ['Lien expiré', 'Ce lien de connexion a expiré (30 minutes). Demandez-en un nouveau à WinWin.'],
  lien_deja_utilise: ['Lien déjà utilisé', 'Ce lien de connexion a déjà servi. Demandez-en un nouveau à WinWin.'],
  marchand_introuvable: ['Commerce introuvable', 'Ce commerce n\'est pas actif chez WinWin.'],
  autorisation_refusee: ['Connexion annulée', 'L\'autorisation n\'a pas été donnée sur Hubrise. Rien n\'a été enregistré.'],
  echec_hubrise: ['Hubrise ne répond pas', 'La connexion n\'a pas abouti, rien n\'a été enregistré. Demandez un nouveau lien à WinWin et réessayez.'],
  connexion_non_location: ['Connexion incomplète', 'Hubrise n\'a pas indiqué de point de vente (location). Rien n\'a été enregistré.'],
  location_prise: ['Point de vente déjà relié', 'Ce point de vente Hubrise est déjà relié à un autre commerce WinWin. Rien n\'a été enregistré.'],
  indisponible: ['Service indisponible', 'WinWin ne peut pas enregistrer la connexion pour le moment. Réessayez avec un nouveau lien.'],
};
const echec = (res, statut, raison) => page(res, statut, ...MESSAGES[raison]);

function nonConfigure(req, res, next) {
  if (config.etat().ok) return next();
  return page(res, 503, 'Hubrise non configuré', 'La connexion à Hubrise n\'est pas encore ouverte sur ce serveur.');
}

router.get('/integrations/hubrise/connexion', nonConfigure, asyncHandler(async (req, res) => {
  const v = lien.verifier(req.query.l);
  if (v.erreur) return echec(res, 400, v.erreur);
  const [{ data: m, error: errM }, { data: deja, error: errL }] = await Promise.all([
    supabase.from('marchands').select('id').eq('id', v.marchandId).eq('actif', true).maybeSingle(),
    supabase.from('hubrise_liens_utilises').select('nonce').eq('nonce', v.nonce).maybeSingle(),
  ]);
  if (errM || errL) return echec(res, 503, 'indisponible');
  if (!m) return echec(res, 404, 'marchand_introuvable');
  if (deja) return echec(res, 400, 'lien_deja_utilise');
  const url = new URL(config.managerUrl() + '/oauth2/v1/authorize');
  url.searchParams.set('client_id', process.env.HUBRISE_CLIENT_ID);
  url.searchParams.set('redirect_uri', config.redirectUri());
  url.searchParams.set('scope', config.SCOPE);
  url.searchParams.set('state', String(req.query.l));
  res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer').redirect(302, url.toString());
}));

router.get('/integrations/hubrise/retour', nonConfigure, asyncHandler(async (req, res) => {
  const v = lien.verifier(req.query.state);
  if (v.erreur) return echec(res, 400, v.erreur);

  // Usage unique, AVANT tout appel à Hubrise : deux retours simultanés avec le
  // même state → un seul passe.
  const { error: errNonce } = await supabase.from('hubrise_liens_utilises').insert({ nonce: v.nonce, marchand_id: v.marchandId });
  if (errNonce) {
    if (errNonce.code === '23505') return echec(res, 400, 'lien_deja_utilise');
    if (errNonce.code === '23503') return echec(res, 404, 'marchand_introuvable');
    console.error('[hubrise] retour, lien impossible à consommer :', errNonce.message);
    return echec(res, 503, 'indisponible');
  }
  if (req.query.error || typeof req.query.code !== 'string' || !req.query.code) return echec(res, 400, 'autorisation_refusee');

  const ech = await hubrise.echangerCode(req.query.code);
  if (!ech.ok) {
    console.error('[hubrise] retour, échange du code impossible :', ech.erreur);
    return echec(res, 502, 'echec_hubrise');
  }
  const d = ech.donnees;
  const jeton = d.access_token;
  if (!RE_ID.test(String(d.location_id || '')) || !RE_ID.test(String(d.account_id || ''))) {
    await hubrise.revoquer(jeton);
    return echec(res, 400, 'connexion_non_location');
  }
  const { data: r, error } = await supabase.rpc('hubrise_enregistrer_connexion', {
    p_marchand_id: v.marchandId, p_account_id: String(d.account_id), p_location_id: String(d.location_id),
    p_customer_list_id: RE_ID.test(String(d.customer_list_id || '')) ? String(d.customer_list_id) : null,
    p_nom_location: typeof d.location_name === 'string' ? d.location_name : null,
    p_scope: config.SCOPE,
    p_jeton_chiffre: coffre.chiffrer(jeton, v.marchandId, String(d.location_id)),
  });
  if (error || !r) {
    console.error('[hubrise] retour, enregistrement impossible :', error ? error.message : 'réponse vide');
    await hubrise.revoquer(jeton);
    return echec(res, 503, 'indisponible');
  }
  if (!r.ok) {
    await hubrise.revoquer(jeton);
    return echec(res, r.reason === 'location_prise' ? 409 : 404, r.reason === 'location_prise' ? 'location_prise' : 'marchand_introuvable');
  }
  const nom = typeof d.location_name === 'string' && d.location_name ? ` (${d.location_name})` : '';
  // H1b : abonnement aux ventes de la location. Un échec ne défait pas la
  // connexion : la fiche admin propose « Abonner aux ventes ».
  const ab = await abonnement.abonner({ id: r.connexion_id, marchand_id: v.marchandId, location_id: String(d.location_id) }, jeton);
  if (!ab.ok) {
    return page(res, 200, 'Connecté à Hubrise', `Votre point de vente Hubrise${nom} est relié à WinWin, mais l'abonnement aux ventes est à refaire depuis WinWin. Vous pouvez fermer cette page.`);
  }
  return page(res, 200, 'Connecté à Hubrise', `Votre point de vente Hubrise${nom} est relié à WinWin. Vous pouvez fermer cette page.`);
}));

module.exports = router;
