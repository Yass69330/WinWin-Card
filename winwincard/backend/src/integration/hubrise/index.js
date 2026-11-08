// ════════════════════════════════════════════════════════════════════════════
// ZONE INTÉGRATION — Hubrise (France / UE) — docs/hubrise/
//
// H1a (06/11) : connexion d'un marchand (OAuth), jeton chiffré, admin.
//   oauth.js   /integrations/hubrise/connexion, /integrations/hubrise/retour
//   admin.js   /api/admin/marchands/:id/hubrise…, /api/admin/hubrise/connexions/:id/couper
// H1b (08/11) : abonnement aux ventes (abonnement.js) et réception sans crédit
//   callback.js /integrations/hubrise/callback (structure.js : relevé de diagnostic)
// Le comptoir, la carte et le dashboard n'appellent jamais ce module.
// ════════════════════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const router = express.Router();

router.use(require('./oauth'));
router.use(require('./callback'));   // H1b : réception des ventes, sans crédit
router.use('/api/admin', require('./admin'));

module.exports = router;
