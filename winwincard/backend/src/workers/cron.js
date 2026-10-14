const cron    = require('node-cron');
// Client long (30 s par appel, étape 16) : lectures et écritures par lot.
const supabase = require('../services/supabase').clientLong;
const { notif } = require('../i18n/messages');
const registre = require('../services/notif-registre');
const passages = require('../services/cron-passages');
const { suivre } = require('../services/arret');
const debit = require('../services/debit');   // débit partagé avec les campagnes (t37, d2)

const PURGE_DAYS   = 90;

// Forfaits éligibles aux workflows automatiques. Ouverts au Pro le 25/09/2026 ;
// `basic` reste exclu et ne reçoit aucun envoi automatique. Une seule constante
// pour les trois workflows : rien à désynchroniser si le périmètre rebouge.
// Les interrupteurs par workflow (workflow_*_enabled) restent le seul
// déclencheur réel — un forfait éligible n'envoie rien tant qu'ils sont à false.
const FORFAITS_WORKFLOWS = ['pro', 'pro_plus'];

// Nightly at 08:00 UTC (noon Gulf time — bonne fenêtre pour déclencher des visites)
// C'est aussi l'heure qu'attend /health/cron (cron-passages.js, HEURE_UTC).
// suivre() : un passage en cours est attendu par l'arrêt propre (étape 14a),
// dans la limite de 20 s ; arreterPlanification() empêche un serveur en partance
// de lancer le passage de 08:00 (le nouveau serveur le lance).
const tache = cron.schedule('0 8 * * *', () => {
  suivre(passageQuotidien().catch(e => console.error('[cron] passage:', e.message)));
});

// f10 (migration 062) : le 1er du mois à 02:00 UTC, mise à jour silencieuse des
// cartes iPhone des marchands qui ont « À proximité » : leurs créneaux couvrent
// 60 jours, cette mise à jour les prolonge. Loin du passage de 08:00.
const tacheGeo = cron.schedule('0 2 1 * *', () => {
  suivre(require('../services/geo').rafraichirTous().catch(e => console.error('[geo] mise à jour mensuelle :', e.message)));
});

function arreterPlanification() {
  tache.stop();
  tacheGeo.stop();
}

// Étapes du passage. Ordre = priorité de la règle « une relance par client et
// par jour » (décision du 12/10) : birthday, puis near_reward, puis inactive.
const ETAPES = [
  ['birthday',    runBirthdayWorkflow],
  ['near_reward', runNearRewardWorkflow],
  ['inactive',    runInactiveWorkflow],
  ['purge',       purgeOldExecutions],
  // f17 (migration 063) : ouverture et fin des thèmes de carte, reprise des
  // bascules inachevées. Les bascules tournent en arrière-plan, au débit
  // partagé : le passage ne les attend pas.
  ['themes',      () => require('../services/themes').passage()],
];

// Le passage planifié. Chaque étape attrape sa propre erreur : un workflow en
// échec n'empêche pas les suivants. Une étape est « en erreur » si elle lève
// (lecture des marchands impossible) ou si un marchand a échoué ; les autres
// marchands sont quand même servis. Le suivi (cron_passages, migration 049)
// encadre le passage sans jamais le bloquer. `etapes` n'est passé que par les tests.
async function passageQuotidien(etapes = ETAPES) {
  console.log('[cron] Démarrage des workflows…');
  const passage = await passages.debuter();
  const bilan   = {};
  const erreurs = [];
  const parMarchand = {};
  for (const [nom, etape] of etapes) {
    try {
      const resultats = await etape();
      if (Array.isArray(resultats)) {
        bilan[nom] = resultats.reduce((n, r) => n + (r.notifies || 0), 0);
        parMarchand[nom] = Object.fromEntries(resultats.map(r => [r.marchand_id,
          r.erreur ? { erreur: r.erreur, relances: r.relances || 0 }
                   : { eligibles: r.eligibles, relances: r.relances, reportes: r.reportes }]));
        if (resultats.some(r => r.erreur)) erreurs.push(nom);
      } else {
        bilan[nom] = 'ok';
      }
    } catch (e) {
      erreurs.push(nom);
      console.error(`[cron] ${nom}:`, e.message);
    }
  }
  await passages.terminer(passage, { bilan, erreurs, parMarchand });
  console.log('[cron] Workflows terminés.');
}

// ── Sélection et envoi (étape 22, migration 055) ─────────────────
// La base choisit les destinataires (reserver_relances) : sans plafond de
// lecture, scans annulés exclus, une relance par absence ou par palier, une par
// client et par jour, inscription AVANT l'envoi (un crash perd au pire une page,
// jamais de doublon). Ici : pages de `page` clients, au plus `plafond` par
// marchand, par type et par passage (décision du 12/10) ; le reste reste
// éligible et part au passage suivant. Par page : 1 requête de sélection, puis
// 1 insert du registre. Plus aucune requête par client.
const reglages = { page: 500, plafond: 1000, googleSimultanes: 5 };

// Envois réels ; remplacés par les tests (_pourTests).
let envoyeurs = {
  appleActif:  () => require('../services/apns').isApnsConfigured(),
  apple:       token => require('../services/apns').sendPushUpdate(token),
  googleActif: () => require('../services/google-pass').isConfigured(),
  google:      (serial, message) => require('../services/google-pass').addMessageToLoyaltyObject(serial, null, message),
};

// Une lecture des marchands ratée n'est plus « 0 marchand » : l'étape lève et le
// passage finit en « erreurs ».
async function lireMarchands(query) {
  const { data, error } = await query;
  if (error) throw new Error(`lecture des marchands impossible : ${error.message}`);
  return data || [];
}

// Remplace toutes les occurrences, sans motif d'expression régulière.
const remplacer = (texte, motif, valeur) => texte.split(motif).join(valeur);

async function relancerMarchand(type, merchant, modeles, params = {}) {
  const lot = registre.creerLot(type, merchant.id, { long: true });
  let eligibles = null;
  let relances  = 0;
  try {
    while (relances < reglages.plafond) {
      const limite = Math.min(reglages.page, reglages.plafond - relances);
      const { data, error } = await supabase.rpc('reserver_relances', {
        p_marchand_id: merchant.id, p_type: type, p_lot: lot.id, p_modeles: modeles, p_limite: limite,
        p_jours: params.jours ?? null, p_min: params.min ?? null, p_max: params.max ?? null,
      });
      if (error) throw new Error(`reserver_relances : ${error.message}`);
      if (eligibles === null) eligibles = data.eligibles || 0;
      const clients = data.clients || [];
      relances += clients.length;
      await envoyer(clients, lot);
      await lot.ecrire();   // registre écrit page par page : une perte reste bornée
      if (clients.length < limite) break;
    }
  } catch (e) {
    e.relances = relances;
    throw e;
  } finally {
    await lot.ecrire();
  }
  return { eligibles, relances, reportes: Math.max(0, eligibles - relances) };
}

// Apple : un jeton du débit partagé avec les campagnes avant chaque push (t37,
// d2) ; Google : seulement les clients qui ont une carte Google, 5 à la fois.
async function envoyer(clients, lot) {
  const apple = envoyeurs.appleActif() && (async () => {
    for (const c of clients) {
      for (const jeton of (c.jetons || [])) {
        let erreur = null;
        await debit.prendre();
        await envoyeurs.apple(jeton).catch(e => { erreur = e; console.error('[cron] APNs push:', e.message); });
        lot.ajouter({ plateforme: 'apple', serialNumber: c.serial, pushToken: jeton, erreur });
      }
    }
  })();
  const google = envoyeurs.googleActif() && (async () => {
    const file = clients.filter(c => c.google);
    await Promise.all(Array.from({ length: Math.min(reglages.googleSimultanes, file.length) }, async () => {
      while (file.length > 0) {
        const c = file.shift();
        let erreur = null;
        await envoyeurs.google(c.serial, c.message).catch(e => { erreur = e; console.error('[cron] Google notify:', e.message); });
        lot.ajouter({ plateforme: 'google', serialNumber: c.serial, erreur });
      }
    }));
  })();
  await Promise.all([apple, google]);
}

// Un marchand en échec n'arrête pas les autres ; son erreur est rendue.
async function parMarchand(type, merchants, relancer) {
  const results = [];
  for (const merchant of merchants) {
    try {
      const r = await relancer(merchant);
      if (!r) continue;
      console.log(`[cron] ${type}: ${r.relances} client(s) notifié(s) — ${merchant.nom}`
        + (r.reportes ? ` (${r.reportes} au prochain passage)` : ''));
      results.push({ marchand: merchant.nom, marchand_id: merchant.id, notifies: r.relances, ...r });
    } catch (e) {
      console.error(`[cron] ${type} — ${merchant.nom}:`, e.message);
      results.push({ marchand: merchant.nom, marchand_id: merchant.id, notifies: e.relances || 0,
        relances: e.relances || 0, erreur: e.message });
    }
  }
  return results;
}

// ── Workflow : clients inactifs ───────────────────────────────────
// Une relance par absence : dernier scan non annulé plus vieux que
// workflow_inactive_days, et aucune relance depuis. Jamais scanné : exclu.
// opts.marchandId : limiter à un seul marchand (test)
// opts.force      : ignorer workflow_inactive_enabled (test)
async function runInactiveWorkflow(opts = {}) {
  const { marchandId, force } = opts;

  let query = supabase
    .from('marchands')
    .select('id, nom, langue, workflow_inactive_days, workflow_inactive_message, marchand_inactive_days, marchand_inactive_message')
    .in('forfait', FORFAITS_WORKFLOWS)
    .eq('actif',   true);

  if (!force) query = query.eq('workflow_inactive_enabled', true);
  if (marchandId) query = query.eq('id', marchandId);

  const merchants = await lireMarchands(query);
  return parMarchand('inactive', merchants, merchant => {
    // Réglage du marchand s'il en a mis un (migration 060, f15), sinon celui de l'admin.
    const message = merchant.marchand_inactive_message || merchant.workflow_inactive_message;
    const modele = message
      ? remplacer(message, '{nom}', merchant.nom)
      : notif('inactive', merchant.langue, { prenom: '{prenom}', nom: merchant.nom });
    const jours = merchant.marchand_inactive_days || merchant.workflow_inactive_days || 30;
    return relancerMarchand('inactive', merchant, { '*': modele }, { jours });
  });
}

// ── Workflow : clients proches de la récompense ───────────────────
// Une relance par palier : de nouveau seulement quand le solde a bougé.
// opts.marchandId : limiter à un seul marchand (test)
// opts.force      : ignorer workflow_near_reward_enabled (test)
async function runNearRewardWorkflow(opts = {}) {
  const { marchandId, force } = opts;

  let query = supabase
    .from('marchands')
    .select('id, nom, langue, max_value, type_programme, workflow_near_reward_threshold, marchand_near_reward_threshold, workflow_near_reward_message, marchand_near_reward_message')
    .in('forfait', FORFAITS_WORKFLOWS)
    .eq('actif',   true);

  if (!force) query = query.eq('workflow_near_reward_enabled', true);
  if (marchandId) query = query.eq('id', marchandId);

  const merchants = await lireMarchands(query);
  return parMarchand('near_reward', merchants, merchant => {
    // Réglage du marchand s'il en a mis un (migration 060, f15), sinon celui de l'admin.
    const threshold = merchant.marchand_near_reward_threshold || merchant.workflow_near_reward_threshold || 2;
    const maxVal    = merchant.max_value || 10;
    const minPoints = maxVal - threshold;
    if (minPoints <= 0) return null;
    // Un texte par nombre restant (le pluriel en dépend). Message du marchand,
    // sinon celui de l'admin, sinon le texte WinWin (f18, migration 061) ;
    // {reste} → « 2 points » / « 1 tampon » selon le programme.
    const { modeleBoostWinwin, texteBoost } = require('../services/smart-messages');
    const modele = merchant.marchand_near_reward_message || merchant.workflow_near_reward_message
      || modeleBoostWinwin(merchant.langue);
    const unite = merchant.type_programme === 'points' ? 'points' : 'tampons';
    const modeles = {};
    for (let restant = 1; restant <= threshold; restant++) {
      modeles[restant] = texteBoost(modele, restant, unite, merchant.langue, merchant.nom);
    }
    modeles['*'] = modeles[threshold];
    return relancerMarchand('near_reward', merchant, modeles, { min: minPoints, max: maxVal });
  });
}

// ── Workflow : anniversaire client ────────────────────────────────
// Envoi le jour de l'anniversaire (jour + mois UTC ; année ignorée ; le 29/02
// ne tombe que les années bissextiles, voulu). Une fois par an. Réservé aux
// marchands éligibles (FORFAITS_WORKFLOWS) AVEC landing premium — seule surface
// où le client saisit sa date de naissance. Depuis le 30/09/2026, la landing
// premium s'active en Pro comme en Pro+ (services/forfaits.js,
// landingPremiumActive) : ce filtre en est le miroir SQL, à tenir aligné.
// Zéro écriture sur stored_value. Pas de quota (aucun notification_logs).
// opts.marchandId : limiter à un seul marchand (test)
// opts.force      : ignorer workflow_birthday_enabled (test)
async function runBirthdayWorkflow(opts = {}) {
  const { marchandId, force } = opts;

  let query = supabase
    .from('marchands')
    .select('id, nom, langue, workflow_birthday_message')
    .in('forfait', FORFAITS_WORKFLOWS)
    .eq('actif',   true)
    .eq('landing_premium', true); // date d'anniversaire collectée uniquement sur landing premium

  if (!force) query = query.eq('workflow_birthday_enabled', true);
  if (marchandId) query = query.eq('id', marchandId);

  const merchants = await lireMarchands(query);
  return parMarchand('birthday', merchants, merchant => {
    const modele = merchant.workflow_birthday_message
      ? remplacer(merchant.workflow_birthday_message, '{nom}', merchant.nom)
      : notif('birthday', merchant.langue, { prenom: '{prenom}', nom: merchant.nom });
    return relancerMarchand('birthday', merchant, { '*': modele });
  });
}

// ── Purge automatique des anciennes exécutions (TTL 90j) ─────────
async function purgeOldExecutions() {
  const cutoff = new Date(Date.now() - PURGE_DAYS * 864e5).toISOString();

  // 90 jours, SAUF la dernière ligne de chaque (client, type) : elle porte
  // « une relance par absence » et « une par palier » (migration 055).
  // §3.9 — supabase-js ne rejette jamais : l'erreur est lue.
  const { data: count, error } = await supabase.rpc('purger_workflow_executions', { p_avant: cutoff });
  if (error) console.error('[cron] purge workflow_executions:', error.message);
  else if (count > 0) console.log(`[cron] purge: ${count} workflow_executions supprimée(s)`);

  // Même rétention de 90 jours pour le registre des envois (migration 046) :
  // aucun nouveau planificateur, on réutilise ce passage.
  const { count: cE, error: errE } = await supabase
    .from('notification_envois')
    .delete({ count: 'exact' })
    .lt('envoye_le', cutoff);
  if (errE) console.error('[cron] purge notification_envois:', errE.message);
  else if (cE > 0) console.log(`[cron] purge: ${cE} notification_envois supprimée(s)`);
}

function _pourTests({ envoyeurs: e, reglages: r } = {}) {
  if (e) envoyeurs = { ...envoyeurs, ...e };
  if (r) Object.assign(reglages, r);
  return { reglages };
}

module.exports = { runInactiveWorkflow, runNearRewardWorkflow, runBirthdayWorkflow, purgeOldExecutions, passageQuotidien, arreterPlanification, _pourTests };
