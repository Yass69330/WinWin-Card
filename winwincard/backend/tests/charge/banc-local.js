'use strict';

// ════════════════════════════════════════════════════════════════════════════
// BANC LOCAL DE LA CAMPAGNE (étape 15, temps 1) — tout sur cette machine, rien
// de réel : PostgreSQL et PostgREST locaux (outils du filet, tests/lancer.js),
// l'imitateur, le VRAI serveur chargé du fichier de campagne, le générateur.
//
// Délai ajouté à chaque requête vers la base : CHARGE_DELAI_BASE_MS, 100 ms par
// défaut. Source : passation §15 decies (étape 6, 30/09) — serveur à Amsterdam,
// base à Paris, une requête base coûte ≈ 80 à 120 ms vue de Dubaï (/health/db
// moins /health), minimum ≈ 40 ms ; ≈ 10 ms de trajet Amsterdam–Paris et ≈ 70 ms
// fixes (passerelle Supabase, PostgREST, TLS). HYPOTHÈSE, à confirmer au temps 2
// (le fichier de campagne y mesure chaque appel à la base, côté serveur).
//
// Variables : CHARGE_PLAFOND (5000), CHARGE_DELAI_BASE_MS (100),
// CHARGE_ECHELLE_REGISTRE (1), CHARGE_SANS_PLAFOND_LIGNES=1 (lectures sans le
// plafond de 1 000 lignes : ce que deviendrait la production après l'étape 21),
// celles du générateur (CHARGE_SCENARIOS, CHARGE_RYTHME, CHARGE_DUREE_S...) et
// celles de l'imitateur (IMITATEUR_*, transmises telles quelles).
// FILET_GARDER=1 garde base et journaux.
// Lancement : node tests/charge/banc-local.js (Node de la production, 24.10.0).
// ════════════════════════════════════════════════════════════════════════════

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

process.env.FILET_BASE = process.env.FILET_BASE || 'winwin_charge';
const banc = require('../lancer');

const ICI = __dirname;
const PLAFOND = Number(process.env.CHARGE_PLAFOND || 5000);
const DELAI = Number(process.env.CHARGE_DELAI_BASE_MS ?? 100);
const ECHELLE = Number(process.env.CHARGE_ECHELLE_REGISTRE ?? 1);

function attendreLigne(p, motif, ms = 20000) {
  return new Promise((resolve, reject) => {
    const minuteur = setTimeout(() => reject(new Error(`« ${motif} » attendu`)), ms);
    let tampon = '';
    p.stdout.on('data', d => {
      tampon += d;
      const m = tampon.match(motif);
      if (m) { clearTimeout(minuteur); resolve(m); }
    });
  });
}

let imitateur = null;   // arrêté aussi en cas d'interruption

(async () => {
  banc.demarrerPostgresSiBesoin();
  let t0 = Date.now();
  const donnees = `\\set plafond ${PLAFOND}\n\\set echelle_registre ${ECHELLE}\n`
    + fs.readFileSync(path.join(ICI, 'donnees.sql'), 'utf8');
  const nb = banc.preparerBase(donnees);
  const comptes = banc.psqlSocket(`SELECT (SELECT count(*) FROM clients) || ' porteurs, ' || (SELECT count(*) FROM scans)
    || ' scans, ' || (SELECT count(*) FROM device_tokens) || ' inscriptions iPhone, '
    || (SELECT count(DISTINCT device_id) FROM device_tokens) || ' appareils, '
    || (SELECT count(*) FROM notification_envois) || ' lignes de registre, '
    || (SELECT count(*) FROM workflow_executions) || ' relances, '
    || pg_size_pretty(pg_database_size(current_database()))`);
  console.log(`[banc] base : ${nb} fichiers rejoués + données factices en ${Math.round((Date.now() - t0) / 1000)} s — ${comptes}`);

  const reglages = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('IMITATEUR_')));
  imitateur = spawn(process.execPath, [path.join(ICI, 'imitateur.js')], {
    env: { PATH: process.env.PATH, JWT_SECRET: banc.SECRET_JWT, ...reglages }, stdio: ['ignore', 'pipe', 'inherit'] });
  const [, portApns, portWeb] = await attendreLigne(imitateur, /apns=(\d+) web=(\d+)/);
  const urlImitateur = `http://127.0.0.1:${portWeb}`;

  // Plafond de 1 000 lignes par lecture, comme Supabase en production (étape 21).
  const sansPlafond = process.env.CHARGE_SANS_PLAFOND_LIGNES === '1';
  const urlSupabase = await banc.demarrerPostgrest({ delaiMs: DELAI, stockage: urlImitateur, maxLignes: sansPlafond ? null : 1000 });
  t0 = Date.now();
  const s = await banc.demarrerServeur(urlSupabase, 'serveur-charge', {
    NODE_ENV: 'production',   // comme en production : APNs de production (redirigé), journaux « combined »
    NODE_OPTIONS: `--require ${path.join(ICI, 'campagne.js')}`,
    API_BASE_URL: 'http://campagne.invalid',
    CAMPAGNE_APNS: `http://127.0.0.1:${portApns}`,
    CAMPAGNE_GOOGLE: urlImitateur,
  });
  console.log(`[banc] serveur de test prêt en ${Date.now() - t0} ms, délai base ${DELAI} ms, `
    + `${sansPlafond ? 'SANS plafond de lignes' : 'plafond 1 000 lignes'} : ${s.journal().match(/\[campagne\][^\n]*/)[0]}`);
  await fetch(`${urlImitateur}/__config`, { method: 'POST', body: JSON.stringify({ serveur: s.url }) });

  const generateur = spawn(process.execPath, [path.join(ICI, 'generateur.js')], {
    env: { ...process.env, NODE_OPTIONS: '', CIBLE: s.url, JWT_SECRET: banc.SECRET_JWT, IMITATEUR: urlImitateur,
      CHARGE_PLAFOND: String(PLAFOND) },
    stdio: 'inherit' });
  const code = await new Promise(r => generateur.on('exit', r));
  imitateur.kill();
  banc.nettoyer();
  process.exit(code);
})().catch(e => {
  console.error(`\n[banc] INTERROMPU : ${e.message}`);
  if (imitateur) imitateur.kill();
  banc.nettoyer();
  process.exit(2);
});
