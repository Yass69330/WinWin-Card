'use strict';

// ════════════════════════════════════════════════════════════════════════════
// CAMPAGNES ENVOYÉES PAR LOTS (étape t37, levier a ; migration 054)
//
// Le clic du marchand crée la campagne (lancer_campagne : quota compté, une
// seule en cours par marchand) et reçoit sa réponse tout de suite. Ce module
// envoie ensuite, en arrière-plan, sur deux voies qui avancent ensemble :
//   - Apple : lot de CAMPAGNE_IPHONE_PAR_LOT appareils (device_tokens, par id
//     croissant) ; message posé sur les cartes DU LOT ; un jeton du débit
//     partagé (debit.js) avant chaque push ; puis registre et avancement.
//     Ordre : envoi PUIS curseur. Après un arrêt brutal, au plus un lot reçoit
//     un second push silencieux, sans effet visible (la carte n'a pas changé).
//   - Google : lot de CAMPAGNE_GOOGLE_PAR_LOT cartes (passes avec lien Google,
//     par id croissant), au plus un lot par CAMPAGNE_LOT_MS, au plus
//     GOOGLE_SIMULTANES appels à la fois. Ordre : curseur PUIS envoi. Après un
//     arrêt brutal, au pire un lot perd son message ; jamais de doublon.
// Aucun plafond de destinataires : le parcours par curseur lit tout, lot par lot.
//
// Requêtes : par lot Apple, 1 lecture + 1 mise à jour des cartes + 1 avancement
// + 1 registre ; par lot Google, 1 lecture + 1 avancement + 1 registre. Rien
// entre deux campagnes : au démarrage du serveur, UNE reprise différée
// (REPRISE_DELAI_MS), pour laisser l'ancien serveur finir son lot pendant un
// redéploiement (Railway les fait tourner ensemble quelques secondes).
//
// Hypothèses : une campagne n'avance que sur le serveur qui l'a lancée ou
// reprise (reprendre_campagnes la « prend » de façon atomique) ; une campagne
// sans avancement depuis INACTIF_MS est orpheline.
// Panne de base : après 6 essais de suite (≈ 6 lots), la campagne passe en
// « interrompue » (ligne d'alerte « [campagne] INTERROMPUE » dans le journal)
// et reprend SEULE au curseur : nouvelles tentatives après 1, 2, 5, 10, 20
// puis toutes les 30 min, tant qu'elle n'est pas finie. Une requête par
// tentative ; aucune minuterie quand il n'y a rien à reprendre. Pendant
// l'interruption, le verrou tient : un nouveau clic reçoit 409.
// ════════════════════════════════════════════════════════════════════════════

const os = require('os');
const supabase = require('./supabase').clientLong;
const registre = require('./notif-registre');
const debit = require('./debit');
const { suivre } = require('./arret');

const config = {
  iphoneParLot:     Number(process.env.CAMPAGNE_IPHONE_PAR_LOT) || 50,
  googleParLot:     Number(process.env.CAMPAGNE_GOOGLE_PAR_LOT) || 50,
  lotMs:            Number(process.env.CAMPAGNE_LOT_MS) || 10000,
  googleSimultanes: Number(process.env.CAMPAGNE_GOOGLE_SIMULTANES) || 5,
  essais:           6,
  repriseDelaiMs:   Number(process.env.CAMPAGNE_REPRISE_DELAI_MS) || 60000,
  inactifMs:        Number(process.env.CAMPAGNE_INACTIF_MS) || 45000,
  // Attentes avant chaque nouvelle tentative d'une campagne interrompue ; la
  // dernière se répète.
  relancesMs:       [60e3, 120e3, 300e3, 600e3, 1200e3, 1800e3],
};

// Envois réels ; remplacés par les tests (_pourTests).
let envoyeurs = {
  appleActif:  () => require('./apns').isApnsConfigured(),
  apple:       token => require('./apns').sendPushUpdate(token),
  googleActif: () => require('./google-pass').isConfigured(),
  google:      (serial, message) => require('./google-pass').addMessageToLoyaltyObject(serial, null, message),
};

const INSTANCE = process.env.RAILWAY_REPLICA_ID || os.hostname();
const actives = new Map();      // id → promesse
const relances = new Map();     // id → { n, minuteur } des campagnes interrompues
let arretDemande = false;
const reveils = new Set();

function attendre(ms) {
  if (arretDemande) return Promise.resolve();
  return new Promise(resolve => {
    const fin = () => { clearTimeout(t); reveils.delete(fin); resolve(); };
    const t = setTimeout(fin, ms);
    reveils.add(fin);
  });
}

async function avancer(c, champs) {
  const { data, error } = await supabase.rpc('avancer_campagne', {
    p_campagne_id:    c.id,
    p_curseur_apple:  champs.curseurApple ?? null,
    p_curseur_google: champs.curseurGoogle ?? null,
    p_apple_fini:     !!champs.appleFini,
    p_google_fini:    !!champs.googleFini,
    p_envoyes_apple:  champs.envoyesApple || 0,
    p_total_apple:    champs.totalApple || 0,
    p_envoyes_google: champs.envoyesGoogle || 0,
    p_total_google:   champs.totalGoogle || 0,
  });
  if (error) throw new Error(`avancement : ${error.message}`);
  return data;
}

// Répète une étape de base jusqu'à `essais` fois, un lot d'attente entre deux.
async function avecEssais(c, nom, fn) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      console.error(`[campagne] ${c.id} ${nom}, essai ${i}/${config.essais} :`, e.message);
      if (i >= config.essais || arretDemande || c.stop) throw e;
      await attendre(config.lotMs);
    }
  }
}

async function voieApple(c) {
  if (c.apple_fini) return;
  if (!envoyeurs.appleActif()) { await avancer(c, { appleFini: true }); return; }
  let curseur = c.curseur_apple || null;

  if (!curseur) {
    // Comme avant t37 : le message de la campagne est aussi posé sur le marchand.
    const { error } = await supabase.from('marchands')
      .update({ notification_titre: null, notification_message: c.message }).eq('id', c.marchand_id);
    if (error) console.error(`[campagne] ${c.id} marchand :`, error.message);
  }

  while (!arretDemande && !c.stop) {
    const lot = await avecEssais(c, 'lecture Apple', async () => {
      let q = supabase.from('device_tokens').select('id, push_token, serial_number')
        .eq('marchand_id', c.marchand_id).order('id', { ascending: true }).limit(config.iphoneParLot);
      if (curseur) q = q.gt('id', curseur);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data || [];
    });
    if (lot.length === 0) { await avancer(c, { appleFini: true }); return; }

    // Le message sur les cartes du lot, avant les pushes : l'iPhone réveillé
    // doit trouver une carte modifiée (sinon 304 et rien ne s'affiche).
    const serials = [...new Set(lot.map(l => l.serial_number))];
    await avecEssais(c, 'cartes', async () => {
      const { error } = await supabase.from('passes').update({ notification_message: c.message })
        .eq('marchand_id', c.marchand_id).in('serial_number', serials);
      if (error) throw new Error(error.message);
    });

    const registreLot = registre.creerLot('manuel', c.marchand_id, { long: true });
    const envois = [];
    for (const l of lot) {
      await debit.prendre();
      envois.push(Promise.resolve().then(() => envoyeurs.apple(l.push_token)).then(() => null, e => e)
        .then(erreur => {
          registreLot.ajouter({ plateforme: 'apple', serialNumber: l.serial_number, pushToken: l.push_token, erreur });
          if (erreur) console.error(`[campagne] APNs (…${String(l.push_token).slice(-8)}) :`, erreur.message);
          return !erreur;
        }));
    }
    const resultats = await Promise.all(envois);
    await registreLot.ecrire();   // ne rejette jamais
    curseur = lot[lot.length - 1].id;
    await avecEssais(c, 'avancement Apple', () => avancer(c, {
      curseurApple: curseur, envoyesApple: resultats.filter(Boolean).length, totalApple: lot.length,
    }));
  }
}

async function voieGoogle(c) {
  if (c.google_fini) return;
  if (!envoyeurs.googleActif()) { await avancer(c, { googleFini: true }); return; }
  let curseur = c.curseur_google || null;

  while (!arretDemande && !c.stop) {
    const debutLot = Date.now();
    const lot = await avecEssais(c, 'lecture Google', async () => {
      let q = supabase.from('passes').select('id, serial_number')
        .eq('marchand_id', c.marchand_id).not('google_pass_url', 'is', null)
        .order('id', { ascending: true }).limit(config.googleParLot);
      if (curseur) q = q.gt('id', curseur);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data || [];
    });
    if (lot.length === 0) { await avancer(c, { googleFini: true }); return; }

    // Curseur AVANT l'envoi : jamais de message Google en double.
    curseur = lot[lot.length - 1].id;
    await avecEssais(c, 'avancement Google', () => avancer(c, { curseurGoogle: curseur }));

    const registreLot = registre.creerLot('manuel', c.marchand_id, { long: true });
    let ok = 0;
    const file = [...lot];
    await Promise.all(Array.from({ length: Math.min(config.googleSimultanes, file.length) }, async () => {
      while (file.length > 0) {
        const p = file.shift();
        let erreur = null;
        try { await envoyeurs.google(p.serial_number, c.message); ok++; } catch (e) {
          erreur = e;
          console.error(`[campagne] Google (${p.serial_number}) :`, e.message);
        }
        registreLot.ajouter({ plateforme: 'google', serialNumber: p.serial_number, erreur });
      }
    }));
    await registreLot.ecrire();
    await avecEssais(c, 'compteurs Google', () => avancer(c, { envoyesGoogle: ok, totalGoogle: lot.length }));

    const reste = config.lotMs - (Date.now() - debutLot);
    if (reste > 0) await attendre(reste);
  }
}

async function executer(c) {
  // Une voie en panne arrête l'autre (c.stop) : la reprise repart des deux
  // curseurs enregistrés, sans qu'une voie ancienne tourne encore.
  c.stop = false;
  const voies = [voieApple(c), voieGoogle(c)].map(p => p.catch(e => { c.stop = true; throw e; }));
  const issues = await Promise.allSettled(voies);
  const echec = issues.find(r => r.status === 'rejected');
  if (!echec) {
    relances.delete(c.id);
    if (!arretDemande) console.log(`[campagne] ${c.id} terminée`);
  } else {
    const e = echec.reason;
    const n = (relances.get(c.id) || { n: 0 }).n;
    const attente = config.relancesMs[Math.min(n, config.relancesMs.length - 1)];
    console.error(`[campagne] ${c.id} INTERROMPUE (marchand ${c.marchand_id}) : ${e.message} ; nouvelle tentative dans ${Math.round(attente / 1000)} s`);
    const { error } = await supabase.from('campagnes').update({ statut: 'interrompue' }).eq('id', c.id);
    if (error) console.error(`[campagne] ${c.id} statut interrompue :`, error.message);
    planifierRelance(c.id, n, attente);
  }
}

// Nouvelle tentative d'une campagne interrompue : UNE requête (la remet « en
// cours » et relit ses curseurs), puis l'envoi reprend au curseur. Si la base
// ne répond toujours pas, tentative suivante, plus tard.
function planifierRelance(id, n, attente) {
  if (arretDemande) return;
  const minuteur = setTimeout(async () => {
    if (arretDemande) return;
    const { data, error } = await supabase.from('campagnes')
      .update({ statut: 'en_cours', instance: INSTANCE, maj_le: new Date().toISOString() })
      .eq('id', id).in('statut', ['interrompue', 'en_cours'])
      .select('*');
    if (error) {
      const suivante = config.relancesMs[Math.min(n + 1, config.relancesMs.length - 1)];
      console.error(`[campagne] ${id} INTERROMPUE : reprise impossible (${error.message}) ; nouvelle tentative dans ${Math.round(suivante / 1000)} s`);
      planifierRelance(id, n + 1, suivante);
      return;
    }
    if (!data || data.length === 0) { relances.delete(id); return; }   // finie ailleurs
    relances.set(id, { n: n + 1, minuteur: null });
    console.log(`[campagne] ${id} reprise après interruption (tentative ${n + 1})`);
    demarrer(data[0]);
  }, attente);
  minuteur.unref();
  relances.set(id, { n: n + 1, minuteur });
}

// Lance l'envoi d'une campagne déjà créée (route du clic, ou reprise).
function demarrer(c) {
  if (arretDemande || actives.has(c.id)) return;
  const p = suivre(executer(c).finally(() => actives.delete(c.id)));
  actives.set(c.id, p);
  return p;
}

// Une fois, au démarrage du serveur, après repriseDelaiMs : reprend les
// campagnes en cours que plus personne ne fait avancer.
async function reprendre() {
  const { data, error } = await supabase.rpc('reprendre_campagnes', {
    p_instance: INSTANCE, p_inactif_depuis: `${Math.round(config.inactifMs / 1000)} seconds`,
  });
  if (error) { console.error('[campagne] reprise :', error.message); return []; }
  for (const c of data || []) {
    console.log(`[campagne] ${c.id} reprise (marchand ${c.marchand_id})`);
    demarrer(c);
  }
  return data || [];
}

function planifierReprise() {
  const t = setTimeout(() => { suivre(reprendre().catch(e => console.error('[campagne] reprise :', e.message))); }, config.repriseDelaiMs);
  t.unref();
}

// Arrêt propre : plus de nouveau lot ; le lot en cours finit (suivre()).
function arreter() {
  arretDemande = true;
  for (const r of [...reveils]) r();
  for (const { minuteur } of relances.values()) if (minuteur) clearTimeout(minuteur);
}

function _pourTests({ envoyeurs: e, config: cfg } = {}) {
  if (e) envoyeurs = { ...envoyeurs, ...e };
  if (cfg) Object.assign(config, cfg);
  return { actives, relances, config };
}

module.exports = { demarrer, reprendre, planifierReprise, arreter, _pourTests };
