require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
app.set('trust proxy', 1); // Railway / reverse proxy — requis pour rate limiting par IP réelle

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
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 300,
  standardHeaders: true,
  legacyHeaders: false
}));

// Rate limiting strict sur l'inscription (anti-spam)
const limiterInscription = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 20,
  message: { error: 'Too many attempts, please try again in an hour' }
});

// Rate limiting strict sur le login admin (anti brute-force)
const limiterAdminLogin = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 10,
  message: { error: 'Too many attempts, please try again in an hour' }
});

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

// Fichiers statiques (landing page HTML)
app.use(express.static(path.join(__dirname, '../public')));

// Raccourci démo
app.get('/demo', (req, res) => res.redirect(301, '/l/demo'));

// Landing pages marchands
app.use('/l', landingRoutes);

// PWA Scanner
app.use('/scanner', scannerRoutes);

// Dashboard marchand
app.use('/dashboard', dashboardRoutes);

// Espace admin (Yacine)
app.use('/admin', adminUiRoutes);

// Apple Wallet WebService — chemins standards Apple, pas de préfixe /api
app.use('/', appleWalletRoutes);

// API REST
app.use('/api/passes', passesRoutes);
app.use('/api/clients', limiterInscription, clientsRoutes);
app.use('/api/scan', scanRoutes);
app.use('/api/merchants', merchantsRoutes);
app.use('/api/google-wallet', googleWalletRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/admin/login', limiterAdminLogin);
app.use('/api/admin', adminRoutes);

// ── Santé ────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), node: process.version });
});

// ── Erreurs ──────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Démarrage ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`WinWin Card API démarré sur le port ${PORT}`);
});

module.exports = app;
