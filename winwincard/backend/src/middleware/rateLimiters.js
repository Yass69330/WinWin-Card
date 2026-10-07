const rateLimit = require('express-rate-limit');

// Anti-spam inscription client — appliqué uniquement sur POST /api/clients.
// 60 par heure et par adresse (étape 17a, décision du 07/10 ; 20 avant). Avec la vraie
// adresse du client, les clients d'une même boutique (Wi-Fi) ou d'un même opérateur
// (4G) partagent ce compteur. Mesuré en production sur 30 jours : jusqu'à 14
// inscriptions en une heure pour un marchand. 60 = environ 4 fois ce maximum ; en
// dessous de 12 par heure en usage normal, le garde-fou ne vise que l'abus.
const limiterInscription = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 60,
  message: { error: 'Too many attempts, please try again in an hour' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Anti brute-force login admin
const limiterAdminLogin = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 10,
  message: { error: 'Too many attempts, please try again in an hour' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Anti brute-force login marchand (même politique que l'admin) : 10 par heure,
// réussites et 4xx comptées. Étape 17 : un 5xx (base lente ou en panne, 503)
// n'est PAS compté (skipFailedRequests, « échec » = statut ≥ 500 ici) : sinon
// dix essais pendant une panne bloqueraient le dashboard une heure.
const limiterMarchandLogin = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 10,
  skipFailedRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode < 500,
  message: { error: 'Too many attempts, please try again in an hour' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Anti brute-force login scanner (boutique ou marchand mono-site). Étape 17 :
// 20 ÉCHECS par heure et par adresse ; une connexion réussie n'est jamais
// comptée (skipSuccessfulRequests), une caissière qui se connecte bien n'use
// donc pas le compteur. Échec = réponse 4xx (identifiants faux, boutique
// coupée, 429 compris). Un 5xx (base lente ou en panne, 503) n'est PAS un
// échec : sinon une panne de base bloquerait les caisses une heure après son
// retour. Limite acceptée (07/10) : les échecs d'un collègue sur la même
// adresse comptent pour tous.
const limiterScannerLogin = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 20,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode < 400 || res.statusCode >= 500,
  message: { error: 'Too many attempts, please try again in an hour' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Service web Apple Wallet (/v1/devices, /v1/passes, /v1/log) — étape 17.
// Limite propre, hors du limiteur global (index.js) : un iPhone fait ≈ 3,6
// requêtes par push (mesure de l'étape 15), 1 000 par 15 min ≈ 270 iPhone
// synchronisés derrière une même adresse. Un 429 retarde la mise à jour d'une
// carte (l'iPhone réessaie), il ne bloque aucun scan.
const limiterAppleWallet = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 1000,
  message: { error: 'rate_limited' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Diagnostic caméra (palier 0.5) — endpoint PUBLIC : un employé ouvre la page
// sans être connecté à rien. Généreux pour ne jamais rater une mesure légitime
// (on peut relancer plusieurs fois sur une même tablette), assez serré pour
// qu'on ne puisse pas remplir la table.
const limiterDiag = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de mesures envoyées, réessayez plus tard' },
});

module.exports = { limiterInscription, limiterAdminLogin, limiterMarchandLogin, limiterScannerLogin, limiterDiag, limiterAppleWallet };
