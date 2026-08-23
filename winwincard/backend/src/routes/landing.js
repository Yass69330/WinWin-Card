const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const LANDING_HTML = path.resolve(__dirname, '../../public/landing.html');

// Vérification au démarrage
if (!fs.existsSync(LANDING_HTML)) {
  console.error(`[landing] ERREUR : fichier introuvable : ${LANDING_HTML}`);
}

// GET /l/:slug — sert la landing page
router.get('/:slug', (req, res) => {
  // no-cache : le HTML évolue souvent (branding, features) — on veut que le
  // navigateur revérifie systématiquement plutôt que d'utiliser sa version ETag.
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(LANDING_HTML, err => {
    if (err) {
      console.error(`[landing] sendFile échoué pour ${LANDING_HTML} :`, err.message);
      res.status(500).send('Erreur serveur — landing.html introuvable');
    }
  });
});

module.exports = router;
