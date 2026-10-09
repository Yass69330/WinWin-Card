'use strict';

// ════════════════════════════════════════════════════════════════════════════
// FILET DE TESTS ARGENT ET SCAN (étape 10 de la synthèse) — `npm test`
//
// Une commande, une base jetable, une ligne « N/N OK ». Rien de réel n'est
// touché : tout tourne en local et disparaît à la fin.
//   1. rejoue la base depuis le dépôt dans un PostgreSQL local (même méthode que
//      database/requetes/ecarts_prod_depot/generer.sh : schema.sql, migrations
//      dans l'ordre, rgpd_effacement.sql) ;
//   2. démarre PostgREST (l'API que Supabase met devant la base ; version figée,
//      téléchargée au premier lancement, empreinte vérifiée) derrière le préfixe
//      /rest/v1 de Supabase ;
//   3. démarre le VRAI serveur (src/index.js) avec une clé service_role locale ;
//   4. joue les scénarios de tests/scenarios.js.
//
// Le filet FIGE L'ÉTAT ACTUEL : un scénario qui constate un défaut connu (double
// crédit au renvoi, parrain ramené au seuil en mode points…) l'écrit tel quel. Il sera
// inversé par l'étape de la roadmap qui corrige ce défaut.
//
// Prérequis : Node (celui du serveur), PostgreSQL 16 ou plus avec un accès
// superutilisateur, curl et tar (premier lancement seulement), `npm ci` fait.
// Variables :
//   PSQL          commande psql superutilisateur (défaut : `runuser -u postgres --
//                 psql` si l'on est root, sinon `psql`) ;
//   PGPORT        port du PostgreSQL local (défaut 5432) ;
//   FILET_CACHE   dossier où garder PostgREST (défaut ~/.cache/winwin-filet) ;
//   FILET_GARDER  =1 pour garder la base et les journaux à la fin (enquête) ;
//   FILET_EN_PLUS chemins de modules de tests supplémentaires, séparés par des
//                 virgules, joués dans l'ordre après les scénarios, sur la même
//                 base et le même serveur (ex. les tests navigateur de
//                 tests/navigateur/, qui exigent Playwright) ;
//   FILET_BASE    nom de la base jetable (défaut winwin_filet).
// Chargé par require() (banc de charge, tests/charge/), ce fichier ne lance
// rien : il prête ses outils (base, PostgREST, serveur).
// Limite connue : la production tourne sous PostgreSQL 17.6 (00a §8).
// ════════════════════════════════════════════════════════════════════════════

const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

const RACINE   = path.resolve(__dirname, '..');
const DOSSIER_DB = path.join(RACINE, 'database');
const BASE     = process.env.FILET_BASE || 'winwin_filet';
const PGPORT   = process.env.PGPORT || '5432';
const SECRET_PGRST = 'filet_secret_postgrest_local_32_caracteres_min';
const SECRET_JWT   = 'filet-jwt-secret-local';
const POSTGREST = {
  version: 'v12.2.12',
  url: 'https://github.com/PostgREST/postgrest/releases/download/v12.2.12/postgrest-v12.2.12-linux-static-x86-64.tar.xz',
  sha256: '5de4092f1719da3353c40bf96c8dec6913f2254a7cd0b61cc05f233153b557d5',
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'winwin-filet-'));
const enfants = [];
let proxy = null;

// ── PostgreSQL ──────────────────────────────────────────────────────────────
const PSQL = process.env.PSQL
  || (process.getuid && process.getuid() === 0 && spawnSync('which', ['runuser']).status === 0
    ? 'runuser -u postgres -- psql' : 'psql');

// Accès superutilisateur par le socket local (pas de mot de passe à fournir).
function psqlSocket(sqlTexte, base = BASE) {
  const r = spawnSync('sh', ['-c', `${PSQL} -X -q -t -A -v ON_ERROR_STOP=1 -p ${PGPORT} -d ${base}`], {
    input: sqlTexte, encoding: 'utf8',
    env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' },
  });
  if (r.status !== 0) throw new Error(`psql : ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ')}`);
  return r.stdout.trim();
}

// Même accès, sans bloquer : pour tenir une transaction ouverte pendant qu'une
// route s'exécute (course provoquée, ordre garanti).
function psqlEnFond(sqlTexte, base = BASE) {
  return new Promise((resolve, reject) => {
    const p = spawn('sh', ['-c', `${PSQL} -X -q -t -A -v ON_ERROR_STOP=1 -p ${PGPORT} -d ${base}`], {
      env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' },
    });
    let erreur = '';
    p.stderr.on('data', d => { erreur += d; });
    p.stdout.resume();
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(`psql : ${erreur.trim()}`))));
    p.stdin.end(sqlTexte);
  });
}

function demarrerPostgresSiBesoin() {
  try { psqlSocket('SELECT 1', 'postgres'); return; } catch { /* on tente de démarrer */ }
  const liste = spawnSync('pg_lsclusters', ['-h'], { encoding: 'utf8' });
  if (liste.status !== 0) throw new Error('PostgreSQL injoignable et pg_lsclusters absent : démarrer PostgreSQL à la main');
  for (const ligne of liste.stdout.trim().split('\n')) {
    const [ver, nom] = ligne.split(/\s+/);
    spawnSync('pg_ctlcluster', [ver, nom, 'start']);
  }
  psqlSocket('SELECT 1', 'postgres');
}

function preparerBase(fixtures) {
  psqlSocket(`DROP DATABASE IF EXISTS ${BASE}`, 'postgres');
  psqlSocket(`CREATE DATABASE ${BASE}`, 'postgres');
  psqlSocket(`ALTER DATABASE ${BASE} SET search_path = "$user", public, extensions`, 'postgres');
  // Prélude : le strict nécessaire de Supabase (méthode 00a, annexe B), plus le
  // rôle de connexion de PostgREST.
  psqlSocket(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'filet_authenticator') THEN
        CREATE ROLE filet_authenticator LOGIN NOINHERIT PASSWORD 'filet_local';
      END IF;
    END $$;
    GRANT anon, service_role TO filet_authenticator;
    CREATE SCHEMA extensions;
    CREATE EXTENSION "uuid-ossp" SCHEMA extensions;
    CREATE EXTENSION pgcrypto SCHEMA extensions;`);
  const migrations = fs.readdirSync(DOSSIER_DB).filter(f => /^migration_\d+.*\.sql$/.test(f)).sort();
  for (const f of ['schema.sql', ...migrations, 'rgpd_effacement.sql']) {
    try { psqlSocket(fs.readFileSync(path.join(DOSSIER_DB, f), 'utf8')); }
    catch (e) { throw new Error(`rejeu de ${f} : ${e.message}`); }
  }
  psqlSocket(fixtures);
  return migrations.length + 2;
}

// ── PostgREST ───────────────────────────────────────────────────────────────
function binairePostgrest() {
  const dossier = process.env.FILET_CACHE || path.join(os.homedir(), '.cache', 'winwin-filet');
  const binaire = path.join(dossier, `postgrest-${POSTGREST.version}`);
  if (fs.existsSync(binaire)) return binaire;
  fs.mkdirSync(dossier, { recursive: true });
  const archive = path.join(TMP, 'postgrest.tar.xz');
  // --retry : GitHub répond parfois 502 un court instant ; l'empreinte reste vérifiée.
  const dl = spawnSync('curl', ['-sSfL', '--retry', '4', '--retry-all-errors', '--retry-delay', '2',
    '-o', archive, POSTGREST.url], { stdio: 'inherit' });
  if (dl.status !== 0) throw new Error(`téléchargement de PostgREST impossible (${POSTGREST.url})`);
  const empreinte = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  if (empreinte !== POSTGREST.sha256) throw new Error(`empreinte de PostgREST inattendue : ${empreinte}`);
  const tar = spawnSync('tar', ['-xJf', archive, '-C', TMP]);
  if (tar.status !== 0) throw new Error('extraction de PostgREST impossible');
  fs.copyFileSync(path.join(TMP, 'postgrest'), binaire);
  fs.chmodSync(binaire, 0o755);
  return binaire;
}

function portLibre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function attendreHttp(url, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { await fetch(url); return; } catch { await new Promise(r => setTimeout(r, 150)); }
  }
  throw new Error(`${url} ne répond pas`);
}

function lancer(nom, commande, args, options) {
  const journal = fs.openSync(path.join(TMP, `${nom}.log`), 'a');
  const p = spawn(commande, args, { ...options, stdio: ['ignore', journal, journal] });
  enfants.push(p);
  return p;
}

// Options du banc de charge (tests/charge/), absentes pour le filet :
//   delaiMs  : attente ajoutée à chaque requête vers la base (trajet du serveur à
//              la base de production) ;
//   stockage : adresse où renvoyer /storage/v1 (imitation du stockage Supabase) ;
//   maxLignes : plafond de lignes par lecture, comme Supabase (1 000 en production).
async function demarrerPostgrest({ delaiMs = 0, stockage = null, maxLignes = null } = {}) {
  const port = await portLibre();
  const conf = path.join(TMP, 'postgrest.conf');
  fs.writeFileSync(conf, [
    `db-uri = "postgres://filet_authenticator:filet_local@127.0.0.1:${PGPORT}/${BASE}"`,
    'db-schemas = "public"', 'db-anon-role = "anon"',
    `jwt-secret = "${SECRET_PGRST}"`, 'server-host = "127.0.0.1"', `server-port = ${port}`,
    ...(maxLignes ? [`db-max-rows = ${maxLignes}`] : []),
  ].join('\n'));
  lancer('postgrest', binairePostgrest(), [conf]);
  await attendreHttp(`http://127.0.0.1:${port}/`);
  // Préfixe /rest/v1 comme chez Supabase : supabase-js l'ajoute à SUPABASE_URL.
  const portProxy = await portLibre();
  proxy = http.createServer((req, res) => {
    let cible;
    if (req.url.startsWith('/rest/v1')) {
      cible = { host: '127.0.0.1', port, path: req.url.slice('/rest/v1'.length) || '/' };
    } else if (stockage && req.url.startsWith('/storage/v1')) {
      const u = new URL(stockage);
      cible = { host: u.hostname, port: u.port, path: req.url };
    } else { res.writeHead(404); return res.end('hors filet'); }
    const envoyer = () => {
      const amont = http.request({ ...cible, method: req.method, headers: { ...req.headers, host: `${cible.host}:${cible.port}` } },
        r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      amont.on('error', e => { res.writeHead(502); res.end(e.message); });
      req.pipe(amont);
    };
    if (delaiMs > 0) { req.pause(); setTimeout(() => { req.resume(); envoyer(); }, delaiMs); } else envoyer();
  });
  await new Promise(r => proxy.listen(portProxy, '127.0.0.1', r));
  return `http://127.0.0.1:${portProxy}`;
}

// ── Serveur WinWin ──────────────────────────────────────────────────────────
// `nom` : journal TMP/<nom>.log. Un second serveur (étape 14a) sert au test de
// l'arrêt propre, qui le coupe sans toucher au serveur des autres scénarios.
async function demarrerServeur(urlSupabase, nom = 'serveur', envEnPlus = {}) {
  const port = await portLibre();
  const cle = jwt.sign({ role: 'service_role' }, SECRET_PGRST);
  // Lancé depuis le dossier temporaire VIDE : dotenv (src/index.js:1) lit le .env
  // du dossier courant, et un vrai .env (clés Apple, Google, Sentry) ne doit
  // jamais entrer dans le filet. Seules les variables ci-dessous existent.
  const processus = lancer(nom, process.execPath, [path.join(RACINE, 'src', 'index.js')], {
    cwd: TMP,
    env: { PATH: process.env.PATH, PORT: String(port), NODE_ENV: 'test',
      SUPABASE_URL: urlSupabase, SUPABASE_SERVICE_KEY: cle,
      JWT_SECRET: SECRET_JWT, ADMIN_PASSWORD: 'filet-admin', ...envEnPlus },
  });
  const sortie = new Promise(r => processus.on('exit', (code, signal) => r({ code, signal })));
  const fichier = path.join(TMP, `${nom}.log`);
  const journal = () => (fs.existsSync(fichier) ? fs.readFileSync(fichier, 'utf8') : '');
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    if (journal().includes('Workflows planifiés')) return { url: `http://127.0.0.1:${port}`, processus, sortie, journal };
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`le serveur ne démarre pas (journal : ${fichier})`);
}

// ── Vérifications ───────────────────────────────────────────────────────────
const resultats = [];
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])]));
  return v;
}
function verifier(nom, obtenu, attendu) {
  const ok = JSON.stringify(canon(obtenu)) === JSON.stringify(canon(attendu));
  resultats.push(ok);
  console.log(`${ok ? 'OK ' : 'KO '} ${nom}${ok ? '' : ` → obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`}`);
  return ok;
}

function nettoyer() {
  for (const p of enfants) { try { p.kill(); } catch { /* déjà arrêté */ } }
  if (proxy) proxy.close();
  if (process.env.FILET_GARDER === '1') {
    console.log(`(base ${BASE} et journaux gardés dans ${TMP})`);
    return;
  }
  try { psqlSocket(`DROP DATABASE IF EXISTS ${BASE} WITH (FORCE)`, 'postgres'); } catch { /* base déjà partie */ }
  fs.rmSync(TMP, { recursive: true, force: true });
}

// ── Déroulé ─────────────────────────────────────────────────────────────────
module.exports = { TMP, BASE, SECRET_JWT, psqlSocket, psqlEnFond, demarrerPostgresSiBesoin, preparerBase,
  demarrerPostgrest, demarrerServeur, lancer, portLibre, attendreHttp, nettoyer };

if (require.main === module) (async () => {
  const scenarios = require('./scenarios');
  demarrerPostgresSiBesoin();
  const nb = preparerBase(scenarios.FIXTURES);
  console.log(`base rejouée depuis le dépôt : ${nb} fichiers (schema.sql, migrations, rgpd_effacement.sql) + données du filet`);
  const urlSupabase = await demarrerPostgrest();
  const urlServeur = (await demarrerServeur(urlSupabase)).url;

  const ctx = {
    sql: psqlSocket,
    sqlEnFond: psqlEnFond,
    verifier,
    urlServeur,
    secretJwt: SECRET_JWT,
    urlSupabase,
    cleService: jwt.sign({ role: 'service_role' }, SECRET_PGRST),
    demarrerServeur: (nom, url = urlSupabase, env = {}) => demarrerServeur(url, nom, env),
    async api(methode, chemin, jeton, corps) {
      const r = await fetch(urlServeur + chemin, { method: methode,
        headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) },
        body: corps === undefined ? undefined : JSON.stringify(corps) });
      const t = await r.text();
      let c; try { c = JSON.parse(t); } catch { c = t; }
      return { statut: r.status, corps: c };
    },
  };
  await scenarios.jouer(ctx);
  for (const module of (process.env.FILET_EN_PLUS || '').split(',').filter(Boolean)) {
    await require(path.resolve(module))(ctx);
  }

  const ok = resultats.filter(Boolean).length;
  console.log(`\n${ok}/${resultats.length} OK`);
  nettoyer();
  process.exit(ok === resultats.length ? 0 : 1);
})().catch(e => {
  console.error(`\nFILET INTERROMPU : ${e.message}`);
  nettoyer();
  process.exit(2);
});
