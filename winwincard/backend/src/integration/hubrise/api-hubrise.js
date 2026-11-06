// ════════════════════════════════════════════════════════════════════════════
// Appels sortants vers Hubrise (H1a : échange du code, révocation)
//
// Adresses (pilotage, 06/11) :
//   POST <manager>/oauth2/v1/token   Basic base64(client_id:client_secret), corps code=…
//   POST <manager>/oauth2/v1/revoke  Basic, corps token=…
// Délai court (5 s). Rien de ce qui passe ici (code, jeton, réponse) n'est écrit
// dans les journaux : seulement le statut HTTP ou « injoignable ».
// H1b ajoutera l'abonnement aux commandes (POST/GET/DELETE <api>/callback).
// ════════════════════════════════════════════════════════════════════════════
'use strict';

const { managerUrl } = require('./config');

const DELAI_MS = 5000;
const basic = () => 'Basic ' + Buffer.from(`${process.env.HUBRISE_CLIENT_ID}:${process.env.HUBRISE_CLIENT_SECRET}`).toString('base64');

async function poster(chemin, champs) {
  try {
    const r = await fetch(managerUrl() + chemin, {
      method: 'POST',
      headers: { Authorization: basic(), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(champs).toString(),
      signal: AbortSignal.timeout(DELAI_MS),
    });
    let corps = null;
    try { corps = await r.json(); } catch { /* corps vide ou non JSON */ }
    return { statut: r.status, corps };
  } catch {
    return { statut: 0, corps: null };
  }
}

// → { ok: true, donnees } | { ok: false, erreur: 'hubrise_injoignable' | 'hubrise_refus_<statut>' | 'reponse_incomplete' }
async function echangerCode(code) {
  const { statut, corps } = await poster('/oauth2/v1/token', { code });
  if (statut === 0) return { ok: false, erreur: 'hubrise_injoignable' };
  if (statut < 200 || statut >= 300) return { ok: false, erreur: `hubrise_refus_${statut}` };
  if (!corps || typeof corps.access_token !== 'string' || !corps.access_token) return { ok: false, erreur: 'reponse_incomplete' };
  return { ok: true, donnees: corps };
}

// Au mieux : true si Hubrise a accepté, false sinon (jamais d'exception).
async function revoquer(jeton) {
  const { statut } = await poster('/oauth2/v1/revoke', { token: jeton });
  return statut >= 200 && statut < 300;
}

module.exports = { echangerCode, revoquer };
