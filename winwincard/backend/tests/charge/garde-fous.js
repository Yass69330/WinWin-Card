'use strict';

// ════════════════════════════════════════════════════════════════════════════
// PREUVE DES GARDE-FOUS DE LA CAMPAGNE (étape 15) — sur le banc local.
//   1. Le serveur chargé du fichier de campagne refuse de démarrer : base sans
//      marchand témoin, API_BASE_URL de production, vraie clé fournie, Sentry.
//   2. Le générateur refuse winwin-card.com sans envoyer une seule requête, et
//      refuse un serveur sans témoin sans rien écrire.
//   3. Depuis le serveur de test : Apple et Google arrivent à l'imitateur, la
//      production et tout autre hôte sont bloqués.
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
  banc.psqlSocket(`INSERT INTO marchands (id, nom, slug, forfait, type_programme, max_value, display_max_value, langue)
    VALUES ('${TEMOIN}', 'Témoin campagne 15', 'temoin-campagne-15', 'basic', 'stamps', 10, 10, 'fr')`);
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
  const mesures = await fetch(`${s.url}/__campagne/mesures`, { headers: { 'x-campagne-cle': CLE } }).then(y => y.json());
  verifier('les sorties bloquées sont comptées par hôte', mesures.sorties_bloquees,
    { 'app.winwin-card.com': 1, 'www.apple.com': 2, 'example.com': 1 });

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
