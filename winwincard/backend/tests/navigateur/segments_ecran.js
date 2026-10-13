'use strict';

// ════════════════════════════════════════════════════════════════════════════
// TEST NAVIGATEUR — menu des segments de l'onglet Notifications (migration 059)
//
// Joué APRÈS les scénarios : il réutilise le marchand de la section 23
// (« Filet Segments », un réseau de deux boutiques, 10 vrais clients).
//   - le menu propose Tous, Inactifs 15/30/60 j, Les plus fidèles, et une ligne
//     par boutique ;
//   - le nombre de destinataires suit le choix (mêmes chiffres que l'API) ;
//   - l'historique affiche le segment de la campagne.
// Hors `npm test` : exige Playwright. Lancement, depuis winwincard/backend :
//   NODE_PATH=$(npm root -g) FILET_EN_PLUS=tests/navigateur/segments_ecran.js node tests/lancer.js
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
  console.log('\n— Navigateur : segments de l\'onglet Notifications');

  const [id, nom] = sql(`SELECT id || '|' || nom FROM marchands WHERE slug = 'filet-segments'`).split('|');
  const navigateur = await chromium.launch();
  try {
    const contexte = await navigateur.newContext({ serviceWorkers: 'block', viewport: { width: 420, height: 1100 } });
    const jeton = jwt.sign({ role: 'marchand', marchand_id: id, tv: 1 }, secretJwt, { expiresIn: '1h' });
    await contexte.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); },
      { ww_dash_token: jeton, ww_dash_id: id, ww_dash_nom: nom, ww_dash_slug: 'filet-segments', ww_dash_lang: 'fr', ww_dash_forfait: 'pro' });
    const page = await contexte.newPage();
    page.on('dialog', d => d.dismiss().catch(() => {}));
    await page.goto(urlServeur + '/dashboard/');
    await page.waitForSelector('#stats-grid .stat-card');
    await page.click('.nav-btn[data-tab="notifs"]');
    await page.waitForFunction(() => /recevr/.test(document.getElementById('notif-dest').textContent));
    const options = await page.$$eval('#notif-segment option', os => os.map(o => o.textContent.trim()));
    const tous = (await page.textContent('#notif-dest')).trim();
    const choisir = async libelle => {
      await page.selectOption('#notif-segment', { label: libelle });
      await page.waitForFunction(() => !/Comptage/.test(document.getElementById('notif-dest').textContent));
      return (await page.textContent('#notif-dest')).trim();
    };
    const inactifs15 = await choisir('Inactifs depuis 15 jours');
    const fideles = await choisir('Les plus fidèles');
    const gauche = await choisir('Clients de Rive gauche');
    await page.locator('#tab-notifs').screenshot({ path: path.join(captures, 'segments-notifications.png') });
    const historique = (await page.locator('#notif-history-list').innerText());
    verifier('navigateur : menu des segments (Tous, inactifs 15/30/60 j, fidèles, une ligne par boutique)',
      options, ['Tous les clients', 'Inactifs depuis 15 jours', 'Inactifs depuis 30 jours', 'Inactifs depuis 60 jours',
        'Les plus fidèles', 'Clients de Rive droite', 'Clients de Rive gauche']);
    verifier('navigateur : le nombre de destinataires suit le choix (10, 3, 1, 2)',
      [tous, inactifs15, fideles, gauche],
      ['10 clients recevront ce message', '3 clients recevront ce message', '1 client recevra ce message', '2 clients recevront ce message']);
    verifier('navigateur : l\'historique affiche le segment de la campagne', /Inactifs depuis 15 jours/.test(historique), true);
    await contexte.close();
    console.log(`captures : ${captures}`);
  } finally {
    await navigateur.close();
  }
};
