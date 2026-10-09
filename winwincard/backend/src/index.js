require('dotenv').config();

// Sentry — initialisé en tout premier (avant express) pour l'auto-instrumentation.
// SENTRY_DSN est optionnel : absent → Sentry désactivé, le serveur tourne sans.
const { Sentry, sentryEnabled } = require('./instrument');

// Vérification des secrets critiques au boot — crash immédiat avec message explicite
// si absents, plutôt que démarrer en mode non sécurisé.
// SENTRY_DSN est volontairement hors de cette liste : c'est une variable optionnelle.
const REQUIRED_ENV = ['JWT_SECRET', 'ADMIN_PASSWORD', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
const missingEnv   = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`[boot] Variables d'environnement obligatoires manquantes : ${missingEnv.join(', ')}`);
  process.exit(1);
}

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { gardeAdresse, RELAIS_ATTENDUS } = require('./middleware/gardeAdresse');

const app = express();
// Railway / reverse proxy — requis pour rate limiting par IP réelle.
// 2 relais de confiance : l'entrée de Railway écrit « client, relais » dans X-Forwarded-For
// (mesuré le 07/10). Avec 1, Express retenait le relais et tous les clients d'un relais
// partageaient un compteur. La garde ci-dessous alerte si ce nombre change.
app.set('trust proxy', RELAIS_ATTENDUS);
app.use(gardeAdresse());

// ── Sécurité & middlewares ───────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // la landing page charge des ressources externes (logos marchands)
}));
app.use(cors({
  origin: [
    'https://app.winwin-card.com',
    ...(process.env.NODE_ENV === 'development' ? ['http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003'] : [])
  ],
  credentials: true
}));
app.use(express.json({ limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate limiting global
// message : réponse en JSON, comme les autres limiteurs (étape 12a). Sans lui,
// la bibliothèque répond en texte et les écrans de caisse affichaient une
// « erreur réseau » illisible. Délai avant réouverture : en-têtes RateLimit-*.
// skip /v1/ (étape 17) : le service web Apple a son propre limiteur
// (limiterAppleWallet) ; les iPhone d'un Wi-Fi de boutique n'usent plus le
// compteur de la caisse.
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
  skip: req => req.path.startsWith('/v1/'),
}));

// Rate limiters dédiés (anti brute-force logins).
// limiterInscription est appliqué directement sur POST /api/clients (dans clients.js),
// pas au niveau du routeur, pour ne pas pénaliser les lectures du dashboard.
const { limiterAdminLogin, limiterMarchandLogin, limiterScannerLogin, limiterAppleWallet } = require('./middleware/rateLimiters');

// ── Routes ───────────────────────────────────────────────────
const appleWalletRoutes   = require('./routes/apple-wallet');
const googleWalletRoutes  = require('./routes/google-wallet');
const clientsRoutes       = require('./routes/clients');
const scanRoutes          = require('./routes/scan');
const merchantsRoutes     = require('./routes/merchants');
const notificationsRoutes = require('./routes/notifications');
const adminRoutes         = require('./routes/admin');
const passesRoutes        = require('./routes/passes');
const landingRoutes       = require('./routes/landing');
const scannerRoutes       = require('./routes/scanner');
const dashboardRoutes     = require('./routes/dashboard');
const adminUiRoutes       = require('./routes/admin-ui');
const workflowsRoutes     = require('./routes/workflows');
const scannerAuthRoutes   = require('./routes/scanner-auth');
const avisRoutes          = require('./routes/avis');
const diagRoutes          = require('./routes/diag');   // instrument temporaire (palier 0.5)

// Fichiers statiques — HTML servi avec no-cache pour garantir la fraîcheur PWA
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
  },
}));

// Raccourci démo
app.get('/demo', (req, res) => res.redirect(301, '/l/demo'));

// Landing pages marchands
app.use('/l', landingRoutes);

// Lien d'avis Google imprimé au dos des cartes — public, sans authentification :
// il est ouvert depuis le pass d'un client. Redirige et compte le clic.
app.use('/avis', avisRoutes);

// PWA Scanner
app.use('/scanner', scannerRoutes);

// Dashboard marchand
app.use('/dashboard', dashboardRoutes);

// Espace admin (Yacine)
app.use('/admin', adminUiRoutes);

// Apple Wallet WebService — chemins standards Apple, pas de préfixe /api
// Limiteur propre, /v1/log compris (étape 17). File des retours d'iPhone,
// priorité aux caisses (t37, middleware/fileAppleWallet.js).
app.use('/v1', limiterAppleWallet, require('./middleware/fileAppleWallet').fileAppleWallet);
app.use('/', appleWalletRoutes);

// API REST
app.use('/api/passes', passesRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/scan', scanRoutes);
app.use('/api/scanner/login', limiterScannerLogin);
app.use('/api/scanner', scannerAuthRoutes);
app.use('/api/merchants/login', limiterMarchandLogin);
app.use('/api/merchants', merchantsRoutes);
app.use('/api/google-wallet', googleWalletRoutes);
app.use('/api/notifications', notificationsRoutes);
// Diagnostic caméra — instrument temporaire, isolé de tout le reste.
// Le POST est public (limiteur dédié dans le routeur), le GET est authAdmin.
app.use('/api/diag', diagRoutes);

app.use('/api/admin/login', limiterAdminLogin);
app.use('/api/admin/workflows', workflowsRoutes);
app.use('/api/admin', adminRoutes);

// ── Santé ────────────────────────────────────────────────────
// /health : le process répond. Sonde externe (UptimeRobot) — ne touche pas la base.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), node: process.version });
});

// /health/db : healthcheck de DÉPLOIEMENT de Railway (tableau de bord : Settings →
// Healthcheck Path, depuis le retrait de railway.toml le 04/10). Une version
// qui ne lit pas la base avec les droits du serveur est refusée, et Railway garde
// la version en place. Sont refusées :
//   - clé fausse, révoquée, ou base injoignable → erreur de lecture ;
//   - clé PUBLIQUE (anon / sb_publishable_) : elle joint la base, mais la RLS lui
//     cache tout (liste vide ou refus). D'où l'exigence d'UNE ligne, pas d'une
//     réponse sans erreur ;
//   - base qui ne répond pas en DELAI_SANTE_BASE_MS (réessais compris).
// HYPOTHÈSES — ce qui ferait casser ce contrôle :
//   - `marchands` n'est jamais vide (vrai en production) : une base neuve sans
//     aucun marchand fait échouer tout déploiement ;
//   - la clé publique ne voit aucune ligne de `marchands` : une policy qui l'y
//     ouvrirait en lecture rendrait ce contrôle aveugle à la clé publique.
// Railway n'appelle cette route qu'au déploiement : ce n'est pas une supervision.
const supabase = require('./services/supabase');
const DELAI_SANTE_BASE_MS = 5000;

app.get('/health/db', async (req, res) => {
  try {
    // §3.9 : supabase-js ne rejette jamais — on lit `error`.
    const { data, error } = await supabase
      .from('marchands')
      .select('id')
      .limit(1)
      .abortSignal(AbortSignal.timeout(DELAI_SANTE_BASE_MS));

    if (error) {
      console.error('[health/db] lecture impossible :', error.message);
      return res.status(503).json({ status: 'error', cause: 'lecture_impossible' });
    }
    if (!Array.isArray(data) || data.length === 0) {
      console.error('[health/db] aucune ligne lue — clé sans les droits du serveur ?');
      return res.status(503).json({ status: 'error', cause: 'aucune_ligne' });
    }
    res.json({ status: 'ok' });
  } catch (e) {
    console.error('[health/db] échec :', e.message);
    res.status(503).json({ status: 'error', cause: 'exception' });
  }
});

// /health/cron : le passage planifié du cron (08:00 UTC) a-t-il démarré, et
// fini sans erreur ? Surveillé par UptimeRobot : un 503 déclenche l'alerte.
// Causes : pas_demarre (aucune ligne 10 min après 08:00), pas_fini (toujours en
// cours 60 min après), erreurs (une étape a levé), lecture_impossible.
// Avant 08:10 UTC, c'est le passage de la VEILLE qui est jugé. Décision et
// hypothèses : services/cron-passages.js. Rien d'autre n'est exposé (le bilan
// des envois reste en base).
const cronPassages = require('./services/cron-passages');

app.get('/health/cron', async (req, res) => {
  const e = await cronPassages.etat();   // ne rejette jamais
  res.status(e.ok ? 200 : 503).json({
    status: e.ok ? 'ok' : 'error', cause: e.cause, attendu: e.attendu,
    debut: e.debut ?? null, fin: e.fin ?? null,
  });
});

// ── Erreurs ──────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Capture Sentry — doit être enregistré APRÈS les routes et AVANT le handler
// d'erreurs custom. No-op si SENTRY_DSN absent (Sentry non initialisé).
if (sentryEnabled) {
  Sentry.setupExpressErrorHandler(app);
}

// Gestionnaire d'erreurs global — reçoit les rejets transmis par asyncHandler.
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err); // délègue au handler par défaut d'Express
  res.status(500).json({ error: 'Internal server error' });
});

// ── Cron workers (workflows automatisés Pro+) ────────────────
// NB: chargé APRÈS app.listen pour ne pas bloquer le bind de port.
// Un échec du cron ne doit jamais empêcher le serveur de démarrer.

// ── Démarrage ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const serveur = app.listen(PORT, () => {
  console.log(`WinWin Card API démarré sur le port ${PORT}`);
  try {
    require('./workers/cron');
    console.log('[cron] Workflows planifiés (08:00 UTC quotidien)');
  } catch (e) {
    console.error('[cron] Échec initialisation — workflows désactivés:', e.message);
  }
  // Campagnes interrompues par un arrêt : reprises UNE fois, après un délai (t37).
  require('./services/campagnes').planifierReprise();
});

// ── Arrêt propre au redéploiement (étape 14a, services/arret.js) ─
// SIGTERM de Railway : plus de passage du cron, les requêtes et les envois en
// cours finissent (20 s au plus), puis sortie. Les demandes d'avis en mémoire
// sont perdues (décision 4 a) : comptées dans le bilan.
require('./services/arret').brancher(serveur, {
  avantFermeture: () => {
    require('./workers/cron').arreterPlanification();
    require('./services/campagnes').arreter();   // plus de nouveau lot (t37)
  },
  bilan: () => ({ "demande(s) d'avis perdue(s)": require('./services/avis').enAttenteCount() }),
});

module.exports = app;
