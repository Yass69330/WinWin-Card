// ════════════════════════════════════════════════════════════════════════════
// ZONE « INTÉGRATION » — identité du client, comptoir, (plus tard) API caisses
//
// Tout ce qui relie WinWin à l'extérieur du comptoir classique vit ici, monté par
// UNE ligne dans src/index.js. Le scan, la carte et le dashboard n'en dépendent
// pas. Architecture, conventions et patron d'attribut : docs/api/README.md.
//
//   comptoir.js      /api/comptoir/*          gestes du caissier (authScanner)
//   recuperation.js  /r/:jeton                page publique du QR de récupération
//                    /api/recuperation/:jeton ce que la page lit
//   (plus tard) api-ventes/  /api/v1/*        API machine des caisses
// ════════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();

router.use('/api/comptoir', require('./comptoir'));
router.use(require('./recuperation'));

module.exports = router;
