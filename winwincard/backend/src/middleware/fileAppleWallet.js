'use strict';

// ════════════════════════════════════════════════════════════════════════════
// FILE DES RETOURS D'IPHONE, PRIORITÉ AUX CAISSES (étape t37, levier c)
//
// Pendant une campagne, des centaines d'iPhone reviennent en même temps chercher
// leur carte (/v1/*), chacun avec une ou plusieurs requêtes base. Node n'a pas
// de file vers Supabase : tout part ensemble, et le scan de la caisse attendait
// derrière (jusqu'à 154 s, étape 15). Ici, au plus FILE_V1_EN_VOL requêtes /v1
// sont traitées à la fois ; les suivantes attendent leur tour en mémoire, au
// plus FILE_V1_ATTENTE_MS, puis reçoivent 503 (Retry-After) : l'iPhone met sa
// carte à jour plus tard. Au-delà de FILE_V1_MAX en attente, 503 tout de suite.
// Les caisses ne passent jamais par cette file : elles gardent la base pour
// elles, à FILE_V1_EN_VOL requêtes d'iPhone près.
//
// /v1/log (journal d'Apple, aucune base) n'y passe pas.
// Aucune requête, tout en mémoire. Hypothèse : une seule instance.
// ════════════════════════════════════════════════════════════════════════════

function creerFile({ enVol = 10, attenteMs = 15000, max = 2000 } = {}) {
  let actives = 0;
  const attente = [];

  function liberer() {
    actives--;
    while (actives < enVol && attente.length > 0) {
      const suivant = attente.shift();
      clearTimeout(suivant.minuteur);
      actives++;
      suivant.lancer();
    }
  }

  function refuser(res) {
    if (res.headersSent || res.writableEnded) return;
    res.set('Retry-After', '30').status(503).send();
  }

  function middleware(req, res, next) {
    if (req.path === '/log') return next();

    const lancer = () => {
      let libere = false;
      const fin = () => { if (!libere) { libere = true; liberer(); } };
      res.on('finish', fin);
      res.on('close', fin);
      next();
    };

    if (actives < enVol) { actives++; return lancer(); }
    if (attente.length >= max) return refuser(res);

    const place = { lancer };
    place.minuteur = setTimeout(() => {
      const i = attente.indexOf(place);
      if (i >= 0) attente.splice(i, 1);
      refuser(res);
    }, attenteMs);
    // L'iPhone a raccroché pendant l'attente : sa place est rendue.
    res.on('close', () => {
      const i = attente.indexOf(place);
      if (i >= 0) { attente.splice(i, 1); clearTimeout(place.minuteur); }
    });
    attente.push(place);
  }

  middleware.etat = () => ({ actives, enAttente: attente.length });
  return middleware;
}

const fileAppleWallet = creerFile({
  enVol:     Number(process.env.FILE_V1_EN_VOL) || 10,
  attenteMs: Number(process.env.FILE_V1_ATTENTE_MS) || 15000,
  max:       Number(process.env.FILE_V1_MAX) || 2000,
});

module.exports = { fileAppleWallet, creerFile };
