'use strict';

// ════════════════════════════════════════════════════════════════════════════
// NOTIFICATION « À PROXIMITÉ » SUR IPHONE (f10, migrations 062 et 070)
//
// Règle (pilotage, 27/10, après le test terrain du 22/10) : la carte Apple d'un
// marchand qui a f10 activé (marchands.geo_actif) porte ses lieux (`locations`,
// 10 au plus, chacun avec un texte : prénom + reste à faire) SEULEMENT si son
// dernier passage non annulé date de 7 à 30 jours (carte jamais scannée : depuis
// sa création). Aucune date (relevantDates, créneaux) : sur une carte de fidélité
// (storeCard), iOS décide seul du moment et de la durée d'affichage près du lieu ;
// la présence de l'adresse est notre seul levier.
//
// Mises à jour : la carte est régénérée à chaque téléchargement par l'iPhone
// (après un scan, notamment : l'écart retombe à 0, l'adresse disparaît). Pour
// les cartes sans passage, le cron quotidien (02:00 UTC) ne pousse QUE les cartes
// qui franchissent J+7 ou J+30 (geo_cartes_a_rafraichir, migration 070) : au plus
// 2 mises à jour par carte et par cycle. Silencieuses : seul le message de la
// carte (champ à changeMessage) déclenche une alerte iOS, et il ne change pas.
// Tracées dans notification_envois (source 'geo'). Exige que l'app Cartes ait
// accès à la localisation : hors de notre main.
// ════════════════════════════════════════════════════════════════════════════

const MAX_LIEUX = 10;
const JOUR_MS = 86400e3;
const DEBUT_JOURS = 7, FIN_JOURS = 30;

// ── Contrôle des lieux saisis par l'admin ─────────────────────────────────
// Rend { lieux } (forme normalisée : nom, lat, lng) ou { erreur } (message lisible).
// Une clé « horaires » éventuelle (ancien format) est ignorée.
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
    lieux.push({ nom, lat, lng });
  }
  return { lieux };
}

// ── La fenêtre : dernier passage (sinon création) entre 7 et 30 jours ──────
function dansFenetre(reference, maintenant = new Date()) {
  const t = reference ? new Date(reference).getTime() : NaN;
  if (!Number.isFinite(t)) return false;
  const ecart = maintenant.getTime() - t;
  return ecart >= DEBUT_JOURS * JOUR_MS && ecart < FIN_JOURS * JOUR_MS;
}

// Date de référence d'une carte, lue SEULEMENT pour un marchand f10 (au
// téléchargement de la carte par l'iPhone, jamais au scan) : dernier passage non
// annulé (index scans(client_id, date_scan), migration 064), sinon création.
// Rend la date, ou null si la lecture échoue (la carte part alors sans adresse :
// jamais d'échec de téléchargement à cause de f10).
async function referencePassage(marchand, clientId, creeLe) {
  if (!marchand || marchand.geo_actif !== true || !clientId) return null;
  try {
    const supabase = require('./supabase');
    const { data, error } = await supabase.from('scans').select('date_scan')
      .eq('client_id', clientId).is('annule_le', null).order('date_scan', { ascending: false }).limit(1);
    if (error) { console.error('[geo] dernier passage illisible :', error.message); return null; }
    return (data && data[0] && data[0].date_scan) || creeLe || null;
  } catch (e) {
    console.error('[geo] dernier passage illisible :', e.message);
    return null;
  }
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

// Champs à ajouter au pass.json, ou null (f10 inactif, aucun lieu, hors fenêtre).
// client.geo_reference : date de référence (referencePassage), posée par l'appelant.
function champsPass(marchand, client, maintenant = new Date()) {
  if (!marchand || marchand.geo_actif !== true || !client) return null;
  const lieux = Array.isArray(marchand.geo_lieux) ? marchand.geo_lieux.slice(0, MAX_LIEUX) : [];
  if (!lieux.length) return null;
  if (!dansFenetre(client.geo_reference, maintenant)) return null;
  const texte = texteProximite(client, marchand);
  return { locations: lieux.map(l => ({ latitude: l.lat, longitude: l.lng, relevantText: texte })) };
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

// Cron quotidien (02:00 UTC) : les seules cartes iPhone qui franchissent J+7 ou
// J+30 (geo_cartes_a_rafraichir, migration 070), marquées modifiées puis
// poussées en silence, au débit partagé, tracées (source 'geo'). Ne lève jamais.
async function rafraichirFenetre(maintenant = new Date()) {
  const bilan = { cartes: 0, iphones: 0, erreurs: 0 };
  if (!appleActif()) return { ...bilan, ignore: 'apns_non_configure' };
  const supabase = require('./supabase');
  const debit = require('./debit');
  const registre = require('./notif-registre');
  try {
    const { data, error } = await supabase.rpc('geo_cartes_a_rafraichir', { p_maintenant: maintenant.toISOString() });
    if (error) { bilan.arret = error.message; return bilan; }
    const parMarchand = new Map();
    for (const l of data || []) {
      if (!parMarchand.has(l.marchand_id)) parMarchand.set(l.marchand_id, []);
      parMarchand.get(l.marchand_id).push(l);
    }
    for (const [marchandId, lignes] of parMarchand) {
      for (let i = 0; i < lignes.length; i += config.parLot) {
        const lot = lignes.slice(i, i + config.parLot);
        const serials = [...new Set(lot.map(l => l.serial_number))];
        const { error: errMaj } = await supabase.from('passes').update({ updated_at: new Date().toISOString() })
          .eq('marchand_id', marchandId).in('serial_number', serials);
        if (errMaj) { bilan.arret = errMaj.message; return bilan; }
        bilan.cartes += serials.length;
        const reg = registre.creerLot('geo', marchandId, { long: true });
        for (const l of lot) {
          await debit.prendre();
          let erreur = null;
          try { await envoyer(l.push_token); } catch (e) { erreur = e; bilan.erreurs++; }
          reg.ajouter({ plateforme: 'apple', serialNumber: l.serial_number, pushToken: l.push_token, erreur });
          bilan.iphones++;
        }
        await reg.ecrire();
      }
    }
  } catch (e) {
    bilan.arret = e.message;
  } finally {
    console.log(`[geo] mise à jour quotidienne (fenêtre 7-30 j) : ${bilan.cartes} carte(s), ${bilan.iphones} iPhone, ${bilan.erreurs} erreur(s)${bilan.arret ? `, arrêt : ${bilan.arret}` : ''}`);
  }
  return bilan;
}

function _pourTests({ envoyeur, actif, parLot } = {}) {
  if (envoyeur) envoyer = envoyeur;
  if (actif) appleActif = actif;
  if (parLot) config.parLot = parLot;
}

module.exports = { MAX_LIEUX, validerLieux, dansFenetre, referencePassage, texteProximite, champsPass, rafraichir, rafraichirFenetre, _pourTests };
