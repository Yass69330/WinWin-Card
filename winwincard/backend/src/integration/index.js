// ════════════════════════════════════════════════════════════════════════════
// ZONE « INTÉGRATION » — API des caisses des commerçants (et, plus tard,
// identité du client, récupération de carte, borne)
//
// Tout ce qui relie WinWin à l'extérieur du comptoir WinWin vit ici, monté par
// UNE ligne dans src/index.js. Le scan, la carte et le dashboard n'en dépendent
// pas. Architecture, conventions, patron d'attribut : docs/api/README.md.
// Contrat : docs/api/03-contrat-api-v1.md.
//
//   api-v1/          /api/v1/*                     API machine (clé du commerçant)
//   api-v1/admin.js  /api/admin/…                 clés d'API, codes caisse des boutiques (admin WinWin)
// ════════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();

router.use('/api/v1', require('./api-v1'));
router.use('/api/admin', require('./api-v1/admin'));

module.exports = router;
