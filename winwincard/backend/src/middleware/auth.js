const jwt = require('jsonwebtoken');

// Middleware marchand — vérifie le JWT et attache marchand_id à req
function authMarchand(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'marchand') {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    req.marchandId = payload.marchand_id;
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
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
function authScanner(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'scanner' && payload.role !== 'marchand') {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    req.marchandId = payload.marchand_id;
    // Multi-boutiques (3c) : le scan lira ces champs. Le point_de_vente_id du
    // token ne sert QU'À désigner la boutique — son statut (actif/archivé) est
    // TOUJOURS relu en base au scan, jamais présumé depuis le JWT.
    req.scannerRole   = payload.role;
    req.pointDeVenteId = payload.point_de_vente_id || null;
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

module.exports = { authMarchand, authAdmin, authScanner };
