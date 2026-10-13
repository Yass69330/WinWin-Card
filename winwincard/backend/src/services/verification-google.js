'use strict';

// ════════════════════════════════════════════════════════════════════════════
// VÉRIFICATION UNIQUE DES CARTES GOOGLE (étape 23, décision du 13/10)
//
// Avant l'étape 23, aucun clic sur le bouton Google n'était noté. Un client
// existant qui a une carte Apple (jeton) ET une carte Google perdrait son
// message Google avec la règle D2. On demande donc à Google, UNE fois, pour les
// seules cartes qui ont un jeton Apple et pas encore le signal, si l'objet a un
// utilisateur (`hasUsers`). Oui → même signal que le clic (google_ouvert_le).
//
// - Lancée à la main (admin), jamais d'elle-même. Rejouable : elle ne reprend
//   que les cartes encore sans signal.
// - Étalée : une lecture Google toutes les `pauseMs` (500 ms par défaut), aucune
//   rafale. Jamais entre 07:30 et 09:00 UTC (passage du cron) : refusée à
//   l'intérieur, interrompue si elle y entre.
// - Bilan dans le journal : vérifiées, ont une carte Google, sans carte, erreurs.
// - Tout en mémoire, une seule à la fois (une seule instance). Un redémarrage
//   l'arrête ; la relancer reprend où elle en était.
// ════════════════════════════════════════════════════════════════════════════

const supabase = require('./supabase');

const config = { pauseMs: 500, page: 100 };
let google = { isConfigured: () => require('./google-pass').isConfigured(), lireObjet: s => require('./google-pass').lireObjet(s) };
let maintenant = () => new Date();
const etat = { enCours: false, debut: null, fin: null, bilan: null };

// 07:30 ≤ heure UTC < 09:00
function dansFenetreCron(d) {
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return m >= 7 * 60 + 30 && m < 9 * 60;
}
const attendre = ms => new Promise(r => setTimeout(r, ms));

async function boucle(bilan) {
  let curseur = null;
  for (;;) {
    const { data, error } = await supabase.rpc('cartes_google_a_verifier', { p_apres: curseur, p_limite: config.page });
    if (error) { bilan.erreurs++; bilan.arret = `base : ${error.message}`; return; }
    if (!data || data.length === 0) return;
    for (const carte of data) {
      if (dansFenetreCron(maintenant())) { bilan.arret = 'fenêtre du cron (07:30-09:00 UTC) : relancer après 09:00'; return; }
      await attendre(config.pauseMs);
      bilan.verifiees++;
      try {
        const r = await google.lireObjet(carte.serial_number);
        if (r.aDesUtilisateurs) {
          const { error: errMaj } = await supabase.from('passes')
            .update({ google_ouvert_le: maintenant().toISOString() })
            .eq('serial_number', carte.serial_number).is('google_ouvert_le', null);
          if (errMaj) { bilan.erreurs++; continue; }
          bilan.avecCarteGoogle++;
        } else if (r.statut === 200 || r.statut === 404) {
          bilan.sansCarteGoogle++;
        } else {
          bilan.erreurs++;
        }
      } catch {
        bilan.erreurs++;
      }
    }
    curseur = data[data.length - 1].id;
  }
}

// Rend { ok: true } (lancée, en arrière-plan) ou { ok: false, raison }.
function lancer() {
  if (etat.enCours) return { ok: false, raison: 'en_cours' };
  if (!google.isConfigured()) return { ok: false, raison: 'google_non_configure' };
  if (dansFenetreCron(maintenant())) return { ok: false, raison: 'fenetre_cron' };
  const bilan = { verifiees: 0, avecCarteGoogle: 0, sansCarteGoogle: 0, erreurs: 0, arret: null };
  Object.assign(etat, { enCours: true, debut: maintenant().toISOString(), fin: null, bilan });
  console.log('[verif-google] lancée');
  etat.promesse = boucle(bilan)
    .catch(e => { bilan.erreurs++; bilan.arret = e.message; })
    .finally(() => {
      Object.assign(etat, { enCours: false, fin: maintenant().toISOString() });
      console.log(`[verif-google] ${bilan.arret ? 'interrompue (' + bilan.arret + ')' : 'finie'} : ${bilan.verifiees} vérifiée(s), `
        + `${bilan.avecCarteGoogle} ont une carte Google, ${bilan.sansCarteGoogle} sans, ${bilan.erreurs} erreur(s)`);
    });
  return { ok: true };
}

function lireEtat() {
  const { enCours, debut, fin, bilan } = etat;
  return { enCours, debut, fin, bilan };
}

function _pourTests({ google: g, maintenant: m, config: c } = {}) {
  if (g) google = { ...google, ...g };
  if (m) maintenant = m;
  if (c) Object.assign(config, c);
  return etat;
}

module.exports = { lancer, lireEtat, dansFenetreCron, _pourTests };
