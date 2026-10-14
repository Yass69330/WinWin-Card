'use strict';

// ════════════════════════════════════════════════════════════════════════════
// MESSAGES DES SMART NOTIFICATIONS RÉGLABLES (f15, f18)
//
// Une seule définition, partagée par le cron (src/workers/cron.js), le bloc du
// dashboard et la fiche admin (src/routes/merchants.js, src/routes/admin.js) :
//   - pas de lien dans un message envoyé à tous les clients ;
//   - message du boost : mot réservé {reste} OBLIGATOIRE, remplacé par le nombre
//     restant avec son unité, singulier ou pluriel (« 1 tampon », « 2 points ») ;
//     {prenom} et {nom} en option, comme pour la relance d'inactivité.
// ════════════════════════════════════════════════════════════════════════════

const LIEN = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|fr|net|org|io|co|me|app|shop|link|ly|info|biz|be|ch|ae|uk|de|es|it)\b)/i;
const MAX_MESSAGE = 150;

// Texte WinWin du boost (f18 : « le texte actuel devient le texte par défaut »).
const MODELE_BOOST = {
  fr: 'Salut {prenom} ! Plus que {reste} pour débloquer ta récompense chez {nom}. Passe nous voir ! 🎁',
  en: 'Hi {prenom}! Only {reste} more to unlock your reward at {nom}. Come visit us! 🎁',
};
function modeleBoostWinwin(langue) { return MODELE_BOOST[langue] || MODELE_BOOST.en; }

// « 1 point », « 2 points », « 1 tampon », « 3 tampons » (en : point / stamp).
function reste(n, unite, langue) {
  const mot = langue === 'fr'
    ? (unite === 'points' ? 'point' : 'tampon')
    : (unite === 'points' ? 'point' : 'stamp');
  return `${n} ${mot}${n > 1 ? 's' : ''}`;
}

// Message prêt pour reserver_relances : {reste} et {nom} remplacés, {prenom}
// laissé (la base le remplace client par client).
function texteBoost(modele, restant, unite, langue, nom) {
  return modele.split('{reste}').join(reste(restant, unite, langue)).split('{nom}').join(nom || '');
}

// Contrôle d'un message saisi : { texte } ou { erreur }.
function validerMessage(brut, { reserve = null } = {}) {
  const t = typeof brut === 'string' ? brut.trim() : '';
  if (!t) return { erreur: 'message_vide' };
  if (t.length > MAX_MESSAGE) return { erreur: 'message_trop_long' };
  if (LIEN.test(t)) return { erreur: 'message_avec_lien' };
  if (reserve && !t.includes(reserve)) return { erreur: 'message_sans_reste' };
  return { texte: t };
}

module.exports = { LIEN, MAX_MESSAGE, modeleBoostWinwin, reste, texteBoost, validerMessage };
