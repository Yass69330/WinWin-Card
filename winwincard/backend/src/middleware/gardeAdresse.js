// Garde de l'adresse du client (étape 17a).
//
// `trust proxy` 2 (index.js) suppose que l'entrée publique de Railway écrit
// EXACTEMENT deux adresses dans X-Forwarded-For : le client, puis un relais. Mesuré
// le 07/10 sur le serveur de test : 2 adresses à chaque requête, depuis deux réseaux.
// Si le nombre change, la garde le dit dans le journal, au plus une fois par heure.
//
// Coût : une comparaison de chaînes, sur un en-tête déjà en mémoire. Aucun appel
// à la base ni au réseau, rien d'attendu (pas d'`await`). L'alerte ne contient
// aucune adresse : seulement le nombre et le chemin.
//
// Hypothèse qui fait casser le correctif : Railway cesse de RÉÉCRIRE X-Forwarded-For.
// Limite ACCEPTÉE (pilotage, 07/10) : si Railway retire une étape ET garde l'en-tête
// du client, il reste 2 adresses, la première forgée est retenue, la garde se tait.
// Seul le test des en-têtes forgés, rejoué après toute annonce de Railway, le voit.
const RELAIS_ATTENDUS = 2;                 // à garder égal à `trust proxy` (index.js)
const UNE_HEURE_MS = 60 * 60 * 1000;
// Contrôle de santé de Railway : arrive sans X-Forwarded-For, pas une alerte.
const CHEMINS_SANS_ALERTE = new Set(['/health/db']);

function gardeAdresse({ journal = console, maintenant = Date.now } = {}) {
  let derniere = -Infinity;
  return function gardeAdresseMiddleware(req, res, next) {
    const entete = req.headers['x-forwarded-for'];
    const n = entete ? entete.split(',').length : 0;
    if (n !== RELAIS_ATTENDUS && !CHEMINS_SANS_ALERTE.has(req.path)) {
      const t = maintenant();
      if (t - derniere >= UNE_HEURE_MS) {
        derniere = t;
        journal.warn(`[adresse] ALERTE : X-Forwarded-For porte ${n} adresse(s) au lieu de ${RELAIS_ATTENDUS} `
          + `(${req.method} ${req.path}). Railway a-t-il changé son nombre de relais ? `
          + `Vérifier avant tout : rejouer le test des en-têtes forgés (PASSATION §15 unvicies).`);
      }
    }
    next();
  };
}

module.exports = { gardeAdresse, RELAIS_ATTENDUS };
