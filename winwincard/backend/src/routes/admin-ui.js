const express = require('express');
const router  = express.Router();
const path    = require('path');
const { createSolidPng } = require('../services/apple-pass');

const ADMIN_DIR = path.resolve(__dirname, '../../public/admin');

// Icônes PWA — violet #7c3aed → R:124 G:58 B:237
router.get('/icon-:size.png', (req, res) => {
  const size = parseInt(req.params.size, 10);
  if (![192, 512].includes(size)) return res.status(404).end();
  try {
    const buf = createSolidPng(size, size, 124, 58, 237);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch (e) {
    console.error('[admin-ui] icon generation failed:', e.message);
    res.status(500).end();
  }
});

// SPA fallback
router.get('*', (req, res) => {
  res.sendFile(path.join(ADMIN_DIR, 'index.html'), err => {
    if (err) res.status(500).send('Erreur serveur');
  });
});

module.exports = router;
