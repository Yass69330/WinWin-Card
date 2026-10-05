'use strict';

// ════════════════════════════════════════════════════════════════════════════
// PREUVE DES GARDE-FOUS DE LA CAMPAGNE (étape 15) — sur le banc local.
//   1. Le serveur chargé du fichier de campagne refuse de démarrer : base sans
//      marchand témoin, API_BASE_URL de production, vraie clé fournie, Sentry.
//   2. Le générateur refuse winwin-card.com sans envoyer une seule requête, et
//      refuse un serveur sans témoin sans rien écrire.
//   3. Depuis le serveur de test : Apple et Google arrivent à l'imitateur, la
//      production et tout autre hôte sont bloqués.
//   4. Le pilote joue la sonde d'adresse et donne l'adresse pour le navigateur.
//   5. La préparation de la base de test (preparer.js) refuse toute base qui
//      n'est ni neuve ni de campagne, et rejoue le dépôt sur une base neuve.
//   6. Le pas « droits » ramène une base « case cochée » aux droits de la
//      production : retraits seulement, refus si un objet a moins, IDENTIQUE.
// Lancement : node tests/charge/garde-fous.js. Sortie 0 si tout est conforme.
// ════════════════════════════════════════════════════════════════════════════

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.env.FILET_BASE = process.env.FILET_BASE || 'winwin_garde_fous';
const banc = require('../lancer');
const ICI = __dirname;
const TEMOIN = 'c0ffee15-0000-4000-8000-000000000015';
const CLE = crypto.createHash('sha256').update(`${banc.SECRET_JWT}:campagne`).digest('hex').slice(0, 32);

const resultats = [];
function verifier(nom, obtenu, attendu) {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  resultats.push(ok);
  console.log(`${ok ? 'OK ' : 'KO '} ${nom}${ok ? '' : ` → obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`}`);
}

// Lance un process depuis un dossier vide (aucun .env lu, comme le filet) et rend
// { code, sortie } quand il s'arrête (ou au bout de ms).
function jouer(args, env, ms = 30000) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, args, { cwd: banc.TMP, env: { PATH: process.env.PATH, PORT: '0', ...env } });
    let sortie = '';
    p.stdout.on('data', d => { sortie += d; });
    p.stderr.on('data', d => { sortie += d; });
    const minuteur = setTimeout(() => p.kill(), ms);
    p.on('exit', code => { clearTimeout(minuteur); resolve({ code, sortie }); });
  });
}

let imitateur = null;   // arrêté aussi en cas d'interruption

(async () => {
  banc.demarrerPostgresSiBesoin();
  banc.preparerBase('');   // la base reconstruite, SANS données ni témoin
  imitateur = spawn(process.execPath, [path.join(ICI, 'imitateur.js')],
    { env: { PATH: process.env.PATH, JWT_SECRET: banc.SECRET_JWT, IMITATEUR_IPHONES: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
  const [, portApns, portWeb] = await new Promise(r => imitateur.stdout.on('data', d => {
    const m = String(d).match(/apns=(\d+) web=(\d+)/); if (m) r(m); }));
  const urlSupabase = await banc.demarrerPostgrest({ maxLignes: 1000 });
  const envCampagne = {
    NODE_ENV: 'production', SUPABASE_URL: urlSupabase,
    SUPABASE_SERVICE_KEY: require('jsonwebtoken').sign({ role: 'service_role' }, 'filet_secret_postgrest_local_32_caracteres_min'),
    JWT_SECRET: banc.SECRET_JWT, ADMIN_PASSWORD: 'garde-fous',
    NODE_OPTIONS: `--require ${path.join(ICI, 'campagne.js')}`,
    API_BASE_URL: 'http://campagne.invalid',
    CAMPAGNE_APNS: `http://127.0.0.1:${portApns}`, CAMPAGNE_GOOGLE: `http://127.0.0.1:${portWeb}`,
  };
  const index = path.join(ICI, '..', '..', 'src', 'index.js');

  console.log('\n— 1. Le serveur de campagne refuse de démarrer');
  let r = await jouer([index], envCampagne);
  verifier('base sans marchand témoin : refus, sortie 1, jamais en écoute',
    [r.code, /REFUS : marchand témoin .* absent/.test(r.sortie), /démarré sur le port/.test(r.sortie)], [1, true, false]);
  r = await jouer([index], { ...envCampagne, API_BASE_URL: 'https://app.winwin-card.com' });
  verifier('API_BASE_URL de production : refus', [r.code, /REFUS : API_BASE_URL vise la production/.test(r.sortie)], [1, true]);
  r = await jouer([index], { ...envCampagne, API_BASE_URL: '' });
  verifier('API_BASE_URL absent (les cartes pointeraient vers la production) : refus', [r.code, /REFUS : API_BASE_URL absent/.test(r.sortie)], [1, true]);
  r = await jouer([index], { ...envCampagne, APPLE_SIGNER_KEY_B64: 'une-vraie-cle' });
  verifier('une vraie clé Apple fournie : refus', [r.code, /REFUS : APPLE_SIGNER_KEY_B64 est fourni/.test(r.sortie)], [1, true]);
  r = await jouer([index], { ...envCampagne, GOOGLE_SERVICE_ACCOUNT_JSON: '{}' });
  verifier('une vraie clé Google fournie : refus', [r.code, /REFUS : GOOGLE_SERVICE_ACCOUNT_JSON est fourni/.test(r.sortie)], [1, true]);
  r = await jouer([index], { ...envCampagne, SENTRY_DSN: 'https://cle@sentry.invalid/1' });
  verifier('SENTRY_DSN fourni : refus', [r.code, /REFUS : SENTRY_DSN est fourni/.test(r.sortie)], [1, true]);

  console.log('\n— 2. Le générateur refuse la production et un serveur sans témoin');
  const sentinelle = path.join(banc.TMP, 'sentinelle.js');
  fs.writeFileSync(sentinelle, `let n = 0; const f = globalThis.fetch;
    globalThis.fetch = (...a) => { n++; return f(...a); };
    process.on('exit', () => process.stderr.write('[sentinelle] appels réseau : ' + n + '\\n'));`);
  const generateur = path.join(ICI, 'generateur.js');
  r = await jouer([generateur], { CIBLE: 'https://app.winwin-card.com', JWT_SECRET: 'x', NODE_OPTIONS: `--require ${sentinelle}` });
  verifier('cible app.winwin-card.com : refus, sortie 2, ZÉRO requête envoyée',
    [r.code, /REFUS : https:\/\/app\.winwin-card\.com est la production/.test(r.sortie), (r.sortie.match(/appels réseau : (\d+)/) || [])[1]], [2, true, '0']);
  r = await jouer([generateur], { CIBLE: 'https://api.winwin-card.com', JWT_SECRET: 'x', NODE_OPTIONS: `--require ${sentinelle}` });
  verifier('sous-domaine de winwin-card.com : refus aussi, zéro requête', [r.code, (r.sortie.match(/appels réseau : (\d+)/) || [])[1]], [2, '0']);
  // Un serveur ordinaire (sans fichier de campagne) sur la base sans témoin.
  const ordinaire = await banc.demarrerServeur(urlSupabase, 'serveur-ordinaire');
  const avant = banc.psqlSocket('SELECT (SELECT count(*) FROM scans) + (SELECT count(*) FROM clients)');
  r = await jouer([generateur], { CIBLE: ordinaire.url, JWT_SECRET: banc.SECRET_JWT, CHARGE_SCENARIOS: 'scan,rush' });
  verifier('serveur sans marchand témoin : refus, sortie 3, rien écrit en base',
    [r.code, /REFUS : pas de marchand témoin/.test(r.sortie), banc.psqlSocket('SELECT (SELECT count(*) FROM scans) + (SELECT count(*) FROM clients)')],
    [3, true, avant]);
  ordinaire.processus.kill();
  await ordinaire.sortie;

  console.log('\n— 3. Depuis le serveur de test : Apple et Google redirigés, le reste bloqué');
  banc.psqlSocket(fs.readFileSync(path.join(__dirname, 'temoin.sql'), 'utf8'));
  const s = await banc.demarrerServeur(urlSupabase, 'serveur-campagne', envCampagne);
  verifier('avec le témoin : le serveur de campagne démarre', /\[campagne\] actif/.test(s.journal()), true);
  const sonde = q => fetch(`${s.url}/__campagne/sortie?${q}`, { headers: { 'x-campagne-cle': CLE } }).then(x => x.json());
  verifier('sonde sans la clé de campagne : 404 (introuvable de l\'extérieur)',
    (await fetch(`${s.url}/__campagne/sortie?url=https://example.com`)).status, 404);
  for (const [url, attendu] of [
    ['https://app.winwin-card.com/health', 'sortie bloquée vers app.winwin-card.com'],
    ['https://www.apple.com/', 'sortie bloquée vers www.apple.com'],
    ['https://example.com/', 'sortie bloquée vers example.com'],
  ]) {
    const x = await sonde(`url=${encodeURIComponent(url)}`);
    verifier(`fetch ${url} : bloqué`, x.resultat.includes(attendu), true);
  }
  let x = await sonde(`url=${encodeURIComponent('https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/test')}`);
  verifier('fetch walletobjects.googleapis.com : servi par l\'imitateur', [x.resultat, x.servi_par], ['réponse 200', 'imitateur']);
  x = await sonde(`url=${encodeURIComponent('https://oauth2.googleapis.com/token')}`);
  verifier('fetch oauth2.googleapis.com : servi par l\'imitateur', [x.resultat, x.servi_par], ['réponse 200', 'imitateur']);
  x = await sonde(`h2=${encodeURIComponent('https://api.push.apple.com')}`);
  verifier('HTTP/2 api.push.apple.com (APNs de production) : connecté à l\'imitateur', x.resultat, `connecté à 127.0.0.1:${portApns}`);
  x = await sonde(`h2=${encodeURIComponent('https://api.sandbox.push.apple.com')}`);
  verifier('HTTP/2 api.sandbox.push.apple.com : connecté à l\'imitateur', x.resultat, `connecté à 127.0.0.1:${portApns}`);
  x = await sonde(`h2=${encodeURIComponent('https://www.apple.com')}`);
  verifier('HTTP/2 vers un autre hôte : bloqué', x.resultat, '[campagne] sortie bloquée vers www.apple.com');
  // Sonde d'adresse (étape 17) : ici le banc est le dernier intermédiaire, donc
  // l'adresse qu'il annonce est retenue ; sans en-tête, celle de la connexion.
  const adresse = h => fetch(`${s.url}/__campagne/adresse`, { headers: { 'x-campagne-cle': CLE, ...h } }).then(y => y.json());
  x = await adresse({ 'X-Forwarded-For': '192.0.2.77' });
  verifier('sonde d\'adresse : X-Forwarded-For annoncé par le dernier intermédiaire → retenu (règle d\'Express, trust proxy 1)',
    [x.x_forwarded_for, x.ip_retenue], ['192.0.2.77', '192.0.2.77']);
  x = await adresse({ 'X-Forwarded-For': '198.51.100.9, 192.0.2.77' });
  verifier('sonde d\'adresse : seule la dernière entrée est crue (la première, falsifiable, est ignorée)', x.ip_retenue, '192.0.2.77');
  x = await adresse({});
  verifier('sonde d\'adresse : sans en-tête → adresse de la connexion', [x.x_forwarded_for, x.ip_retenue === x.connexion], [null, true]);
  // Version navigateur : clé dans l'adresse, pour la sonde d'adresse seulement.
  const brut = async u => { const y = await fetch(`${s.url}${u}`); return [y.status, y.status === 200 ? Boolean((await y.json()).ip_retenue) : null]; };
  verifier('sonde d\'adresse dans un navigateur : ?cle= juste → 200, adresse retenue rendue',
    await brut(`/__campagne/adresse?cle=${CLE}`), [200, true]);
  verifier('?cle= fausse, ou ?cle= sur une autre sonde → 404',
    [(await brut('/__campagne/adresse?cle=0000'))[0], (await brut(`/__campagne/mesures?cle=${CLE}`))[0]], [404, 404]);
  const mesures = await fetch(`${s.url}/__campagne/mesures`, { headers: { 'x-campagne-cle': CLE } }).then(y => y.json());
  verifier('les sorties bloquées sont comptées par hôte', mesures.sorties_bloquees,
    { 'app.winwin-card.com': 1, 'www.apple.com': 2, 'example.com': 1 });

  console.log('\n— 4. Le pilote : la sonde d\'adresse et son adresse pour le navigateur');
  const pilote = path.join(ICI, 'pilote.js');
  r = await jouer([pilote], { CAMPAGNE_ETAPE: 'adresse', CIBLE: s.url, CIBLE_PUBLIQUE: s.url, JWT_SECRET: banc.SECRET_JWT });
  const lien = (r.sortie.match(/navigateur \(wifi, puis 4G\) : (\S+)/) || [])[1] || '';
  verifier('pilote « adresse » : sonde jouée, sortie 0, adresse pour le navigateur qui répond 200',
    [r.code, /\nadresse : /.test(r.sortie), lien ? (await fetch(lien)).status : null], [0, true, 200]);
  r = await jouer([pilote], { CAMPAGNE_ETAPE: 'adresse', CIBLE: s.url, CIBLE_PUBLIQUE: s.url, JWT_SECRET: `${banc.SECRET_JWT}-faux` });
  verifier('pilote « adresse » avec un autre JWT_SECRET que le serveur : échec annoncé, aucune conclusion',
    [r.code !== 0, /SONDE D'ADRESSE EN ÉCHEC/.test(r.sortie), /\nadresse : /.test(r.sortie)], [true, true, false]);
  r = await jouer([pilote], { CAMPAGNE_ETAPE: 'attente' });
  const inconnue = await jouer([pilote], { CAMPAGNE_ETAPE: 'n\'importe quoi' });
  verifier('pilote « attente » : rien, sortie 0 ; étape inconnue : sortie 2', [r.code, inconnue.code], [0, 2]);

  console.log('\n— 5. La préparation de la base de test refuse toute autre base');
  // Connexion par mot de passe, comme la chaîne « Session pooler » de Supabase.
  banc.psqlSocket(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campagne_preparer') THEN
    CREATE ROLE campagne_preparer LOGIN SUPERUSER PASSWORD 'campagne_local'; END IF; END $$;`, 'postgres');
  const bases = { prod: `${banc.BASE}_prod`, autre: `${banc.BASE}_autre`, neuve: `${banc.BASE}_neuve`, cochee: `${banc.BASE}_cochee` };
  for (const b of Object.values(bases)) {
    banc.psqlSocket(`DROP DATABASE IF EXISTS ${b} WITH (FORCE)`, 'postgres');
    banc.psqlSocket(`CREATE DATABASE ${b}`, 'postgres');
  }
  // Le rôle de connexion endosse « postgres », comme la chaîne de Supabase : les
  // objets rejoués lui appartiennent, ce que la requête d'écarts vérifie.
  const preparer = (b, mode) => jouer([path.join(ICI, 'preparer.js')], { CAMPAGNE_MODE: mode,
    CAMPAGNE_DATABASE_URL: `postgresql://campagne_preparer:campagne_local@127.0.0.1:${process.env.PGPORT || 5432}/${b}?options=-c%20role%3Dpostgres` }, 180000);
  // « Production » simulée : des marchands, pas de témoin.
  banc.psqlSocket(`CREATE TABLE marchands (id uuid PRIMARY KEY, nom text);
    INSERT INTO marchands VALUES ('11111111-1111-4111-8111-111111111111', 'Vrai marchand')`, bases.prod);
  const empreinteProd = () => banc.psqlSocket(`SELECT (SELECT count(*) FROM pg_tables WHERE schemaname = 'public') || '|' || (SELECT string_agg(nom, ',') FROM marchands)`, bases.prod);
  const avantProd = empreinteProd();
  r = await preparer(bases.prod, 'temoin');
  const r2 = await preparer(bases.prod, 'donnees');
  verifier('base avec des marchands et sans témoin (la production) : refus, sortie 3, rien écrit (temoin comme donnees)',
    [r.code, /PAS une base de campagne/.test(r.sortie), r2.code, /PAS une base de campagne/.test(r2.sortie), empreinteProd()],
    [3, true, 3, true, avantProd]);
  banc.psqlSocket('CREATE TABLE autre (x int)', bases.autre);
  r = await preparer(bases.autre, 'temoin');
  verifier('base avec d\'autres tables, sans marchands : refus, sortie 3', [r.code, /ni une base neuve/.test(r.sortie)], [3, true]);
  r = await preparer(bases.neuve, 'donnees');
  verifier('base neuve en mode donnees (témoin exigé) : refus, sortie 3, rien écrit',
    [r.code, /faire d'abord l'étape temoin/.test(r.sortie), banc.psqlSocket(`SELECT count(*) FROM pg_tables WHERE schemaname = 'public'`, bases.neuve)],
    [3, true, '0']);
  // Base neuve « comme Supabase » : rôles et extensions déjà là, public vide.
  banc.psqlSocket(`ALTER DATABASE ${bases.neuve} SET search_path = "$user", public, extensions`, 'postgres');
  banc.psqlSocket('CREATE SCHEMA extensions; CREATE EXTENSION "uuid-ossp" SCHEMA extensions; CREATE EXTENSION pgcrypto SCHEMA extensions;', bases.neuve);
  r = await preparer(bases.neuve, 'temoin');
  verifier('base neuve, mode temoin : dépôt rejoué, témoin posé, requête d\'écarts « IDENTIQUE », sortie 0',
    [r.code, /dépôt rejoué : \d+ fichiers/.test(r.sortie), /VERDICT : base de test IDENTIQUE au dépôt/.test(r.sortie),
      banc.psqlSocket(`SELECT count(*) FROM marchands WHERE id = '${TEMOIN}'`, bases.neuve)], [0, true, true, '1']);
  r = await preparer(bases.neuve, 'temoin');
  verifier('relancé sur la base prête : rien rejoué, sortie 0', [r.code, /de campagne \(témoin présent\)/.test(r.sortie), /dépôt rejoué/.test(r.sortie)], [0, true, false]);

  console.log('\n— 6. Le pas « droits » : projet créé avec « Automatically expose new tables » coché');
  // Base neuve comme le projet de test du 05/10 : tout, d'office, aux trois rôles de l'API.
  banc.psqlSocket(`ALTER DATABASE ${bases.cochee} SET search_path = "$user", public, extensions`, 'postgres');
  banc.psqlSocket(`CREATE SCHEMA extensions; CREATE EXTENSION "uuid-ossp" SCHEMA extensions; CREATE EXTENSION pgcrypto SCHEMA extensions;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;`, bases.cochee);
  r = await preparer(bases.cochee, 'temoin');
  verifier('rejeu sur la base « case cochée » : ÉCART de 42 droits, comme le projet de test (sortie 1)',
    [r.code, /\|42 écart\(s\) · 48 plateforme\|/.test(r.sortie)], [1, true]);
  const droitAnon = () => banc.psqlSocket(`SELECT has_table_privilege('anon', 'public.clients', 'SELECT')`, bases.cochee);
  // Refus 1 : un objet a MOINS que la production → rien n'est fait, pas même les retraits.
  banc.psqlSocket('REVOKE INSERT ON public.scans FROM service_role', bases.cochee);
  r = await preparer(bases.cochee, 'droits');
  verifier('« droits » : un objet a moins que la production → refus, rien retiré (jamais d\'ajout)',
    [r.code, /MOINS que la production : scans → service_role/.test(r.sortie), droitAnon()], [1, true, 't']);
  banc.psqlSocket('GRANT INSERT ON public.scans TO service_role', bases.cochee);
  // Refus 2 : un écart hors des droits de données → hors du champ du pas.
  banc.psqlSocket('ALTER TABLE public.avis_clics DISABLE ROW LEVEL SECURITY', bases.cochee);
  r = await preparer(bases.cochee, 'droits');
  verifier('« droits » : un écart hors des droits (RLS) → refus, rien retiré',
    [r.code, /hors des droits de données/.test(r.sortie), droitAnon()], [1, true, 't']);
  banc.psqlSocket('ALTER TABLE public.avis_clics ENABLE ROW LEVEL SECURITY', bases.cochee);
  r = await preparer(bases.cochee, 'droits');
  verifier('« droits » : 42 retraits, table future sans droit, IDENTIQUE, sortie 0',
    [r.code, /42 retrait\(s\)/.test(r.sortie), /droits table\/séquence : anon=\/ authenticated=\/ service_role=\/$/m.test(r.sortie),
      /VERDICT : base de test IDENTIQUE/.test(r.sortie), droitAnon()], [0, true, true, true, 'f']);
  r = await preparer(bases.cochee, 'droits');
  verifier('« droits » relancé : 0 retrait, IDENTIQUE, sortie 0', [r.code, /0 retrait\(s\)/.test(r.sortie), /IDENTIQUE/.test(r.sortie)], [0, true, true]);
  r = await preparer(bases.prod, 'droits');
  verifier('« droits » sur la production simulée : refus, sortie 3', [r.code, /PAS une base de campagne/.test(r.sortie)], [3, true]);
  for (const b of Object.values(bases)) banc.psqlSocket(`DROP DATABASE IF EXISTS ${b} WITH (FORCE)`, 'postgres');

  imitateur.kill();
  const ok = resultats.filter(Boolean).length;
  console.log(`\n${ok}/${resultats.length} OK`);
  banc.nettoyer();
  process.exit(ok === resultats.length ? 0 : 1);
})().catch(e => {
  console.error(`\n[garde-fous] INTERROMPU : ${e.message}`);
  if (imitateur) imitateur.kill();
  banc.nettoyer();
  process.exit(2);
});
