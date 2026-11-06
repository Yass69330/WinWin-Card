// ════════════════════════════════════════════════════════════════════════════
// ZONE INTÉGRATION — Hubrise (France / UE) — docs/hubrise/
//
// H1a (06/11) : connexion d'un marchand (OAuth), jeton chiffré, admin.
//   oauth.js   /integrations/hubrise/connexion, /integrations/hubrise/retour
//   admin.js   /api/admin/marchands/:id/hubrise…, /api/admin/hubrise/connexions/:id/couper
// H1b (à venir) : abonnement aux commandes et récepteur sans crédit.
// Le comptoir, la carte et le dashboard n'appellent jamais ce module.
// ════════════════════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const router = express.Router();

router.use(require('./oauth'));
router.use('/api/admin', require('./admin'));

module.exports = router;
