const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function comparePassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

// Égalité de deux chaînes secrètes en temps constant (mot de passe admin).
// `!==` s'arrête au premier caractère différent : la durée de la réponse
// renseigne sur le début juste. On compare deux empreintes SHA-256 de taille
// fixe avec timingSafeEqual : durée indépendante du contenu du secret et de sa
// ressemblance avec la saisie. Encodage utf16le : deux octets par unité de
// code JS, donc empreintes égales ⇔ chaînes égales (utf8 confondrait une
// demi-paire isolée avec U+FFFD). Tout ce qui n'est pas une chaîne est refusé.
function safeEqual(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
  const a = crypto.createHash('sha256').update(candidate, 'utf16le').digest();
  const b = crypto.createHash('sha256').update(expected, 'utf16le').digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = { hashPassword, comparePassword, safeEqual };
