'use strict';

// ════════════════════════════════════════════════════════════════════════════
// RÈGLES DE FORFAIT — offre commerciale du 30/09/2026 (décisions de Yass)
//
// Seul endroit où ces règles s'écrivent côté serveur. Les pages suivent le
// serveur : la landing lit `landing_premium_actif` (GET /merchants/:slug/public),
// le dashboard lit `coordonnees` (GET /merchants/me) et n'affiche que les
// coordonnées que l'API lui envoie.
//
//   Landing premium  : case cochée dans l'admin, en Pro ou Pro+. Jamais en Basic,
//                      même si la case est restée cochée en base.
//   Coordonnées      : email, téléphone, anniversaire — récoltées à l'inscription
//                      si la landing premium est active ; visibles sur la fiche
//                      et exportables en CSV pour un Pro+, ou si la landing
//                      premium est active.
//   Notifications    : quota manuel par mois calendaire, Basic 0 / Pro 5 /
//                      Pro+ 20 (avant : 0 / 10 / 50). Le quota réglé à la main
//                      dans l'admin prime toujours, 0 compris.
//
// Miroirs hors de ce fichier, à tenir alignés :
//   - workers/cron.js, anniversaire : filtre SQL forfait ∈ (pro, pro_plus) ET
//     landing_premium = true — même règle que landingPremiumActive ;
//   - public/admin/index.html : section « Landing page » visible en Pro et Pro+.
// Non traités ici (inchangés) : fond photo des cartes, Pro+ seulement
// (strip-cache.js) ; parrainage, ouvert à tous les forfaits.
// ════════════════════════════════════════════════════════════════════════════

const FORFAITS_LANDING_PREMIUM = ['pro', 'pro_plus'];

const NOTIF_LIMITS = { basic: 0, pro: 5, pro_plus: 20 };

// `landing_premium` est nullable en production (migration 025) : seul `true` compte.
function landingPremiumActive(m) {
  return !!m && FORFAITS_LANDING_PREMIUM.includes(m.forfait) && m.landing_premium === true;
}

function droitCoordonnees(m) {
  return !!m && (m.forfait === 'pro_plus' || landingPremiumActive(m));
}

// Forfait illisible → quota du Pro.
function limiteMensuelle(m) {
  return m?.notification_quota_override ?? NOTIF_LIMITS[m?.forfait] ?? NOTIF_LIMITS.pro;
}

module.exports = {
  FORFAITS_LANDING_PREMIUM, NOTIF_LIMITS,
  landingPremiumActive, droitCoordonnees, limiteMensuelle,
};
