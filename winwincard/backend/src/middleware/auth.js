const jwt = require('jsonwebtoken');
const { etatMarchand } = require('../services/marchand-cache');

// ── Contrôle d'autorisation partagé par authMarchand et authScanner ────────
// Chantier P0 sécurité. Deux refus possibles, tous deux en 403 :
//   (a) marchand suspendu ou supprimé      → 'account_suspended'
//   (b) jeton révoqué (tv ≠ token_version) → 'session_revoked'
//
// RÈGLE ABSOLUE DU CHANTIER : aucune reconnexion forcée. Un jeton émis avant
// ce déploiement ne porte pas de champ `tv` ; `payload.tv ?? 1` le fait donc
// valoir 1, et la migration 045 met `token_version` à 1 pour tout le monde.
// Tous les jetons en circulation restent valides. Un jeton n'est refusé
// qu'après une action explicite de l'admin (suspension ou révocation).
//
// tokenVersion `null` = lecture base impossible (cf. marchand-cache) : on ne
// révoque pas sur une panne, on laisse passer.
async function refusAutorisation(marchandId, payload) {
  const etat = await etatMarchand(marchandId);
  if (!etat.actif || !etat.existe) {
    return { status: 403, error: 'account_suspended' };
  }
  const tv = payload.tv ?? 1;
  if (etat.tokenVersion != null && tv !== etat.tokenVersion) {
    return { status: 403, error: 'session_revoked' };
  }
  return null;
}

// Middleware marchand — vérifie le JWT et attache marchand_id à req
async function authMarchand(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  const token = header.slice(7);
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
  if (payload.role !== 'marchand') {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  // Le try/catch ci-dessus ne couvre QUE jwt.verify : englober le contrôle
  // d'autorisation le ferait passer pour un jeton invalide et masquerait un
  // refus légitime derrière un 401.
  const refus = await refusAutorisation(payload.marchand_id, payload);
  if (refus) return res.status(refus.status).json({ error: refus.error });

  req.marchandId = payload.marchand_id;
  next();
}

// Middleware admin — accès global
function authAdmin(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'admin') {
      return res.status(403).json({ error: 'Accès admin requis' });
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

// Middleware scanner PWA — vérifie que le marchand du scan est actif
async function authScanner(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  const token = header.slice(7);
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
  if (payload.role !== 'scanner' && payload.role !== 'marchand') {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  // Le scan relisait déjà le statut de la BOUTIQUE (scan.js) mais jamais celui
  // du MARCHAND pour un jeton boutique : ce contrôle ferme ce trou.
  const refus = await refusAutorisation(payload.marchand_id, payload);
  if (refus) return res.status(refus.status).json({ error: refus.error });

  {
    req.marchandId = payload.marchand_id;
    // Multi-boutiques (3c) : le scan lira ces champs. Le point_de_vente_id du
    // token ne sert QU'À désigner la boutique — son statut (actif/archivé) est
    // TOUJOURS relu en base au scan, jamais présumé depuis le JWT.
    req.scannerRole   = payload.role;
    req.pointDeVenteId = payload.point_de_vente_id || null;
  }
  next();
}

module.exports = { authMarchand, authAdmin, authScanner };
