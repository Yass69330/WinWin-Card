const cron    = require('node-cron');
const supabase = require('../services/supabase');
const { notif } = require('../i18n/messages');
const registre = require('../services/notif-registre');
const passages = require('../services/cron-passages');
const { suivre } = require('../services/arret');

const DEDUP_DAYS   = 7;
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

function arreterPlanification() {
  tache.stop();
}

// Étapes du passage, dans l'ordre d'origine.
const ETAPES = [
  ['inactive',    runInactiveWorkflow],
  ['near_reward', runNearRewardWorkflow],
  ['birthday',    runBirthdayWorkflow],
  ['purge',       purgeOldExecutions],
];

// Le passage planifié. Chaque étape attrape sa propre erreur : un workflow en
// échec n'empêche pas les suivants (comportement d'origine, inchangé). Le suivi
// (cron_passages, migration 049) encadre le passage sans jamais le bloquer.
// `etapes` n'est passé que par les tests.
async function passageQuotidien(etapes = ETAPES) {
  console.log('[cron] Démarrage des workflows…');
  const passage = await passages.debuter();
  const bilan   = {};
  const erreurs = [];
  for (const [nom, etape] of etapes) {
    try {
      const resultats = await etape();
      bilan[nom] = Array.isArray(resultats)
        ? resultats.reduce((n, r) => n + (r.notifies || 0), 0)
        : 'ok';
    } catch (e) {
      erreurs.push(nom);
      console.error(`[cron] ${nom}:`, e.message);
    }
  }
  await passages.terminer(passage, { bilan, erreurs });
  console.log('[cron] Workflows terminés.');
}

// ── Workflow : clients inactifs ───────────────────────────────────
// opts.marchandId : limiter à un seul marchand (test)
// opts.force      : ignorer workflow_inactive_enabled (test)
async function runInactiveWorkflow(opts = {}) {
  const { marchandId, force } = opts;

  let query = supabase
    .from('marchands')
    .select('id, nom, langue, workflow_inactive_days, workflow_inactive_message')
    .in('forfait', FORFAITS_WORKFLOWS)
    .eq('actif',   true);

  if (!force) query = query.eq('workflow_inactive_enabled', true);
  if (marchandId) query = query.eq('id', marchandId);

  const { data: merchants } = await query;
  if (!merchants?.length) return [];

  const dedupSince = new Date(Date.now() - DEDUP_DAYS * 864e5).toISOString();
  const results    = [];

  for (const merchant of merchants) {
    const days  = merchant.workflow_inactive_days || 30;
    const since = new Date(Date.now() - days * 864e5).toISOString();

    const [{ data: activeScans }, { data: clients }, { data: recentExec }] = await Promise.all([
      supabase.from('scans').select('client_id').eq('marchand_id', merchant.id).gte('date_scan', since),
      supabase.from('clients').select('id, prenom, pass_serial_number').eq('marchand_id', merchant.id).is('deleted_at', null),
      supabase.from('workflow_executions').select('client_id').eq('marchand_id', merchant.id).eq('workflow_type', 'inactive').gte('executed_at', dedupSince),
    ]);

    const lot = registre.creerLot('inactive', merchant.id);
    const activeSet = new Set((activeScans || []).map(s => s.client_id));
    const dedupSet  = new Set((recentExec  || []).map(e => e.client_id));
    const toNotify  = (clients || []).filter(c => !activeSet.has(c.id) && !dedupSet.has(c.id));

    for (const client of toNotify) {
      const msg = merchant.workflow_inactive_message
        ? merchant.workflow_inactive_message.replace('{prenom}', client.prenom).replace('{nom}', merchant.nom)
        : notif('inactive', merchant.langue, { prenom: client.prenom, nom: merchant.nom });
      await notifyClient(client, merchant.id, msg, lot);
      const { error: errDedup } = await supabase.from('workflow_executions').insert({ workflow_type: 'inactive', client_id: client.id, marchand_id: merchant.id });
      if (errDedup) console.error('[cron] inactive dedup insert:', errDedup.message);
    }

    // Registre : UN insert pour tout ce marchand, après les envois.
    await lot.ecrire();

    console.log(`[cron] inactive: ${toNotify.length} client(s) notifié(s) — ${merchant.nom}`);
    const inactiveClients = (clients || []).filter(c => !activeSet.has(c.id));
    results.push({
      marchand:        merchant.nom,
      inactifs_total:  inactiveClients.length,
      notifies:        toNotify.length,
      skipped_dedup:   toNotify.length === 0 && inactiveClients.length > 0,
    });
  }

  return results;
}

// ── Workflow : clients proches de la récompense ───────────────────
// opts.marchandId : limiter à un seul marchand (test)
// opts.force      : ignorer workflow_near_reward_enabled (test)
async function runNearRewardWorkflow(opts = {}) {
  const { marchandId, force } = opts;

  let query = supabase
    .from('marchands')
    .select('id, nom, langue, max_value, workflow_near_reward_threshold')
    .in('forfait', FORFAITS_WORKFLOWS)
    .eq('actif',   true);

  if (!force) query = query.eq('workflow_near_reward_enabled', true);
  if (marchandId) query = query.eq('id', marchandId);

  const { data: merchants } = await query;
  if (!merchants?.length) return [];

  const dedupSince = new Date(Date.now() - DEDUP_DAYS * 864e5).toISOString();
  const results    = [];

  for (const merchant of merchants) {
    const threshold = merchant.workflow_near_reward_threshold || 2;
    const maxVal    = merchant.max_value || 10;
    const minPoints = maxVal - threshold;
    if (minPoints <= 0) continue;

    const [{ data: clients }, { data: recentExec }] = await Promise.all([
      supabase.from('clients').select('id, prenom, stored_value, pass_serial_number')
        .eq('marchand_id', merchant.id)
        .is('deleted_at', null)
        .gte('stored_value', minPoints)
        .lt('stored_value', maxVal),
      supabase.from('workflow_executions').select('client_id')
        .eq('marchand_id', merchant.id)
        .eq('workflow_type', 'near_reward')
        .gte('executed_at', dedupSince),
    ]);

    const lot = registre.creerLot('near_reward', merchant.id);
    const dedupSet = new Set((recentExec || []).map(e => e.client_id));
    const toNotify = (clients || []).filter(c => !dedupSet.has(c.id));

    for (const client of toNotify) {
      const remaining = maxVal - client.stored_value;
      const msg = notif('nearReward', merchant.langue, { prenom: client.prenom, remaining, nom: merchant.nom });
      await notifyClient(client, merchant.id, msg, lot);
      const { error: errDedup } = await supabase.from('workflow_executions').insert({ workflow_type: 'near_reward', client_id: client.id, marchand_id: merchant.id });
      if (errDedup) console.error('[cron] near_reward dedup insert:', errDedup.message);
    }

    await lot.ecrire();

    console.log(`[cron] near_reward: ${toNotify.length} client(s) notifié(s) — ${merchant.nom}`);
    results.push({
      marchand:      merchant.nom,
      eligibles:     (clients || []).length,
      notifies:      toNotify.length,
      skipped_dedup: toNotify.length === 0 && (clients || []).length > 0,
    });
  }

  return results;
}

// ── Workflow : anniversaire client ────────────────────────────────
// Envoi le jour de l'anniversaire (jour + mois ; année ignorée). Réservé aux
// marchands éligibles (FORFAITS_WORKFLOWS) AVEC landing premium — seule surface
// où le client saisit sa date de naissance. Depuis le 30/09/2026, la landing
// premium s'active en Pro comme en Pro+ (services/forfaits.js,
// landingPremiumActive) : ce filtre en est le miroir SQL, à tenir aligné.
// Zéro écriture sur stored_value : simple message via
// notifyClient (identique stamps/points). Pas de quota (aucun notification_logs).
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

  const { data: merchants } = await query;
  if (!merchants?.length) return [];

  // Clé jour+mois du jour, en UTC (cohérent avec tout le cron). Comparaison en
  // chaîne 'MM-JJ' — aucun parsing Date de la date de naissance (évite les
  // décalages de fuseau). date_anniversaire est un DATE Postgres → 'AAAA-MM-JJ'.
  const now       = new Date();
  const todayMMDD = `${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  // Dédup « une fois par an » sans nouvelle colonne : exécutions birthday de ce
  // client depuis le 1er janvier UTC de l'année courante.
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString();
  const results   = [];

  for (const merchant of merchants) {
    const [{ data: clients }, { data: sentThisYear }] = await Promise.all([
      supabase.from('clients')
        .select('id, prenom, pass_serial_number, date_anniversaire')
        .eq('marchand_id', merchant.id)
        .is('deleted_at', null)
        .not('date_anniversaire', 'is', null),
      supabase.from('workflow_executions')
        .select('client_id')
        .eq('marchand_id', merchant.id)
        .eq('workflow_type', 'birthday')
        .gte('executed_at', yearStart),
    ]);

    const lot = registre.creerLot('birthday', merchant.id);
    const sentSet = new Set((sentThisYear || []).map(e => e.client_id));
    // slice(5) de 'AAAA-MM-JJ' → 'MM-JJ'. 29/02 ne matche que les années
    // bissextiles → aucun envoi les autres années (voulu, pas de contournement).
    const toNotify = (clients || []).filter(c =>
      typeof c.date_anniversaire === 'string' &&
      c.date_anniversaire.slice(5) === todayMMDD &&
      !sentSet.has(c.id)
    );

    for (const client of toNotify) {
      const msg = merchant.workflow_birthday_message
        ? merchant.workflow_birthday_message.replace('{prenom}', client.prenom).replace('{nom}', merchant.nom)
        : notif('birthday', merchant.langue, { prenom: client.prenom, nom: merchant.nom });
      await notifyClient(client, merchant.id, msg, lot);
      const { error: errDedup } = await supabase.from('workflow_executions').insert({ workflow_type: 'birthday', client_id: client.id, marchand_id: merchant.id });
      if (errDedup) console.error('[cron] birthday dedup insert:', errDedup.message);
    }

    await lot.ecrire();

    console.log(`[cron] birthday: ${toNotify.length} client(s) notifié(s) — ${merchant.nom}`);
    results.push({ marchand: merchant.nom, notifies: toNotify.length });
  }

  return results;
}

// ── Envoi de notification à un client ────────────────────────────
// `lot` : collecteur du registre des envois (migration 046). Les lignes sont
// accumulées ici et écrites UNE FOIS par marchand, jamais une par push. Le
// registre n'est jamais attendu avant l'envoi : il ne peut rien retarder.
async function notifyClient(client, marchandId, msg, lot) {
  if (!client.pass_serial_number) return;

  await supabase.from('passes')
    .update({ notification_message: msg })
    .eq('serial_number', client.pass_serial_number)
    .eq('marchand_id', marchandId);

  const { isApnsConfigured, sendPushUpdate } = require('../services/apns');
  if (isApnsConfigured()) {
    const { data: tokens } = await supabase.from('device_tokens').select('push_token').eq('serial_number', client.pass_serial_number);
    for (const { push_token } of (tokens || [])) {
      let erreur = null;
      await sendPushUpdate(push_token).catch(e => { erreur = e; console.error('[cron] APNs push:', e.message); });
      if (lot) lot.ajouter({ plateforme: 'apple', serialNumber: client.pass_serial_number, pushToken: push_token, erreur });
    }
  }

  const { addMessageToLoyaltyObject, isConfigured: isGoogleConfigured } = require('../services/google-pass');
  if (isGoogleConfigured()) {
    let errG = null;
    await addMessageToLoyaltyObject(client.pass_serial_number, null, msg)
      .catch(e => { errG = e; console.error('[cron] Google notify:', e.message); });
    if (lot) lot.ajouter({ plateforme: 'google', serialNumber: client.pass_serial_number, erreur: errG });
  }
}

// ── Purge automatique des anciennes exécutions (TTL 90j) ─────────
async function purgeOldExecutions() {
  const cutoff = new Date(Date.now() - PURGE_DAYS * 864e5).toISOString();

  // L'erreur n'était pas lue : une purge en échec (GRANT retiré, table
  // renommée) aurait été totalement invisible et la table aurait grossi sans
  // fin. §3.9 — supabase-js ne rejette jamais.
  const { count, error } = await supabase
    .from('workflow_executions')
    .delete({ count: 'exact' })
    .lt('executed_at', cutoff);
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

module.exports = { runInactiveWorkflow, runNearRewardWorkflow, runBirthdayWorkflow, passageQuotidien, arreterPlanification };
