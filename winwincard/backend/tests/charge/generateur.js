'use strict';

// ════════════════════════════════════════════════════════════════════════════
// GÉNÉRATEUR DE CHARGE (étape 15) — remplace scripts/load-test.js, qui visait la
// production et y créait de vrais clients.
//
// Garde-fous, dans cet ordre, AVANT toute requête :
//   1. la cible n'est pas winwin-card.com (refus immédiat, sortie 2) ;
//   2. le marchand témoin existe sur la cible (lecture publique) : sinon ce n'est
//      pas un serveur de campagne (sortie 3), et rien n'est écrit.
//
// Les requêtes arrivent au fil de l'eau (loi de Poisson), pas en rafales.
// Chaque boutique a UNE adresse (le wifi de ses caisses, X-Forwarded-For) ;
// les iPhones (imitateur) ont chacun la leur, en 4G. Le serveur les voit comme
// en production derrière l'entrée de Railway (trust proxy 1, index.js:25).
//
// Variables : CIBLE (adresse du serveur de test), JWT_SECRET (celui du TEST),
// IMITATEUR (adresse web de l'imitateur), CHARGE_PLAFOND (porteurs du marchand
// plafond, comme donnees.sql), CHARGE_SCENARIOS (liste), CHARGE_RYTHME
// (multiple de l'heure de pointe à 100 000 porteurs), CHARGE_DUREE_S,
// CHARGE_CIBLE_CAMPAGNE (reseau ou plafond), CHARGE_CAMPAGNE_S (durée
// d'observation de la campagne, 45 s), CHARGE_CRON_S, CIBLE_PUBLIQUE (adresse
// PUBLIQUE du serveur de test, pour la sonde d'adresse ; jamais la production).
// ════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const CIBLE = (process.env.CIBLE || '').replace(/\/$/, '');
const TEMOIN = 'c0ffee15-0000-4000-8000-000000000015';

// ── Garde-fou 1 : jamais la production ──────────────────────────────────────
let hote;
try { hote = new URL(CIBLE).hostname; } catch { console.error('[generateur] REFUS : CIBLE absente ou invalide'); process.exit(2); }
if (/(^|\.)winwin-card\.com$/i.test(hote)) {
  console.error(`[generateur] REFUS : ${CIBLE} est la production. Aucune requête envoyée.`);
  process.exit(2);
}

const PLAFOND = Number(process.env.CHARGE_PLAFOND || 5000);
const RYTHME = Number(process.env.CHARGE_RYTHME || 1);
const DUREE_S = Number(process.env.CHARGE_DUREE_S || 120);
const SCENARIOS = (process.env.CHARGE_SCENARIOS || 'scan,rush,dashboard,campagne,cron,wifi,adresse').split(',');
const CLE_CAMPAGNE = crypto.createHash('sha256').update(`${process.env.JWT_SECRET}:campagne`).digest('hex').slice(0, 32);

// ── Le parc factice (mêmes formules que donnees.sql) ────────────────────────
const commeUuid = t => { const h = crypto.createHash('md5').update(t).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };
const marchands = [
  { k: 1, nom: 'réseau', porteurs: 20000, points: true, boutiques: 15 },
  { k: 2, nom: 'plafond', porteurs: PLAFOND, points: false, boutiques: 0 },
  ...Array.from({ length: 84 }, (_, i) => ({ k: 3 + i, nom: `petit ${i + 1}`,
    porteurs: Math.floor((100000 - 20000 - PLAFOND) / 84), points: (i + 1) % 2 === 0, boutiques: 0 })),
].map(m => ({ ...m, id: commeUuid(`m-${m.k}`) }));
const jeton = (m, b) => jwt.sign(b
  ? { role: 'scanner', marchand_id: m.id, point_de_vente_id: commeUuid(`b-${b}`), tv: 1 }
  : { role: 'marchand', marchand_id: m.id, tv: 1 }, process.env.JWT_SECRET, { expiresIn: '2h' });
// Une adresse par boutique : le wifi des caisses (plages de documentation).
const wifi = (m, b) => (b ? `198.51.100.${b}` : `203.0.113.${m.k}`);

// Le tirage pondéré par le nombre de porteurs : l'heure de pointe suit le parc.
const totalPorteurs = marchands.reduce((n, m) => n + m.porteurs, 0);
function tirerMarchand() {
  let x = Math.random() * totalPorteurs;
  for (const m of marchands) { x -= m.porteurs; if (x < 0) return m; }
  return marchands[0];
}

// ── Mesure côté générateur ──────────────────────────────────────────────────
function quantiles(v) {
  const s = [...v].sort((a, b) => a - b);
  const q = p => (s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : null);
  return { n: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s.length ? Math.round(s[s.length - 1]) : null };
}
async function appel(methode, chemin, { jeton: j, corps, adresse, entetes = {} } = {}) {
  const t0 = performance.now();
  try {
    const r = await fetch(CIBLE + chemin, { method: methode, body: corps === undefined ? undefined : JSON.stringify(corps),
      headers: { 'Content-Type': 'application/json', ...(j ? { Authorization: `Bearer ${j}` } : {}),
        ...(adresse ? { 'X-Forwarded-For': adresse } : {}), ...entetes } });
    const texte = await r.text();
    let c; try { c = JSON.parse(texte); } catch { c = texte; }
    return { statut: r.status, corps: c, ms: performance.now() - t0 };
  } catch (e) {
    return { statut: `coupé (${(e.cause && e.cause.code) || e.message})`, corps: null, ms: performance.now() - t0 };
  }
}
const serveur = (chemin, raz) => appel('GET', `${chemin}${raz ? '?raz=1' : ''}`, { entetes: { 'x-campagne-cle': CLE_CAMPAGNE } });
const imitateur = raz => fetch(`${process.env.IMITATEUR}/__stats${raz ? '?raz=1' : ''}`).then(r => r.json());
const attendre = ms => new Promise(r => setTimeout(r, ms));

function scanAuHasard() {
  const m = tirerMarchand();
  const b = m.boutiques ? 1 + Math.floor(Math.random() * m.boutiques) : 0;
  const serial = commeUuid(`s-${m.k}-${1 + Math.floor(Math.random() * m.porteurs)}`);
  const corps = { serial_number: serial, cle_idempotence: crypto.randomUUID(), ...(m.points ? { points: 10 } : {}) };
  return appel('POST', '/api/scan', { jeton: jetonDe(m, b), corps, adresse: wifi(m, b) });
}
const jetons = new Map();
function jetonDe(m, b) { const c = `${m.k}-${b}`; if (!jetons.has(c)) jetons.set(c, jeton(m, b)); return jetons.get(c); }

// Arrivées au fil de l'eau : `parHeure` scans par heure pendant `secondes`.
async function flux(parHeure, secondes) {
  const fin = Date.now() + secondes * 1000;
  const enCours = [];
  while (Date.now() < fin) {
    enCours.push(scanAuHasard());
    await attendre(-Math.log(1 - Math.random()) * 3600000 / parHeure);
  }
  return Promise.all(enCours);
}
function bilanScans(r) {
  const statuts = {};
  for (const x of r) statuts[x.statut] = (statuts[x.statut] || 0) + 1;
  return { temps_ms: quantiles(r.filter(x => x.statut === 200).map(x => x.ms)), statuts };
}
// Heure de pointe à 100 000 porteurs : 2 700 à 3 850 scans par jour, 12 à 16 %
// dans l'heure (synthèse §5.1, 00b C5) : ≈ 620 scans par heure au haut de la fourchette.
const POINTE_PAR_HEURE = 620;

// ── Scénarios ───────────────────────────────────────────────────────────────
const SCENARIO = {
  // Le temps d'un scan seul, un après l'autre.
  async scan() {
    const r = [];
    for (let i = 0; i < 30; i++) r.push(await scanAuHasard());
    return { scans: bilanScans(r) };
  },
  // Heure de pointe : arrivées au fil de l'eau, iPhones qui reviennent (imitateur).
  async rush() {
    const r = await flux(POINTE_PAR_HEURE * RYTHME, DUREE_S);
    await attendre(8000);   // laisser les iPhones finir
    return { rythme_par_heure: POINTE_PAR_HEURE * RYTHME, scans: bilanScans(r) };
  },
  // Écrans du gérant du réseau, et du marchand plafond.
  async dashboard() {
    const res = {};
    for (const m of [marchands[0], marchands[1]]) {
      const j = jetonDe(m, 0);
      for (const chemin of ['/api/merchants/me/stats', '/api/merchants/me/group-stats', '/api/clients', '/api/scan']) {
        const r = await appel('GET', chemin, { jeton: j, adresse: wifi(m, 0) });
        res[`${m.nom} ${chemin}`] = { statut: r.statut, ms: Math.round(r.ms),
          lignes: Array.isArray(r.corps) ? r.corps.length : (r.corps && Array.isArray(r.corps.clients) ? r.corps.clients.length : undefined) };
      }
    }
    return res;
  },
  // Campagne vers tous les porteurs d'un marchand (le réseau, ou le marchand
  // plafond), pendant des scans ordinaires.
  async campagne() {
    const m = process.env.CHARGE_CIBLE_CAMPAGNE === 'plafond' ? marchands[1] : marchands[0];
    const pendant = flux(POINTE_PAR_HEURE * Math.max(RYTHME, 3), Number(process.env.CHARGE_CAMPAGNE_S || 45));
    await attendre(3000);
    const c = await appel('POST', '/api/notifications', { jeton: jetonDe(m, 0),
      corps: { message: 'Campagne de test (étape 15)' }, adresse: wifi(m, 0) });
    const r = await pendant;
    await attendre(8000);
    return { campagne: { marchand: m.nom, statut: c.statut, ms: Math.round(c.ms), apple: c.corps && c.corps.apple, google: c.corps && c.corps.google },
      scans_pendant: bilanScans(r) };
  },
  // Un passage COMPLET du cron, pendant des scans ordinaires. La fin se lit sur
  // /health/cron (début et fin du passage). CHARGE_CRON_S borne l'observation :
  // au-delà, le passage continue sans être attendu (on en garde le débit).
  async cron() {
    const borne = Number(process.env.CHARGE_CRON_S || 0);
    const depart = Date.now();
    await appel('POST', '/__campagne/cron', { entetes: { 'x-campagne-cle': CLE_CAMPAGNE } });
    const r = await flux(POINTE_PAR_HEURE * Math.max(RYTHME, 1), borne || 60);
    let etat;
    do {
      etat = (await appel('GET', '/health/cron')).corps || {};
      if (etat.fin && new Date(etat.debut).getTime() >= depart - 5000) break;
      if (borne) break;
      await attendre(10000);
    } while (true);
    return { cron: etat.fin ? { duree_s: Math.round((new Date(etat.fin) - new Date(etat.debut)) / 1000) }
      : { en_cours_apres_s: Math.round((Date.now() - depart) / 1000) }, scans_pendant: bilanScans(r) };
  },
  // Limiteur : les caisses d'une boutique derrière UNE adresse.
  // Adresse neuve (aucune requête avant) : le compteur part de zéro.
  async wifi() {
    const m = marchands[0];
    const r = [];
    for (let i = 0; i < 320; i++) {
      const serial = commeUuid(`s-${m.k}-${1 + (i % m.porteurs)}`);
      r.push(await appel('POST', '/api/scan', { jeton: jetonDe(m, 1), adresse: '198.51.100.200',
        corps: { serial_number: serial, cle_idempotence: crypto.randomUUID(), points: 5 } }));
    }
    const premier429 = r.findIndex(x => x.statut === 429);
    return { requetes: r.length, premier_refus_429_a: premier429 < 0 ? null : premier429 + 1, statuts: bilanScans(r).statuts };
  },
  // Contournement de l'adresse (étape 17, prioritaire) : la machine annonce une
  // fausse adresse ; la sonde dit ce que le serveur a reçu et ce qu'Express en
  // retient. Contre CIBLE_PUBLIQUE (l'entrée publique de Railway) au temps 2 ;
  // sur le banc local, le générateur EST le dernier proxy : rien n'y est prouvé.
  async adresse() {
    const publique = (process.env.CIBLE_PUBLIQUE || '').replace(/\/$/, '');
    if (publique && /(^|\.)winwin-card\.com$/i.test(new URL(publique).hostname)) throw new Error('CIBLE_PUBLIQUE vise la production');
    const base = publique || CIBLE;
    const r = await fetch(`${base}/__campagne/adresse`, { headers: { 'x-campagne-cle': CLE_CAMPAGNE, 'X-Forwarded-For': '192.0.2.77' } })
      .then(x => x.json()).catch(e => ({ erreur: e.message }));
    const ip = r.ip_retenue || '';
    const conclusion = !publique ? 'banc local : non probant (le générateur est le dernier proxy)'
      : ip === '192.0.2.77' ? 'CONTOURNABLE : le limiteur suit l\'adresse annoncée par le client'
      : /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|fd|fc|::ffff:10\.)/i.test(ip)
        ? 'ADRESSE PARTAGÉE : le limiteur voit un proxy interne, tous les clients dans un seul compteur'
        : 'adresse réelle du client : non contournable par cet en-tête';
    return { cible: base, recu: r, conclusion };
  },
};

// ── Résumé court, à recopier depuis les journaux (une ligne par mesure) ────
function resume(nom, g, srv, imit) {
  const q = x => (x ? `méd ${x.p50} · p95 ${x.p95} · p99 ${x.p99} · max ${x.max} ms (n=${x.n})` : '—');
  const l = [`== ${nom}`];
  const scans = g.scans || g.scans_pendant;
  if (scans) l.push(`caisse, scan vu du générateur : ${q(scans.temps_ms)} ; statuts ${JSON.stringify(scans.statuts)}`);
  if (g.campagne) l.push(`campagne ${g.campagne.marchand} : ${g.campagne.ms} ms, Apple ${JSON.stringify(g.campagne.apple)}, Google ${JSON.stringify(g.campagne.google)}`);
  if (g.cron) l.push(`cron : ${JSON.stringify(g.cron)}`);
  if (g.conclusion) l.push(`adresse : ${g.conclusion} ; reçu ${JSON.stringify(g.recu)}`);
  if (g.premier_refus_429_a !== undefined) l.push(`limiteur : ${g.requetes} requêtes, premier 429 à la ${g.premier_refus_429_a} ; ${JSON.stringify(g.statuts || g.conclusion_locale)}`);
  if (nom === 'dashboard') for (const [k, v] of Object.entries(g)) l.push(`${k} : ${v.statut}, ${v.ms} ms${v.lignes !== undefined ? `, ${v.lignes} lignes` : ''}`);
  if (srv && srv.mesures) {
    l.push(`serveur : boucle méd ${srv.boucle_ms.p50} · p99 ${srv.boucle_ms.p99} · max ${srv.boucle_ms.max} ms ; mémoire max ${srv.memoire_mo.rss_max} Mo ; sorties bloquées ${JSON.stringify(srv.sorties_bloquees)}`);
    for (const k of ['POST /api/scan', 'POST /api/notifications', 'GET /v1/passes', 'base ', 'carte apple', 'rendu bandeau', 'push apple', 'google message']) {
      const cles = Object.keys(srv.mesures).filter(c => c.startsWith(k));
      if (k === 'base ') {
        const toutes = cles.flatMap(c => [srv.mesures[c]]);
        const n = toutes.reduce((a, x) => a + x.n, 0);
        if (n) l.push(`serveur, requêtes base : ${n}, méd la plus haute ${Math.max(...toutes.map(x => x.p50))} ms, max ${Math.max(...toutes.map(x => x.max))} ms`);
      } else for (const c of cles) l.push(`serveur, ${c} : ${q(srv.mesures[c])}${srv.mesures[c].statuts ? ` ${JSON.stringify(srv.mesures[c].statuts)}` : ''}`);
    }
  }
  if (imit) l.push(`imitateur : APNs ${imit.apns.recus} (refus ${imit.apns.refuses}, abandonnés par le serveur ${imit.apns.abandonnes || 0}), iPhones ${imit.iphones.reveils} réveils, cartes 200 ${imit.iphones.cartes_200} / 304 ${imit.iphones.cartes_304}, erreurs ${JSON.stringify(imit.iphones.erreurs)}`);
  console.log(l.join('\n'));
}

(async () => {
  // ── Garde-fou 2 : le témoin, avant toute écriture ─────────────────────────
  const t = await appel('GET', '/api/merchants/temoin-campagne-15/public');
  if (t.statut !== 200 || !t.corps || t.corps.id !== TEMOIN) {
    console.error(`[generateur] REFUS : pas de marchand témoin sur ${CIBLE} (statut ${t.statut}). Rien n'a été écrit.`);
    process.exit(3);
  }
  console.log(`[generateur] cible ${CIBLE} : témoin présent ; plafond ${PLAFOND} porteurs, rythme ×${RYTHME}`);
  await serveur('/__campagne/mesures', true);
  if (process.env.IMITATEUR) await imitateur(true);
  for (const nom of SCENARIOS) {
    const resultat = await SCENARIO[nom]();
    const cote = await serveur('/__campagne/mesures', true);
    const imit = process.env.IMITATEUR ? await imitateur(true) : null;
    console.log(JSON.stringify({ scenario: nom, generateur: resultat, serveur: cote.corps, imitateur: imit }));
    resume(nom, resultat, cote.corps, imit);
  }
})().catch(e => { console.error(`[generateur] échec : ${e.message}`); process.exit(1); });
