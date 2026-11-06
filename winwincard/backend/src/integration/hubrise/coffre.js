// ════════════════════════════════════════════════════════════════════════════
// Le coffre du jeton Hubrise (H1, docs/hubrise/02-h1-connexion.md §4)
//
// SEUL fichier qui voit un jeton en clair. AES-256-GCM (crypto natif) :
//   - IV aléatoire de 12 octets à chaque chiffrement ;
//   - étiquette de 16 octets : un texte chiffré modifié est refusé ;
//   - données associées = « marchand_id:location_id » : un texte chiffré recopié
//     sur la ligne d'un autre marchand ou d'une autre location ne se déchiffre pas.
// Format stocké : « v1:<iv>:<étiquette>:<texte chiffré> » (base64). Le « v1 »
// prépare une rotation de clé (rien de codé pour elle en H1).
// La clé (HUBRISE_JETON_CLE) vit dans Railway, jamais en base.
// ════════════════════════════════════════════════════════════════════════════
'use strict';

const crypto = require('crypto');
const { cleJeton } = require('./config');

const donneesAssociees = (marchandId, locationId) => Buffer.from(`${marchandId}:${locationId}`, 'utf8');

function chiffrer(clair, marchandId, locationId) {
  const cle = cleJeton();
  if (!cle) throw new Error('HUBRISE_JETON_CLE absente ou invalide');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cle, iv);
  c.setAAD(donneesAssociees(marchandId, locationId));
  const texte = Buffer.concat([c.update(String(clair), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${texte.toString('base64')}`;
}

// → le jeton en clair, ou null (clé absente ou autre, texte modifié, mauvaise ligne).
function dechiffrer(stocke, marchandId, locationId) {
  try {
    const cle = cleJeton();
    const [version, iv, tag, texte] = String(stocke || '').split(':');
    if (!cle || version !== 'v1' || !iv || !tag || !texte) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', cle, Buffer.from(iv, 'base64'));
    d.setAAD(donneesAssociees(marchandId, locationId));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(texte, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

module.exports = { chiffrer, dechiffrer };
