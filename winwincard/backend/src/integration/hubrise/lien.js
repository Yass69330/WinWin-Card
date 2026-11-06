// ════════════════════════════════════════════════════════════════════════════
// Le lien de connexion et le state OAuth (H1, docs/hubrise/02-h1-connexion.md §4.3)
//
// Un seul jeton signé sert aux deux : le lien que l'admin ouvre (ou envoie au
// marchand) le porte, puis il part tel quel comme `state` vers Hubrise et revient
// au retour. Le marchand de la connexion ne vient QUE de lui.
//   - secret dédié HUBRISE_LIEN_SECRET (distinct de JWT_SECRET) ;
//   - 30 minutes ; HS256 seulement ;
//   - usage unique : le nonce est consommé au retour (hubrise_liens_utilises).
// ════════════════════════════════════════════════════════════════════════════
'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { base } = require('./config');

const DUREE_S = 30 * 60;
const BUT = 'hubrise_connexion';

function creer(marchandId) {
  const jeton = jwt.sign({ but: BUT, m: marchandId, n: crypto.randomUUID() }, process.env.HUBRISE_LIEN_SECRET,
    { algorithm: 'HS256', expiresIn: DUREE_S });
  return {
    jeton,
    url: `${base()}/integrations/hubrise/connexion?l=${encodeURIComponent(jeton)}`,
    expire_le: new Date(Date.now() + DUREE_S * 1000).toISOString(),
  };
}

// → { marchandId, nonce } | { erreur: 'lien_expire' | 'lien_invalide' }
function verifier(jeton) {
  try {
    const p = jwt.verify(String(jeton || ''), process.env.HUBRISE_LIEN_SECRET, { algorithms: ['HS256'] });
    if (p.but !== BUT || typeof p.m !== 'string' || typeof p.n !== 'string') return { erreur: 'lien_invalide' };
    return { marchandId: p.m, nonce: p.n };
  } catch (e) {
    return { erreur: e && e.name === 'TokenExpiredError' ? 'lien_expire' : 'lien_invalide' };
  }
}

module.exports = { creer, verifier, DUREE_S };
