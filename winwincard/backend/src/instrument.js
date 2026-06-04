// Initialisation Sentry — DOIT être require() tout en haut de index.js,
// avant express et les autres modules, pour que l'auto-instrumentation
// puisse patcher les bibliothèques au chargement.
//
// SENTRY_DSN est optionnel : s'il est absent, Sentry reste désactivé et le
// serveur tourne normalement sans aucune capture.
const Sentry = require('@sentry/node');

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    // Pas de tracing de performance en V1 — uniquement la capture d'erreurs.
    tracesSampleRate: 0,
  });
  console.log('[sentry] Monitoring activé');
} else {
  console.log('[sentry] SENTRY_DSN absent — monitoring désactivé');
}

module.exports = { Sentry, sentryEnabled: !!dsn };
