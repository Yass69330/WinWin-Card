const express = require('express');
const router = express.Router();
const path = require('path');

// GET /l/:slug — sert la landing page (HTML statique)
// Le slug est dans l'URL, JavaScript l'extrait et appelle l'API
router.get('/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/landing.html'));
});

module.exports = router;
