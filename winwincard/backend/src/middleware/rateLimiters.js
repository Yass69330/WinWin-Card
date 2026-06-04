const rateLimit = require('express-rate-limit');

// Anti-spam inscription client — appliqué uniquement sur POST /api/clients
const limiterInscription = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 20,
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

module.exports = { limiterInscription, limiterAdminLogin, limiterMarchandLogin };
