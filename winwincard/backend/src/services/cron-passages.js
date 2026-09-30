'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SUIVI DU PASSAGE QUOTIDIEN DU CRON (migration 049)
//
// Répond à une seule question : le passage planifié du jour a-t-il démarré, et
// a-t-il fini sans erreur ? La route /health/cron (index.js) la pose ; UptimeRobot
// surveille la route et alerte sur un 503.
//
// ── RÈGLE ABSOLUE : LE SUIVI NE BLOQUE JAMAIS LE CRON ──────────────────────
// Mêmes garanties que le registre des envois (notif-registre.js) : `debuter()`
// et `terminer()` ne rejettent jamais — elles journalisent et rendent la main.
// Une table absente, un GRANT manquant ou une base en panne laissent le cron
// tourner exactement comme avant ; seul le suivi est perdu, et /health/cron le
// signale (503).
//
// ── HYPOTHÈSES ─────────────────────────────────────────────────────────────
//   - HEURE_UTC doit suivre cron.schedule('0 8 * * *') de workers/cron.js ;
//   - le serveur tourne en UTC (audit 06 §5.1) : node-cron planifie à l'heure
//     locale du process ;
//   - DELAI_FIN_MIN borne la durée d'un passage : 3 min 35 le 30/09, une à deux
//     heures à 100 000 porteurs (audit 99 §5.2). À relever avec le volume.
// ════════════════════════════════════════════════════════════════════════════

const os       = require('os');
const supabase = require('./supabase');

const TABLE               = 'cron_passages';
const HEURE_UTC           = 8;
const DELAI_DEMARRAGE_MIN = 10;   // pas de ligne 10 min après 08:00 → « pas_demarre »
const DELAI_FIN_MIN       = 60;   // pas fini 60 min après 08:00   → « pas_fini »
const DELAI_LECTURE_MS    = 5000;

// Début du passage : une ligne 'en_cours'. Rend son id, ou null si l'écriture a
// échoué (le cron continue quand même).
async function debuter() {
  try {
    // §3.9 : supabase-js ne rejette jamais — on lit `error`.
    const { data, error } = await supabase
      .from(TABLE)
      .insert({ instance: process.env.RAILWAY_REPLICA_ID || os.hostname() })
      .select('id')
      .single();
    if (error) {
      console.error('[cron-suivi] début non enregistré :', error.message);
      return null;
    }
    return data.id;
  } catch (e) {
    console.error('[cron-suivi] début non enregistré :', e.message);
    return null;
  }
}

// Fin du passage : `erreurs` = noms des étapes qui ont levé.
async function terminer(id, { bilan, erreurs }) {
  if (id == null) return;
  try {
    const { error } = await supabase
      .from(TABLE)
      .update({
        fin:     new Date().toISOString(),
        statut:  erreurs.length ? 'erreurs' : 'ok',
        details: { bilan, erreurs },
      })
      .eq('id', id);
    if (error) console.error('[cron-suivi] fin non enregistrée :', error.message);
  } catch (e) {
    console.error('[cron-suivi] fin non enregistrée :', e.message);
  }
}

// Heure du passage que l'on doit juger à l'instant `maintenant` : celui du jour
// à 08:00 UTC, sauf dans les DELAI_DEMARRAGE_MIN qui suivent (et avant), où l'on
// juge encore celui de la veille.
function passageAttendu(maintenant) {
  const attendu = new Date(Date.UTC(
    maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate(), HEURE_UTC));
  if (maintenant - attendu < DELAI_DEMARRAGE_MIN * 60e3) attendu.setUTCDate(attendu.getUTCDate() - 1);
  return attendu;
}

// Décision pure : `passage` = la dernière ligne commencée depuis `attendu`
// (ou null). Rend { ok, cause }.
function evaluer(passage, maintenant, attendu) {
  if (!passage) return { ok: false, cause: 'pas_demarre' };
  if (!passage.fin) {
    return maintenant - attendu < DELAI_FIN_MIN * 60e3
      ? { ok: true,  cause: 'en_cours' }
      : { ok: false, cause: 'pas_fini' };
  }
  if (passage.statut !== 'ok') return { ok: false, cause: 'erreurs' };
  return { ok: true, cause: 'fini' };
}

// Ce que /health/cron doit répondre. Ne rejette jamais.
async function etat(maintenant = new Date()) {
  const attendu = passageAttendu(maintenant);
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('debut, fin, statut')
      .gte('debut', attendu.toISOString())
      .order('debut', { ascending: false })
      .limit(1)
      .abortSignal(AbortSignal.timeout(DELAI_LECTURE_MS));
    if (error) {
      console.error('[health/cron] lecture impossible :', error.message);
      return { ok: false, cause: 'lecture_impossible', attendu: attendu.toISOString() };
    }
    const passage = (data && data[0]) || null;
    return {
      ...evaluer(passage, maintenant, attendu),
      attendu: attendu.toISOString(),
      debut:   passage ? passage.debut : null,
      fin:     passage ? passage.fin   : null,
    };
  } catch (e) {
    console.error('[health/cron] échec :', e.message);
    return { ok: false, cause: 'exception', attendu: attendu.toISOString() };
  }
}

module.exports = { debuter, terminer, etat, evaluer, passageAttendu, HEURE_UTC };
