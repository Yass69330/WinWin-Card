// ════════════════════════════════════════════════════════════════════════════
// Appels sortants vers Hubrise (H1a : échange du code, révocation)
//
// Adresses (pilotage, 06/11) :
//   POST <manager>/oauth2/v1/token   Basic base64(client_id:client_secret), corps code=…
//   POST <manager>/oauth2/v1/revoke  Basic, corps token=…
//   POST   <api>/callback   X-Access-Token ; { url, events: { order: [create, update] } } (H1b)
//   DELETE <api>/callback   X-Access-Token (H1b) — un seul callback par connexion
// Délai court (5 s). Rien de ce qui passe ici (code, jeton, réponse) n'est écrit
// dans les journaux : seulement le statut HTTP ou « injoignable ».
// ════════════════════════════════════════════════════════════════════════════
'use strict';

const { managerUrl, apiUrl } = require('./config');

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

// Appel à l'API d'une location (jeton de la connexion). → { statut, corps } ;
// statut 0 = injoignable. Jamais d'exception.
async function api(methode, chemin, jeton, corps) {
  try {
    const r = await fetch(apiUrl() + chemin, {
      method: methode,
      headers: { 'X-Access-Token': jeton, Accept: 'application/json', ...(corps ? { 'Content-Type': 'application/json' } : {}) },
      body: corps ? JSON.stringify(corps) : undefined,
      signal: AbortSignal.timeout(DELAI_MS),
    });
    let c = null;
    try { c = await r.json(); } catch { /* corps vide ou non JSON */ }
    return { statut: r.status, corps: c };
  } catch {
    return { statut: 0, corps: null };
  }
}

// Abonne la location aux commandes (remplace le callback existant).
// → { ok: true, callbackId } | { ok: false, statut } (401 = jeton mort)
async function abonner(jeton, url) {
  const { statut, corps } = await api('POST', '/callback', jeton, { url, events: { order: ['create', 'update'] } });
  if (statut < 200 || statut >= 300) return { ok: false, statut };
  const id = corps && (corps.id || corps.callback_id);
  return { ok: true, callbackId: id ? String(id).slice(0, 64) : 'abonne' };
}

// Retire l'abonnement, au mieux. → true si Hubrise a accepté.
async function desabonner(jeton) {
  const { statut } = await api('DELETE', '/callback', jeton);
  return statut >= 200 && statut < 300;
}

module.exports = { echangerCode, revoquer, abonner, desabonner };
