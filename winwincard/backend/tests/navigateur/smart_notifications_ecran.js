'use strict';

// ════════════════════════════════════════════════════════════════════════════
// TEST NAVIGATEUR — bloc « Mes smart notifications » de l'onglet Notifications
//
// Joué APRÈS les scénarios : il réutilise les marchands de la section 24 :
//   - « Filet Smart Premium » : Pro+, landing premium, points ;
//   - « Filet Smart Simple »  : Pro, sans landing premium, points ;
//   - « Filet Smart Tampons » : Pro, landing premium, tampons, relance
//     d'inactivité désactivée.
// Une capture de l'onglet Notifications par marchand (dossier CAPTURES).
// Hors `npm test` : exige Playwright. Lancement, depuis winwincard/backend :
//   NODE_PATH=$(npm root -g) FILET_EN_PLUS=tests/navigateur/smart_notifications_ecran.js node tests/lancer.js
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
  console.log('\n— Navigateur : bloc « Mes smart notifications »');

  const navigateur = await chromium.launch();
  try {
    async function bloc(slug, forfait, fichier) {
      const [id, nom] = sql(`SELECT id || '|' || nom FROM marchands WHERE slug = '${slug}'`).split('|');
      const contexte = await navigateur.newContext({ serviceWorkers: 'block', viewport: { width: 420, height: 1300 } });
      const jeton = jwt.sign({ role: 'marchand', marchand_id: id, tv: 1 }, secretJwt, { expiresIn: '1h' });
      await contexte.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); },
        { ww_dash_token: jeton, ww_dash_id: id, ww_dash_nom: nom, ww_dash_slug: slug, ww_dash_lang: 'fr', ww_dash_forfait: forfait });
      const page = await contexte.newPage();
      page.on('dialog', d => d.dismiss().catch(() => {}));
      await page.goto(urlServeur + '/dashboard/');
      await page.waitForSelector('#stats-grid .stat-card');
      await page.click('.nav-btn[data-tab="notifs"]');
      await page.waitForSelector('#smart-notifs h3');
      await page.waitForFunction(() => /recevr|Aucun client/.test(document.getElementById('notif-dest').textContent));
      await page.locator('#tab-notifs').screenshot({ path: path.join(captures, fichier) });
      const texte = (await page.locator('#smart-notifs').innerText()).trim().replace(/\n+/g, '\n');
      const ordre = await page.evaluate(() => {
        const h = document.getElementById('notif-history-list'), b = document.getElementById('smart-notifs');
        return !!(h.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      await contexte.close();
      return { texte, ordre };
    }
    const premium = await bloc('filet-smart-premium', 'pro_plus', 'smart-1-premium-points.png');
    const simple = await bloc('filet-smart-simple', 'pro', 'smart-2-sans-premium-points.png');
    const tampons = await bloc('filet-smart-tampons', 'pro', 'smart-3-tampons.png');
    verifier('navigateur, landing premium (points) : les trois smart notifications et le compte des 7 jours, sous l\'historique',
      [premium.texte, premium.ordre],
      ['Mes smart notifications\nEnvoyées automatiquement à vos clients :\nune relance après 21 jours sans visite\nun boost quand il ne leur manque plus que 50 points pour leur récompense\nun message le jour de leur anniversaire\nCes 7 derniers jours : 3 smart notifications', true]);
    verifier('navigateur, sans landing premium : pas d\'anniversaire ; « 1 point » au singulier',
      simple.texte, 'Mes smart notifications\nEnvoyées automatiquement à vos clients :\nune relance après 30 jours sans visite\nun boost quand il ne leur manque plus que 1 point pour leur récompense\nCes 7 derniers jours : 2 smart notifications');
    verifier('navigateur, tampons : « 2 tampons », relance d\'inactivité désactivée absente, « 0 smart notification »',
      tampons.texte, 'Mes smart notifications\nEnvoyées automatiquement à vos clients :\nun boost quand il ne leur manque plus que 2 tampons pour leur récompense\nun message le jour de leur anniversaire\nCes 7 derniers jours : 0 smart notification');
    console.log(`captures : ${captures}`);
  } finally {
    await navigateur.close();
  }
};
