// ════════════════════════════════════════════════════════════════════════════
// Relevé de structure d'une commande Hubrise (H1b, diagnostic jetable — cadrage
// docs/hubrise/03-h1b-reception.md §4, décision D2 du 08/11 : journaux seulement)
//
// But : trouver le chemin du champ qui porte la référence de carte WinWin, sans
// jamais écrire une valeur. Pour chaque feuille du JSON :
//   chemin (tableaux réduits à « [] »), type, longueur d'un texte, et
//   forme_carte = la valeur A LA FORME d'un identifiant de carte WinWin (numéro de
//   série de 36 caractères ou code court de 6 caractères hexadécimaux).
// Seule exception, une liste FERMÉE de champs techniques non personnels dont la
// valeur est gardée (décision D4) : statut, type d'événement, type de ressource,
// type de service, devise, total.
// Fonction pure : aucune écriture, aucun réseau.
// ════════════════════════════════════════════════════════════════════════════
'use strict';

const VALEURS_GARDEES = new Set(['status', 'event_type', 'resource_type', 'service_type', 'currency', 'total']);
const RE_SERIE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_CODE_COURT = /^[0-9a-f]{6}$/i;
const MAX_CHAMPS = 400;

const formeCarte = v => typeof v === 'string' && (RE_SERIE.test(v.trim()) || RE_CODE_COURT.test(v.trim()));
const typeDe = v => (v === null ? 'nul' : Array.isArray(v) ? 'tableau' : typeof v === 'string' ? 'texte'
  : typeof v === 'number' ? 'nombre' : typeof v === 'boolean' ? 'booléen' : 'objet');

// → [{ chemin, type, longueur?, forme_carte?, valeur? }], un par chemin distinct.
function relever(corps) {
  const champs = new Map();
  const visiter = (v, chemin, cle) => {
    if (champs.size >= MAX_CHAMPS) return;
    if (Array.isArray(v)) {
      if (v.length === 0) champs.set(chemin + '[]', { chemin: chemin + '[]', type: 'tableau vide' });
      v.forEach(x => visiter(x, chemin + '[]', cle));
      return;
    }
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) visiter(v[k], chemin ? `${chemin}.${k}` : k, k);
      return;
    }
    const prec = champs.get(chemin);
    const ligne = prec || { chemin, type: typeDe(v) };
    if (typeof v === 'string') ligne.longueur = Math.max(ligne.longueur || 0, v.length);
    if (formeCarte(v)) ligne.forme_carte = true;
    if (VALEURS_GARDEES.has(cle) && (typeof v === 'string' || typeof v === 'number') && String(v).length <= 40) {
      ligne.valeur = String(v);
    }
    champs.set(chemin, ligne);
  };
  visiter(corps, '', '');
  return [...champs.values()].sort((a, b) => a.chemin.localeCompare(b.chemin));
}

module.exports = { relever, formeCarte, VALEURS_GARDEES };
