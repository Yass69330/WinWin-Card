'use strict';

// ════════════════════════════════════════════════════════════════════════════
// RÈGLE D2 : À QUI ENVOYER CÔTÉ GOOGLE (étape 23, décision de Yass du 29/09)
//
// Le lien Google Wallet et l'objet Google existent pour CHAQUE client depuis
// l'inscription : l'existence de l'objet ne dit pas que le client a la carte.
// Un client est servi côté Google s'il a OUVERT le lien Google
// (passes.google_ouvert_le : route GET /api/passes/:serial/google, ou
// vérification unique) OU s'il n'a aucune carte Apple installée (aucun jeton).
// Google Wallet n'existe pas sur iPhone : un jeton Apple sans clic Google veut
// dire « carte sur iPhone, rien à envoyer à Google ». Un client qui a les deux
// cartes reçoit les deux.
//
// Coût : AUCUNE requête de plus. Les surfaces lisaient déjà les jetons Apple
// pour le push iPhone ; la même lecture rapporte le signal Google (jointure sur
// passes par la clé étrangère device_tokens.pass_id).
// Même règle dans la base pour le cron et les campagnes (migration 057).
// ════════════════════════════════════════════════════════════════════════════

const supabase = require('./supabase');

// { jetons: [push_token…], googleOuvert: bool, erreur? }. Ne rejette jamais.
async function lireCanaux(serialNumber) {
  try {
    const { data, error } = await supabase
      .from('device_tokens')
      .select('push_token, passes(google_ouvert_le)')
      .eq('serial_number', serialNumber);
    if (error) return { jetons: [], googleOuvert: false, erreur: error };
    const lignes = data || [];
    return {
      jetons: lignes.map(l => l.push_token),
      googleOuvert: lignes.some(l => l.passes && l.passes.google_ouvert_le),
    };
  } catch (e) {
    return { jetons: [], googleOuvert: false, erreur: e };
  }
}

// Lecture en échec : on envoie à Google, comme avant l'étape 23 (jamais de perte).
function servirGoogle(canaux) {
  if (!canaux || canaux.erreur) return true;
  return canaux.jetons.length === 0 || canaux.googleOuvert;
}

module.exports = { lireCanaux, servirGoogle };
