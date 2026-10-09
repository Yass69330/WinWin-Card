'use strict';

// ════════════════════════════════════════════════════════════════════════════
// DÉBIT PARTAGÉ DES PUSHES APPLE EN MASSE (étape t37, levier d2)
//
// Chaque push Apple réveille un iPhone, qui revient chercher sa carte : ce sont
// ces retours qui créaient une file dans l'API de données de Supabase pendant
// une campagne (étape 15). Les envois en masse — campagnes ET relances du cron —
// prennent un jeton ici avant chaque push : à eux tous, ils ne dépassent jamais
// le débit. Les deux tournent ensemble ; la file est servie dans l'ordre
// d'arrivée, aucun n'attend que l'autre ait fini.
//
// Pas concernés : les pushes d'un seul événement (scan, bienvenue, ajustement,
// avis), qui suivent l'activité de la caisse ; les messages Google (Google ne
// rappelle pas notre serveur).
//
// Débit : CAMPAGNE_IPHONE_PAR_LOT pushes par CAMPAGNE_LOT_MS (50 par 10 s par
// défaut, décision du 09/10), lissé : au plus DEBIT_RAFALE jetons d'avance (le
// débit d'une seconde par défaut). Sur toute fenêtre de T ms, au plus
// rafale + T × débit pushes partent. Tout en mémoire : aucune requête.
// ════════════════════════════════════════════════════════════════════════════

function creerDebit({ parLot, lotMs, rafale, maintenant = () => Date.now() }) {
  const taux = parLot / lotMs;                         // jetons par ms
  const capacite = Math.max(1, rafale ?? Math.round(taux * 1000));
  let jetons = capacite;
  let dernier = maintenant();
  const file = [];
  let minuteur = null;

  function remplir() {
    const t = maintenant();
    jetons = Math.min(capacite, jetons + (t - dernier) * taux);
    dernier = t;
  }

  function servir() {
    remplir();
    while (file.length > 0 && jetons >= 1) {
      jetons -= 1;
      file.shift()();
    }
    if (file.length > 0 && !minuteur) {
      minuteur = setTimeout(() => { minuteur = null; servir(); }, Math.max(1, Math.ceil((1 - jetons) / taux)));
    }
  }

  // Rend une promesse résolue quand le push peut partir.
  function prendre() {
    return new Promise(resolve => { file.push(resolve); servir(); });
  }

  return { prendre, enAttente: () => file.length, capacite, taux };
}

const debit = creerDebit({
  parLot: Number(process.env.CAMPAGNE_IPHONE_PAR_LOT) || 50,
  lotMs:  Number(process.env.CAMPAGNE_LOT_MS) || 10000,
  rafale: process.env.DEBIT_RAFALE ? Number(process.env.DEBIT_RAFALE) : undefined,
});

module.exports = { prendre: debit.prendre, enAttente: debit.enAttente, creerDebit };
