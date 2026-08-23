const express = require('express');
const router = express.Router();
const path = require('path');
const { createSolidPng } = require('../services/apple-pass');

const SCANNER_DIR = path.resolve(__dirname, '../../public/scanner');

// PWA icons — generated dynamically, no static PNG needed
router.get('/icon-:size.png', (req, res) => {
  const size = parseInt(req.params.size, 10);
  if (![192, 512].includes(size)) return res.status(404).end();

  // Deep indigo #6366f1 → R:99 G:102 B:241
  try {
    const buf = createSolidPng(size, size, 99, 102, 241);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch (e) {
    console.error('[scanner] icon generation failed:', e.message);
    res.status(500).end();
  }
});

// SPA fallback — all other scanner routes serve index.html
router.get('*', (req, res) => {
  res.sendFile(path.join(SCANNER_DIR, 'index.html'), err => {
    if (err) res.status(500).send('Erreur serveur');
  });
});

module.exports = router;
