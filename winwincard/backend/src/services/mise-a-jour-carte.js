'use strict';

// ════════════════════════════════════════════════════════════════════════════
// Mise à jour de la carte du client après un crédit : push Apple (le téléphone
// retélécharge la carte) et objet Google (solde, visuel, message).
//
// Partagée par le comptoir (src/routes/scan.js) et l'API des caisses
// (src/integration/api-v1/ventes.js) : « le crédit par le même chemin que le
// comptoir » (contrat v1). Déplacée telle quelle de scan.js le 21/10 ; les envois
// sont tracés dans notification_envois sous la source « scan » (CLAUDE.md).
// ════════════════════════════════════════════════════════════════════════════

const { lireCanaux } = require('./canal-google');

// `canaux` : la lecture des jetons Apple (lireCanaux), faite une fois par l'appelant.
async function notifierMiseAJourPass(serialNumber, marchandId, canaux = lireCanaux(serialNumber)) {
  const tokens = (await canaux).jetons.map(push_token => ({ push_token }));

  if (tokens.length === 0) return;

  const registre = require('./notif-registre');
  const lot = registre.creerLot('scan', marchandId);

  const { sendPushUpdate } = require('./apns');
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
// message — renvoi d'un scan déjà enregistré (le message s'afficherait deux fois),
// ou import de points d'avant (API migrations : aucun téléphone ne sonne).
// Envoi UNITAIRE : sans condition de jeton Apple (règle D2 réservée aux envois
// groupés depuis la migration 074, incident Pizz'Amore du 07/11). Un porteur qui
// a aussi la carte Google la voit à jour à chaque passage.
async function mettreAJourGoogleWallet(serialNumber, marchandId, storedValue, maxValue, displayMaxValue, scanMessage, imagesTiers, prenom, couleurFond, couleurFondReward, marchand, { message = true } = {}) {
  const { updateLoyaltyObjectPoints, addMessageToLoyaltyObject } = require('./google-pass');
  const registre = require('./notif-registre');
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

module.exports = { notifierMiseAJourPass, mettreAJourGoogleWallet };
