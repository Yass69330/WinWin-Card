'use strict';

// ════════════════════════════════════════════════════════════════════════════
// ARRÊT PROPRE AU REDÉPLOIEMENT (étape 14a de la synthèse, décision du 04/10)
//
// À chaque push, Railway envoie SIGTERM à l'ancien serveur, puis le tue
// RAILWAY_DEPLOYMENT_DRAINING_SECONDS plus tard (défaut 0 ; réglé à 30 avec
// 14a). Avant 14a, rien n'écoutait ce signal (et `npm start` ne le transmettait
// pas) : le serveur mourait net, avec ce qu'il faisait APRÈS avoir répondu à la
// caisse — cartes Apple et Google, registre des envois, crédit de parrainage
// (perdu pour de bon : son ticket est écrit avant le crédit).
//
// Au signal : plus aucun passage du cron n'est lancé ; plus de nouvelle
// connexion ; les requêtes en cours finissent ; les travaux lancés après la
// réponse (suivre()) et un passage du cron en cours sont attendus ; au plus
// LIMITE_MS ; un bilan dans les logs ; sortie 0.
//
// Pendant la vie normale du serveur, seul suivre() tourne : il range une
// promesse dans un Set et l'en retire quand elle se termine. Aucune requête,
// aucune écriture, aucun stockage (condition de Yass sur la décision 3).
//
// Hypothèses (ce qui ferait casser) :
//   - le serveur est démarré par `node` (Dockerfile, CMD) : `npm start` ne
//     transmet pas SIGTERM (mesuré le 03/10), et une « Custom Start Command »
//     remplie dans Railway prime sur le Dockerfile ;
//   - LIMITE_MS (20 s) reste sous le délai de Railway (30 s) : au-delà, Railway
//     tue le serveur, comme avant 14a ;
//   - un envoi lancé après la réponse SANS suivre() n'est pas attendu.
// Limites : un passage du cron plus long que la limite (≈ 80 s à 08:00 UTC) est
// coupé comme avant ; les demandes d'avis en mémoire sont perdues (décision 4 a,
// comptées dans le bilan).
// ════════════════════════════════════════════════════════════════════════════

const LIMITE_MS = 20000;

const enCours = new Set();
let arretDemande = false;
let suivisPendantArret = 0;

// Range un travail lancé sans être attendu (après la réponse, ou par le cron)
// pour qu'un arrêt l'attende. Rend la promesse telle quelle. finally() et non
// then(f, f) : un rejet que personne n'attrape le reste, comme avant 14a.
function suivre(promesse) {
  if (!promesse || typeof promesse.then !== 'function') return promesse;
  enCours.add(promesse);
  if (arretDemande) suivisPendantArret++;
  Promise.resolve(promesse).finally(() => { enCours.delete(promesse); });
  return promesse;
}

// options :
//   avantFermeture() : appelée en premier (arrêt du cron) ; une erreur n'arrête rien ;
//   bilan()          : champs ajoutés au bilan (demandes d'avis perdues) ;
//   limiteMs, journal, sortir : remplacés par les tests.
async function arreter(serveur, signal, options = {}) {
  if (arretDemande) return;   // un second signal ne relance rien
  arretDemande = true;
  const { avantFermeture, bilan, limiteMs = LIMITE_MS, journal = console, sortir = code => process.exit(code) } = options;
  const t0 = Date.now();
  journal.log(`[arret] ${signal} reçu : arrêt propre (au plus ${limiteMs / 1000} s)`);

  try { if (avantFermeture) avantFermeture(); } catch (e) { journal.error('[arret] avant fermeture :', e.message); }

  // Plus de nouvelle connexion ; le rappel arrive quand toutes sont fermées.
  // Une connexion gardée ouverte (keep-alive) n'est fermée par Node qu'au repos :
  // on la ferme dès qu'elle y revient, sans attendre son délai de 5 s.
  const ferme = new Promise(resolve => serveur.close(() => resolve()));
  const repos = setInterval(() => serveur.closeIdleConnections(), 250);
  const auDepart = enCours.size;

  const fini = (async () => {
    await ferme;
    while (enCours.size > 0) await Promise.allSettled([...enCours]);
    return 'fini';
  })();
  let minuteur;
  const limite = new Promise(resolve => { minuteur = setTimeout(resolve, limiteMs, 'limite'); });
  const issue = await Promise.race([fini, limite]);
  clearInterval(repos);
  clearTimeout(minuteur);

  const extra = (() => { try { return bilan ? bilan() : {}; } catch { return {}; } })();
  const details = Object.entries(extra).map(([k, v]) => `, ${k} : ${v}`).join('');
  const attendus = auDepart + suivisPendantArret;
  if (issue === 'fini') {
    journal.log(`[arret] fini en ${Date.now() - t0} ms : ${attendus} tâche(s) attendue(s)${details}`);
  } else {
    journal.error(`[arret] limite de ${limiteMs / 1000} s atteinte : ${enCours.size} tâche(s) non terminée(s) sur ${attendus}${details}`);
  }
  sortir(0);
}

// Branche SIGTERM (Railway) et SIGINT (Ctrl-C en local) sur arreter().
function brancher(serveur, options) {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      arreter(serveur, signal, options).catch(e => {
        console.error('[arret] échec :', e.message);
        process.exit(0);
      });
    });
  }
}

module.exports = { suivre, arreter, brancher, LIMITE_MS };
