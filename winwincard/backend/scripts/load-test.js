#!/usr/bin/env node
// ============================================================
// WinWin Card — Test de charge simple
//
// Simule deux rafales concurrentes :
//   1. 20 inscriptions simultanées sur une landing page (POST /api/clients)
//   2. 20 scans simultanés (POST /api/scan)
//
// Pour chaque phase, affiche : temps de réponse moyen / min / max,
// le nombre de succès et le nombre d'erreurs.
//
// Utilise le fetch natif de Node.js (>= 18, ici v22).
//
// Usage :
//   BASE_URL=https://app.winwin-card.com \
//   MARCHAND_SLUG=kasa-grill \
//   SCANNER_TOKEN=<jwt marchand ou scanner> \
//   node scripts/load-test.js
//
// Variables :
//   BASE_URL       URL du backend            (défaut http://localhost:3000)
//   MARCHAND_SLUG  slug de la landing testée (défaut demo)
//   CONCURRENCY    nombre de requêtes/rafale (défaut 20)
//   SCANNER_TOKEN  JWT pour POST /api/scan.  Si absent, la phase scans est
//                  ignorée (les inscriptions ne nécessitent pas d'auth).
// ============================================================

const BASE_URL      = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const MARCHAND_SLUG = process.env.MARCHAND_SLUG || 'demo';
const CONCURRENCY   = parseInt(process.env.CONCURRENCY, 10) || 20;
const SCANNER_TOKEN = process.env.SCANNER_TOKEN || null;

// ── Exécute une requête en mesurant son temps de réponse ──────────
async function timedRequest(fn) {
  const start = performance.now();
  try {
    const res  = await fn();
    const ms    = performance.now() - start;
    const ok    = res.ok;
    let body    = null;
    try { body = await res.json(); } catch { /* réponse non-JSON */ }
    return { ok, status: res.status, ms, body };
  } catch (err) {
    return { ok: false, status: 0, ms: performance.now() - start, error: err.message };
  }
}

// ── Agrège et affiche les résultats d'une phase ───────────────────
function report(label, results) {
  const times    = results.map(r => r.ms);
  const succes   = results.filter(r => r.ok);
  const erreurs  = results.filter(r => !r.ok);
  const avg      = times.reduce((a, b) => a + b, 0) / (times.length || 1);
  const min      = Math.min(...times);
  const max      = Math.max(...times);

  console.log(`\n── ${label} ──`);
  console.log(`  Requêtes      : ${results.length}`);
  console.log(`  Succès        : ${succes.length}`);
  console.log(`  Erreurs       : ${erreurs.length}`);
  console.log(`  Temps moyen   : ${avg.toFixed(1)} ms`);
  console.log(`  Temps min/max : ${min.toFixed(1)} ms / ${max.toFixed(1)} ms`);

  if (erreurs.length > 0) {
    // Regroupe les erreurs par (status + message) pour un diagnostic lisible
    const buckets = {};
    for (const e of erreurs) {
      const key = e.error ? `network: ${e.error}` : `HTTP ${e.status}: ${e.body?.error || '?'}`;
      buckets[key] = (buckets[key] || 0) + 1;
    }
    console.log('  Détail erreurs :');
    for (const [key, n] of Object.entries(buckets)) console.log(`    × ${n}  ${key}`);
  }

  return { succes, erreurs };
}

// ── Phase 1 : inscriptions simultanées ────────────────────────────
async function phaseInscriptions() {
  const tasks = Array.from({ length: CONCURRENCY }, (_, i) =>
    timedRequest(() => fetch(`${BASE_URL}/api/clients`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ prenom: `LoadTest${i}`, marchand_slug: MARCHAND_SLUG }),
    }))
  );

  const results = await Promise.all(tasks);
  const { succes } = report(`Inscriptions (${CONCURRENCY} simultanées) → /api/clients`, results);

  // Récupère les serial_number créés pour alimenter la phase scans
  return succes.map(r => r.body?.serial_number).filter(Boolean);
}

// ── Phase 2 : scans simultanés ────────────────────────────────────
async function phaseScans(serialNumbers) {
  if (!SCANNER_TOKEN) {
    console.log('\n── Scans → /api/scan ──');
    console.log('  Ignoré : SCANNER_TOKEN non fourni (le scan nécessite une authentification).');
    return;
  }
  if (serialNumbers.length === 0) {
    console.log('\n── Scans → /api/scan ──');
    console.log('  Ignoré : aucune inscription réussie pour fournir un serial_number.');
    return;
  }

  // Lance CONCURRENCY scans en réutilisant cycliquement les serials disponibles
  const tasks = Array.from({ length: CONCURRENCY }, (_, i) => {
    const serial = serialNumbers[i % serialNumbers.length];
    return timedRequest(() => fetch(`${BASE_URL}/api/scan`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${SCANNER_TOKEN}`,
      },
      body: JSON.stringify({ serial_number: serial }),
    }));
  });

  const results = await Promise.all(tasks);
  report(`Scans (${CONCURRENCY} simultanés) → /api/scan`, results);
}

// ── Exécution ─────────────────────────────────────────────────────
(async () => {
  console.log('WinWin Card — Test de charge');
  console.log(`  Cible       : ${BASE_URL}`);
  console.log(`  Marchand    : ${MARCHAND_SLUG}`);
  console.log(`  Concurrence : ${CONCURRENCY} requêtes par rafale`);

  const serials = await phaseInscriptions();
  await phaseScans(serials);

  console.log('\nTerminé.');
})().catch(err => {
  console.error('\nÉchec du test de charge :', err.message);
  process.exit(1);
});
