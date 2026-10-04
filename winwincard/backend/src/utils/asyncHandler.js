// Enveloppe un handler de route async pour que toute promesse rejetée (ou erreur
// lancée) soit transmise au middleware d'erreur d'Express via next(err), au lieu
// de devenir une "unhandled rejection" qui peut crasher le process.
//
// suivre() (étape 14a) : un handler qui continue après sa réponse est attendu
// par l'arrêt propre au redéploiement (services/arret.js).
//
// Usage :
//   router.get('/', asyncHandler(async (req, res) => { ... }));
const { suivre } = require('../services/arret');

function asyncHandler(fn) {
  return (req, res, next) => suivre(Promise.resolve(fn(req, res, next)).catch(next));
}

module.exports = asyncHandler;
