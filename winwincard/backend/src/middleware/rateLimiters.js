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

// Anti brute-force login marchand (même politique que l'admin)
const limiterMarchandLogin = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 10,
  message: { error: 'Too many attempts, please try again in an hour' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Anti brute-force login scanner (boutique ou marchand mono-site). Max un peu
// plus haut que les autres : l'IP d'un comptoir de boutique est partagée par
// plusieurs vendeurs, mais le login reste rare (token 1 an).
const limiterScannerLogin = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 20,
  message: { error: 'Too many attempts, please try again in an hour' },
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

module.exports = { limiterInscription, limiterAdminLogin, limiterMarchandLogin, limiterScannerLogin, limiterDiag };
