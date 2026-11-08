// ════════════════════════════════════════════════════════════════════════════
// Réglages Hubrise (H1, docs/hubrise/02-h1-connexion.md §2, §7)
//
// Tout vient des variables d'environnement (Railway), lues à chaque appel :
//   HUBRISE_CLIENT_ID, HUBRISE_CLIENT_SECRET  l'app WinWin chez Hubrise
//   HUBRISE_JETON_CLE                         32 octets en base64 : chiffre les jetons
//   HUBRISE_LIEN_SECRET                       32 caractères au moins : signe les liens
//   HUBRISE_REDIRECT_URI (facultatif)         défaut <API_BASE_URL>/integrations/hubrise/retour
//   HUBRISE_DIAGNOSTIC_LOCATIONS (facultatif) locations relevées (H1b), séparées par des virgules
//   HUBRISE_MANAGER_URL, HUBRISE_API_URL      (facultatif) adresses Hubrise ; le filet
//                                             les fait pointer sur un faux serveur
// Réglage absent ou invalide : les routes Hubrise répondent « non configuré » ;
// le reste de WinWin n'en sait rien.
// ════════════════════════════════════════════════════════════════════════════
'use strict';

const SCOPE = 'location[orders.read,customer_list.read]';

function cleJeton() {
  const b = Buffer.from(process.env.HUBRISE_JETON_CLE || '', 'base64');
  return b.length === 32 ? b : null;
}

// → { ok: true } | { ok: false, manquants: [noms] } (jamais une valeur)
function etat() {
  const manquants = [];
  if (!process.env.HUBRISE_CLIENT_ID) manquants.push('HUBRISE_CLIENT_ID');
  if (!process.env.HUBRISE_CLIENT_SECRET) manquants.push('HUBRISE_CLIENT_SECRET');
  if (!cleJeton()) manquants.push('HUBRISE_JETON_CLE');
  if ((process.env.HUBRISE_LIEN_SECRET || '').length < 32) manquants.push('HUBRISE_LIEN_SECRET');
  return manquants.length ? { ok: false, manquants } : { ok: true };
}

const base = () => process.env.API_BASE_URL || 'https://app.winwin-card.com';
const redirectUri = () => process.env.HUBRISE_REDIRECT_URI || `${base()}/integrations/hubrise/retour`;
const managerUrl = () => (process.env.HUBRISE_MANAGER_URL || 'https://manager.hubrise.com').replace(/\/+$/, '');
const apiUrl = () => (process.env.HUBRISE_API_URL || 'https://api.hubrise.com/v1').replace(/\/+$/, '');

const callbackUrl = () => `${base()}/integrations/hubrise/callback`;

// Locations dont la structure des commandes est relevée dans les journaux (H1b,
// diagnostic jetable : chemins, types, longueurs, forme de carte — jamais une
// valeur). Vide = aucune.
const locationsDiagnostic = () => new Set(String(process.env.HUBRISE_DIAGNOSTIC_LOCATIONS || '')
  .split(',').map(x => x.trim()).filter(Boolean));

module.exports = { SCOPE, etat, cleJeton, base, redirectUri, managerUrl, apiUrl, callbackUrl, locationsDiagnostic };
