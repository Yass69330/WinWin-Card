'use strict';

// ════════════════════════════════════════════════════════════════════════════
// LOGOS ET ICÔNE DES CARTES APPLE : LUS UNE FOIS, NORMALISÉS, GARDÉS EN MÉMOIRE
// (f17, morceau 2, décision du pilotage du 03/11)
//
// Avant : chaque carte fabriquée retéléchargeait son logo 3 fois (icône, logo,
// logo @2x), sans mémoire ni contrôle : une bascule de thème sur 500 cartes,
// c'était ≈ 1 500 téléchargements, et un logo de 5 Mo pouvait dépasser le délai
// de 5 s (la carte partait alors avec un carré de couleur).
//
// Maintenant, pour les 3 logos (normal, récompense, thème) et l'icône :
//   - un seul téléchargement par adresse et par serveur (les demandes simultanées
//     attendent le même téléchargement) ;
//   - l'image est NORMALISÉE une fois : vrai PNG (transparence gardée), réduite
//     pour tenir dans la taille qu'Apple affiche, jamais agrandie, proportions
//     gardées. Le rendu ne change pas : iOS réduisait déjà l'image à cette taille ;
//   - gardée en mémoire DUREE_MS (le logo normal est un lien collé : s'il est
//     remplacé à la même adresse, la carte le reprend au plus tard après ce délai) ;
//   - un échec (adresse injoignable, image illisible) est gardé ECHEC_MS, pour ne
//     pas retenter à chaque carte ; la carte part alors comme avant (carré uni).
// Aucune requête à la base ; rien sur le fil de la caisse (les cartes sont
// fabriquées au retour des iPhone, après la réponse au scan).
// ════════════════════════════════════════════════════════════════════════════

// Tailles @ affichées par Apple (storeCard) : logo 160×50 pt, icône 29 pt.
const FORMES = {
  logo1x: { largeur: 160, hauteur: 50 },
  logo2x: { largeur: 320, hauteur: 100 },
  icone3x: { largeur: 87, hauteur: 87 },
};

const config = { max: 100, dureeMs: 10 * 60e3, echecMs: 60e3 };
const memoire = new Map();   // `${forme}|${url}` → { promesse, expire }
let telecharger = url => require('./apple-pass').fetchImage(url);
let maintenant = () => Date.now();

async function normaliser(brut, forme) {
  const { largeur, hauteur } = FORMES[forme];
  return require('sharp')(brut)
    .resize({ width: largeur, height: hauteur, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
}

// Rend le PNG normalisé, ou null (adresse absente, injoignable, image illisible).
// Ne lève jamais.
function lire(url, forme) {
  if (!url || !FORMES[forme]) return Promise.resolve(null);
  const cle = `${forme}|${url}`;
  const t = maintenant();
  const deja = memoire.get(cle);
  if (deja && deja.expire > t) {
    memoire.delete(cle); memoire.set(cle, deja);   // le plus récent en dernier
    return deja.promesse;
  }
  const entree = { expire: t + config.dureeMs };
  entree.promesse = telecharger(url)
    .then(brut => normaliser(brut, forme))
    .catch(e => {
      console.error(`[logos] ${forme} illisible (${url}) :`, e.message);
      entree.expire = maintenant() + config.echecMs;
      return null;
    });
  memoire.delete(cle);
  memoire.set(cle, entree);
  while (memoire.size > config.max) memoire.delete(memoire.keys().next().value);
  return entree.promesse;
}

function _pourTests({ telechargeur, horloge, reglages } = {}) {
  if (telechargeur) telecharger = telechargeur;
  if (horloge) maintenant = horloge;
  if (reglages) Object.assign(config, reglages);
  memoire.clear();
  return { memoire, config };
}

module.exports = { FORMES, lire, normaliser, _pourTests };
