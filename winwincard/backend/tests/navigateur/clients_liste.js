'use strict';

// ════════════════════════════════════════════════════════════════════════════
// TEST NAVIGATEUR — l'onglet Clients par pages et l'export complet (étape 21)
//
// Le vrai dashboard dans un vrai Chromium, contre le vrai serveur et la base du
// filet. Joué APRÈS les scénarios : il réutilise « Filet Liste, Export » (2 500
// clients, Pro+) de la section 21.
//   - la liste affiche le total réel, 100 clients, puis « Afficher plus » ;
//   - la recherche est faite par le serveur : elle trouve un client au-delà des
//     1 000 premiers ;
//   - le bouton CSV télécharge les 2 500 clients.
// Captures d'écran dans CAPTURES (dossier ; défaut : dossier temporaire).
//
// Hors `npm test` : exige Playwright. Lancement, depuis winwincard/backend :
//   NODE_PATH=$(npm root -g) FILET_EN_PLUS=tests/navigateur/clients_liste.js node tests/lancer.js
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

module.exports = async function ({ sql, verifier, secretJwt, urlServeur }) {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch { throw new Error('Playwright introuvable : lancer avec NODE_PATH=$(npm root -g)'); }

  const captures = process.env.CAPTURES || fs.mkdtempSync(path.join(os.tmpdir(), 'captures-'));
  fs.mkdirSync(captures, { recursive: true });
  console.log('\n— Navigateur : onglet Clients par pages, recherche, export (étape 21)');
  const [id, nom] = sql(`SELECT id || '|' || nom FROM marchands WHERE slug = 'filet-liste'`).split('|');

  const navigateur = await chromium.launch();
  try {
    const contexte = await navigateur.newContext({ serviceWorkers: 'block', viewport: { width: 420, height: 1000 }, acceptDownloads: true });
    const jeton = jwt.sign({ role: 'marchand', marchand_id: id, tv: 1 }, secretJwt, { expiresIn: '1h' });
    await contexte.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); },
      { ww_dash_token: jeton, ww_dash_id: id, ww_dash_nom: nom, ww_dash_slug: 'filet-liste', ww_dash_lang: 'fr' });
    const page = await contexte.newPage();
    page.on('dialog', d => d.dismiss().catch(() => {}));
    await page.goto(urlServeur + '/dashboard/');
    await page.waitForSelector('#stats-grid .stat-card');
    await page.click('[data-tab="clients"]');
    await page.waitForSelector('#clients-list .client-card');
    const cartes = () => page.locator('#clients-list .client-card').count();
    const meta = () => page.locator('#clients-meta').innerText();
    verifier('onglet Clients : le total réel (2 500, avant : 1 000) et une première page de 100',
      [await meta(), await cartes(), await page.locator('#btn-more-clients').isVisible()], ['2500 clients', 100, true]);
    await page.screenshot({ path: path.join(captures, '1-clients-premiere-page.png') });
    await page.click('#btn-more-clients');
    await page.waitForFunction(() => document.querySelectorAll('#clients-list .client-card').length === 200);
    verifier('« Afficher plus » : 100 clients de plus (200), le total ne bouge pas', [await cartes(), await meta()], [200, '2500 clients']);

    await page.fill('#search-clients', 'zo');
    await page.waitForFunction(() => document.getElementById('clients-meta').textContent === '1 client trouvé');
    verifier('recherche « zo » faite par le serveur : Zoé trouvée (au-delà des 1 000 premiers), pas de « Afficher plus »',
      [await page.locator('#clients-list .client-name').allInnerTexts(), await page.locator('#btn-more-clients').count()], [['Zoé'], 0]);
    await page.screenshot({ path: path.join(captures, '2-clients-recherche.png') });

    await page.fill('#search-clients', '');
    await page.waitForFunction(() => document.getElementById('clients-meta').textContent === '2500 clients');
    const [telechargement] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export-csv')]);
    const fichier = fs.readFileSync(await telechargement.path(), 'utf8');
    verifier('bouton CSV : le fichier téléchargé contient les 2 500 clients et l\'en-tête',
      fichier.replace(/^﻿/, '').split('\r\n').length, 2501);
    await contexte.close();
    console.log(`captures : ${captures}`);
  } finally {
    await navigateur.close();
  }
};
