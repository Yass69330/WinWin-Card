'use strict';

// ════════════════════════════════════════════════════════════════════════════
// NOTIFICATION « À PROXIMITÉ » SUR IPHONE (f10, migration 062)
//
// La carte Apple d'un marchand qui a f10 activé (marchands.geo_actif) porte :
//   - ses lieux (`locations`, 10 au plus), chacun avec un texte (prénom + solde,
//     façon boost ; le produit favori viendra avec f06) ;
//   - des créneaux (`relevantDates`, iOS 18) : les horaires de tous les lieux,
//     réunis (décision du 14/10 : une boutique fermée peut apparaître pendant
//     qu'une autre est ouverte, marge d'erreur acceptée), sur HORIZON_JOURS.
// Près d'un lieu, pendant un créneau, iOS montre la carte sur l'écran verrouillé.
// Test réussi sur l'iPhone de Yass le 14/10. Exige que l'app Cartes ait accès à
// la localisation : hors de notre main.
//
// Horaires saisis par Yass EN UTC (décision du 14/10 : pas de fuseau stocké).
//
// Les créneaux sont des DATES : une carte qui n'est jamais mise à jour finit par
// ne plus en avoir. D'où la mise à jour silencieuse : à l'activation, à chaque
// changement de lieux ou d'horaires, et une fois par mois (cron, le 1er à
// 02:00 UTC), au débit partagé (t37), tracée dans notification_envois (source
// 'geo'). Aucun message n'est affiché au client.
// ════════════════════════════════════════════════════════════════════════════

const HORIZON_JOURS = 60;
const MAX_LIEUX = 10;
const PLAGE = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]|24):([0-5]\d)$/;

// ── Contrôle des lieux saisis par l'admin ─────────────────────────────────
// Rend { lieux } (forme normalisée) ou { erreur } (message lisible).
function validerLieux(brut) {
  if (!Array.isArray(brut)) return { erreur: 'lieux : une liste est attendue' };
  if (brut.length > MAX_LIEUX) return { erreur: `${MAX_LIEUX} lieux au plus (limite d'Apple)` };
  const lieux = [];
  for (const [i, l] of brut.entries()) {
    const n = `lieu ${i + 1}`;
    if (!l || typeof l !== 'object') return { erreur: `${n} : illisible` };
    const lat = Number(l.lat), lng = Number(l.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { erreur: `${n} : latitude invalide` };
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { erreur: `${n} : longitude invalide` };
    const nom = typeof l.nom === 'string' ? l.nom.trim().slice(0, 60) : '';
    const horaires = {};
    for (const [jour, plages] of Object.entries(l.horaires || {})) {
      if (!/^[1-7]$/.test(jour)) return { erreur: `${n} : jour inconnu (${jour})` };
      if (!Array.isArray(plages)) return { erreur: `${n} : horaires du jour ${jour} illisibles` };
      const propres = [];
      for (const p of plages) {
        const m = typeof p === 'string' ? p.trim().match(PLAGE) : null;
        if (!m) return { erreur: `${n} : plage « ${p} » invalide (format HH:MM-HH:MM, en UTC)` };
        const debut = +m[1] * 60 + +m[2], fin = +m[3] * 60 + +m[4];
        if (fin > 24 * 60 || fin <= debut) return { erreur: `${n} : plage « ${p} » invalide (la fin doit suivre le début, dans la même journée UTC)` };
        propres.push(p.trim());
      }
      if (propres.length) horaires[jour] = propres;
    }
    lieux.push({ nom, lat, lng, horaires });
  }
  return { lieux };
}

// ── Créneaux : union des horaires de tous les lieux, jour UTC par jour UTC ──
const enMinutes = p => { const m = p.match(PLAGE); return [+m[1] * 60 + +m[2], +m[3] * 60 + +m[4]]; };
const iso = d => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

function creneaux(lieux, maintenant = new Date(), jours = HORIZON_JOURS) {
  const parJour = {};   // "1".."7" → [[debut, fin], …] fusionnés
  for (const l of lieux || []) {
    for (const [jour, plages] of Object.entries(l.horaires || {})) {
      parJour[jour] = (parJour[jour] || []).concat(plages.map(enMinutes));
    }
  }
  for (const jour of Object.keys(parJour)) {
    const tri = parJour[jour].sort((a, b) => a[0] - b[0]);
    const fusion = [];
    for (const [d, f] of tri) {
      const der = fusion[fusion.length - 1];
      if (der && d <= der[1]) der[1] = Math.max(der[1], f); else fusion.push([d, f]);
    }
    parJour[jour] = fusion;
  }
  const minuit = Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate());
  const resultat = [];
  for (let k = 0; k < jours; k++) {
    const jourMs = minuit + k * 86400e3;
    const isoJour = String(((new Date(jourMs).getUTCDay() + 6) % 7) + 1);   // 1 = lundi … 7 = dimanche
    for (const [d, f] of parJour[isoJour] || []) {
      const fin = jourMs + Math.min(f * 60e3, 86400e3 - 1000);   // 24:00 → 23:59:59 (un créneau = un jour au plus)
      if (fin <= maintenant.getTime()) continue;                  // créneau déjà passé
      resultat.push({ startDate: iso(new Date(jourMs + d * 60e3)), endDate: iso(new Date(fin)) });
    }
  }
  return resultat;
}

// ── Texte affiché sur l'écran verrouillé (repli décidé par Yass) ───────────
function texteProximite(client, marchand) {
  const { reste } = require('./smart-messages');
  const fr = marchand.langue === 'fr';
  const restant = (marchand.max_value || 10) - (client.stored_value || 0);
  const unite = marchand.type_programme === 'points' ? 'points' : 'tampons';
  if (restant > 0) {
    return fr ? `${client.prenom}, plus que ${reste(restant, unite, 'fr')} pour ta récompense chez ${marchand.nom} !`
              : `${client.prenom}, only ${reste(restant, unite, 'en')} left for your reward at ${marchand.nom}!`;
  }
  return fr ? `${client.prenom}, ta récompense t'attend chez ${marchand.nom} !`
            : `${client.prenom}, your reward is waiting at ${marchand.nom}!`;
}

// Champs à ajouter au pass.json, ou null (f10 inactif, aucun lieu, aucun créneau).
function champsPass(marchand, client, maintenant = new Date()) {
  if (!marchand || marchand.geo_actif !== true) return null;
  const lieux = Array.isArray(marchand.geo_lieux) ? marchand.geo_lieux.slice(0, MAX_LIEUX) : [];
  if (!lieux.length) return null;
  const dates = creneaux(lieux, maintenant);
  if (!dates.length) return null;   // aucun horaire : rien, plutôt qu'une carte affichée à toute heure
  const texte = texteProximite(client, marchand);
  return {
    locations: lieux.map(l => ({ latitude: l.lat, longitude: l.lng, relevantText: texte })),
    relevantDates: dates,
  };
}

// ── Mise à jour silencieuse des cartes iPhone d'un marchand ───────────────
// Par lots : la carte du lot est marquée modifiée (passes.updated_at, sinon
// l'iPhone reçoit 304 et garde l'ancienne), puis un push silencieux par iPhone,
// au débit partagé. Une seule mise à jour à la fois par marchand. Ne lève jamais.
const config = { parLot: 30 };
let envoyer = jeton => require('./apns').sendPushUpdate(jeton);
let appleActif = () => require('./apns').isApnsConfigured();
const enCours = new Set();

async function rafraichir(marchandId, raison = 'manuel') {
  if (enCours.has(marchandId)) return { ignore: 'en_cours' };
  if (!appleActif()) return { ignore: 'apns_non_configure' };
  enCours.add(marchandId);
  const supabase = require('./supabase');
  const debit = require('./debit');
  const registre = require('./notif-registre');
  const bilan = { iphones: 0, erreurs: 0 };
  try {
    let curseur = null;
    for (;;) {
      let q = supabase.from('device_tokens').select('id, push_token, serial_number')
        .eq('marchand_id', marchandId).order('id', { ascending: true }).limit(config.parLot);
      if (curseur) q = q.gt('id', curseur);
      const { data: lot, error } = await q;
      if (error) { bilan.arret = error.message; break; }
      if (!lot || !lot.length) break;
      const serials = [...new Set(lot.map(l => l.serial_number))];
      const { error: errMaj } = await supabase.from('passes').update({ updated_at: new Date().toISOString() })
        .eq('marchand_id', marchandId).in('serial_number', serials);
      if (errMaj) { bilan.arret = errMaj.message; break; }
      const reg = registre.creerLot('geo', marchandId, { long: true });
      for (const l of lot) {
        await debit.prendre();
        let erreur = null;
        try { await envoyer(l.push_token); } catch (e) { erreur = e; bilan.erreurs++; }
        reg.ajouter({ plateforme: 'apple', serialNumber: l.serial_number, pushToken: l.push_token, erreur });
        bilan.iphones++;
      }
      await reg.ecrire();
      curseur = lot[lot.length - 1].id;
    }
  } catch (e) {
    bilan.arret = e.message;
  } finally {
    enCours.delete(marchandId);
  }
  console.log(`[geo] mise à jour (${raison}) marchand ${marchandId} : ${bilan.iphones} iPhone, ${bilan.erreurs} erreur(s)${bilan.arret ? `, arrêt : ${bilan.arret}` : ''}`);
  return bilan;
}

// Le 1er du mois (cron) : tous les marchands qui ont f10 activé, l'un après l'autre.
async function rafraichirTous() {
  const supabase = require('./supabase');
  const { data, error } = await supabase.from('marchands').select('id').eq('geo_actif', true);
  if (error) { console.error('[geo] lecture des marchands impossible :', error.message); return; }
  for (const m of data || []) await rafraichir(m.id, 'mensuelle');
}

function _pourTests({ envoyeur, actif, parLot } = {}) {
  if (envoyeur) envoyer = envoyeur;
  if (actif) appleActif = actif;
  if (parLot) config.parLot = parLot;
}

module.exports = { HORIZON_JOURS, MAX_LIEUX, validerLieux, creneaux, texteProximite, champsPass, rafraichir, rafraichirTous, _pourTests };
