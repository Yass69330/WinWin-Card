// Code de secours caisse — les 6 derniers caractères du serial, en majuscules.
//
// Règle UNIQUE et partagée : elle est affichée sur le pass (dos + sous le QR,
// Apple et Google) et elle doit rester alignée sur la résolution côté scan,
// qui fait un match par SUFFIXE insensible à la casse (src/routes/scan.js).
// Changer la longueur ici sans changer le scan casserait la saisie manuelle —
// d'où le point d'entrée unique plutôt que trois copies de `slice(-6)`.
const BACKUP_CODE_LEN = 6;

function backupCode(serialNumber) {
  return String(serialNumber || '').slice(-BACKUP_CODE_LEN).toUpperCase();
}

module.exports = { backupCode, BACKUP_CODE_LEN };
