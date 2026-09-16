'use strict';

// ════════════════════════════════════════════════════════════════════════════
// REGISTRE DES ILLUSTRATIONS — thème de strip « illustration »
//
// ⚠️ RÈGLE ABSOLUE : UNE CLÉ NE SE RENOMME JAMAIS, NE SE SUPPRIME JAMAIS.
//
// Les clés sont stockées en base (marchands.strip_illustration). Renommer
// « kebab » en « kebab_v2 », ou retirer une illustration du catalogue
// commercial, laisserait des marchands pointant vers une clé absente.
// C'est l'incident de juillet (renommage d'une icône Phosphor) : le repli
// s'était fait en silence sur une autre icône, plausible donc invisible, et
// des passes ont porté le mauvais dessin sans que personne ne le remarque.
//
// Le registre est APPEND-ONLY. Une illustration qu'on ne veut plus proposer
// se retire du sélecteur admin, jamais d'ici.
//
// Trois verrous, pour que l'état « clé morte » soit à la fois improbable et
// visible s'il survient :
//   1. cette règle, écrite ici ;
//   2. validation au PATCH admin — une clé absente du registre est refusée en
//      400, donc l'interface ne peut pas produire l'état (étape 4) ;
//   3. repli VISIBLE au rendu — aucune substitution d'illustration, un
//      console.error, et un bandeau dans l'aperçu admin (étape 3).
//
// Chaque entrée déclare la taille de son espace de dessin. Le consommateur
// s'en sert pour calculer translate/scale : la géométrie reste une donnée,
// jamais un nombre magique dans le générateur.
// ════════════════════════════════════════════════════════════════════════════

const ILLUSTRATIONS = Object.freeze({
  kebab: Object.freeze({ svg: require('./kebab'), w: 200, h: 140, label: 'Kebab' }),
});

// Clé connue du registre ? Utilisé par la validation admin et par le rendu.
function estConnue(cle) {
  return typeof cle === 'string' && Object.prototype.hasOwnProperty.call(ILLUSTRATIONS, cle);
}

// Retourne l'entrée, ou null. NE SUBSTITUE JAMAIS une autre illustration :
// l'appelant doit traiter le null comme un cas visible, pas le masquer.
function obtenir(cle) {
  return estConnue(cle) ? ILLUSTRATIONS[cle] : null;
}

// Pour le sélecteur admin (étape 4).
function listerCles() {
  return Object.keys(ILLUSTRATIONS);
}

module.exports = { ILLUSTRATIONS, estConnue, obtenir, listerCles };
