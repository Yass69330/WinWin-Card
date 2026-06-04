const cron    = require('node-cron');
const supabase = require('../services/supabase');

const DEDUP_DAYS   = 7;
const PURGE_DAYS   = 90;

// Nightly at 08:00 UTC (noon Gulf time — bonne fenêtre pour déclencher des visites)
cron.schedule('0 8 * * *', async () => {
  console.log('[cron] Démarrage des workflows…');
  try { await runInactiveWorkflow();   } catch (e) { console.error('[cron] inactive:', e.message); }
  try { await runNearRewardWorkflow(); } catch (e) { console.error('[cron] near_reward:', e.message); }
  try { await purgeOldExecutions();   } catch (e) { console.error('[cron] purge:', e.message); }
  console.log('[cron] Workflows terminés.');
});

// ── Workflow : clients inactifs ───────────────────────────────────
// opts.marchandId : limiter à un seul marchand (test)
// opts.force      : ignorer workflow_inactive_enabled (test)
async function runInactiveWorkflow(opts = {}) {
  const { marchandId, force } = opts;

  let query = supabase
    .from('marchands')
    .select('id, nom, workflow_inactive_days')
    .eq('forfait', 'pro_plus')
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

    const activeSet = new Set((activeScans || []).map(s => s.client_id));
    const dedupSet  = new Set((recentExec  || []).map(e => e.client_id));
    const toNotify  = (clients || []).filter(c => !activeSet.has(c.id) && !dedupSet.has(c.id));

    for (const client of toNotify) {
      const msg = `Bonjour ${client.prenom} ! Vous nous manquez chez ${merchant.nom}. Venez nous rendre visite bientôt ! 🎯`;
      await notifyClient(client, merchant.id, msg);
      await supabase.from('workflow_executions').insert({ workflow_type: 'inactive', client_id: client.id, marchand_id: merchant.id });
    }

    console.log(`[cron] inactive: ${toNotify.length} client(s) notifié(s) — ${merchant.nom}`);
    results.push({
      marchand:        merchant.nom,
      inactifs_total:  (clients || []).length - activeSet.size,
      notifies:        toNotify.length,
      skipped_dedup:   toNotify.length === 0 && (clients || []).filter(c => !activeSet.has(c.id)).length > 0,
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
    .select('id, nom, max_value, workflow_near_reward_threshold')
    .eq('forfait', 'pro_plus')
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

    const dedupSet = new Set((recentExec || []).map(e => e.client_id));
    const toNotify = (clients || []).filter(c => !dedupSet.has(c.id));

    for (const client of toNotify) {
      const remaining = maxVal - client.stored_value;
      const msg = `Bonjour ${client.prenom} ! Plus que ${remaining} point${remaining > 1 ? 's' : ''} pour débloquer votre récompense chez ${merchant.nom}. Venez vite ! 🎁`;
      await notifyClient(client, merchant.id, msg);
      await supabase.from('workflow_executions').insert({ workflow_type: 'near_reward', client_id: client.id, marchand_id: merchant.id });
    }

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

// ── Envoi de notification à un client ────────────────────────────
async function notifyClient(client, marchandId, msg) {
  if (!client.pass_serial_number) return;

  await supabase.from('passes')
    .update({ notification_message: msg })
    .eq('serial_number', client.pass_serial_number)
    .eq('marchand_id', marchandId);

  const { isApnsConfigured, sendPushUpdate } = require('../services/apns');
  if (isApnsConfigured()) {
    const { data: tokens } = await supabase.from('device_tokens').select('push_token').eq('serial_number', client.pass_serial_number);
    for (const { push_token } of (tokens || [])) {
      await sendPushUpdate(push_token).catch(e => console.error('[cron] APNs push:', e.message));
    }
  }

  const { addMessageToLoyaltyObject, isConfigured: isGoogleConfigured } = require('../services/google-pass');
  if (isGoogleConfigured()) {
    await addMessageToLoyaltyObject(client.pass_serial_number, null, msg)
      .catch(e => console.error('[cron] Google notify:', e.message));
  }
}

// ── Purge automatique des anciennes exécutions (TTL 90j) ─────────
async function purgeOldExecutions() {
  const cutoff = new Date(Date.now() - PURGE_DAYS * 864e5).toISOString();
  const { count } = await supabase
    .from('workflow_executions')
    .delete({ count: 'exact' })
    .lt('executed_at', cutoff);
  if (count > 0) console.log(`[cron] purge: ${count} workflow_executions supprimée(s)`);
}

module.exports = { runInactiveWorkflow, runNearRewardWorkflow };
