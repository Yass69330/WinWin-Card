// Enveloppe un handler de route async pour que toute promesse rejetée (ou erreur
// lancée) soit transmise au middleware d'erreur d'Express via next(err), au lieu
// de devenir une "unhandled rejection" qui peut crasher le process.
//
// Usage :
//   router.get('/', asyncHandler(async (req, res) => { ... }));
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = asyncHandler;
