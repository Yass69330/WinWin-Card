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
    async function bloc(slug, forfait, fichier, avecFormulaire = false) {
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
      const texte = [(await page.locator('#smart-notifs .smart-intro').innerText()).trim(),
        ...(await page.$$eval('#smart-notifs .smart-liste li', els => els.map(e => e.textContent.trim()))),
        (await page.locator('#smart-notifs .smart-7j').innerText()).trim(),
        (await page.locator('#smart-regler').innerText()).trim()];
      let formulaire = null;
      if (avecFormulaire) {
        await page.click('#smart-regler');
        await page.waitForSelector('#smart-form');
        await page.fill('#smart-jours', '5');
        await page.click('#smart-enregistrer');
        await page.waitForFunction(() => /Choisissez/.test(document.getElementById('smart-info').textContent));
        const erreur = (await page.textContent('#smart-info')).trim();
        await page.fill('#smart-jours', '14');
        await page.fill('#smart-message', 'Ça fait longtemps {prenom} ! Une part offerte cette semaine.');
        await page.fill('#smart-seuil', '40');
        await page.fill('#smart-message-boost', 'Encore {reste} et ta pizza est offerte !');
        await page.click('#smart-enregistrer');
        await page.waitForFunction(() => /Enregistré/.test((document.getElementById('smart-info') || {}).textContent || ''));
        await page.locator('#smart-notifs').screenshot({ path: path.join(captures, 'smart-4-reglage-ouvert.png') });
        const apres = await page.$$eval('#smart-notifs .smart-liste li', els => els.map(e => e.textContent.trim()).join(' | '));
        const winwinVisible = await page.locator('#smart-winwin').isVisible();
        await page.click('#smart-winwin');
        await page.waitForFunction(() => !document.getElementById('smart-winwin'));
        const retour = await page.$$eval('#smart-notifs .smart-liste li', els => els.map(e => e.textContent.trim()).join(' | '));
        formulaire = { erreur, apres, winwinVisible, retour };
      }
      const ordre = await page.evaluate(() => {
        const h = document.getElementById('notif-history-list'), b = document.getElementById('smart-notifs');
        return !!(h.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      await contexte.close();
      return { texte, ordre, formulaire };
    }
    const premium = await bloc('filet-smart-premium', 'pro_plus', 'smart-1-premium-points.png', true);
    const simple = await bloc('filet-smart-simple', 'pro', 'smart-2-sans-premium-points.png');
    const tampons = await bloc('filet-smart-tampons', 'pro', 'smart-3-tampons.png');
    verifier('navigateur, rapport des 7 jours : singulier et zéro (« 1 smart notification envoyée », « 0 smart notification envoyée »), pluriel',
      await (async () => {
        const ctx = await navigateur.newContext({ serviceWorkers: 'block' });
        const p = await ctx.newPage();
        await p.goto(urlServeur + '/dashboard/');
        const r = await p.evaluate(() => { setLang('fr'); return [0, 1, 2].map(n => t('smart7j', { n })); });
        await ctx.close();
        return r;
      })(),
      ['Rapport des 7 derniers jours : 0 smart notification envoyée', 'Rapport des 7 derniers jours : 1 smart notification envoyée',
       'Rapport des 7 derniers jours : 2 smart notifications envoyées']);
    verifier('navigateur, landing premium (points) : une phrase, une ligne courte par smart notification (avis compris), le compte sur une ligne, « Modifier » ; sous l\'historique',
      [premium.texte.join(' | '), premium.ordre],
      ['Envoyées automatiquement à vos clients. | Relance · après 21 j | Boost · à 50 points | Anniversaire | Avis Google | Rapport des 7 derniers jours : 5 smart notifications envoyées | Modifier', true]);
    verifier('navigateur, « Modifier » : 5 jours refusé avec un message clair ; 14 jours, seuil 40 et message du boost enregistrés ; « Revenir au réglage WinWin » remet 21 jours et 50 points',
      [premium.formulaire.erreur, premium.formulaire.apres, premium.formulaire.winwinVisible, premium.formulaire.retour],
      ['Choisissez entre 7 et 90 jours.',
       'Relance · après 14 j | Boost · à 40 points | Anniversaire | Avis Google', true,
       'Relance · après 21 j | Boost · à 50 points | Anniversaire | Avis Google']);
    verifier('navigateur, sans landing premium : pas d\'anniversaire ; « à 1 point » au singulier',
      simple.texte.join(' | '), 'Envoyées automatiquement à vos clients. | Relance · après 30 j | Boost · à 1 point | Rapport des 7 derniers jours : 2 smart notifications envoyées | Modifier');
    verifier('navigateur, tampons : « à 2 tampons », relance d\'inactivité désactivée absente, « 0 smart notification envoyée »',
      tampons.texte.join(' | '), 'Envoyées automatiquement à vos clients. | Boost · à 2 tampons | Anniversaire | Rapport des 7 derniers jours : 0 smart notification envoyée | Modifier');

    // Fiche admin d'un marchand qui a fait ses réglages : bloc orange, puis « Effacer ».
    const [idS] = sql(`SELECT id FROM marchands WHERE slug = 'filet-smart-simple'`).split('|');
    sql(`UPDATE marchands SET marchand_inactive_days = 12, marchand_inactive_message = 'Reviens vite {prenom} !', marchand_near_reward_threshold = 3, marchand_near_reward_message = 'Encore {reste} !' WHERE id = '${idS}'`);
    const ctxA = await navigateur.newContext({ serviceWorkers: 'block', viewport: { width: 520, height: 1400 } });
    const jetonA = jwt.sign({ role: 'admin' }, secretJwt, { expiresIn: '1h' });
    await ctxA.addInitScript(t => localStorage.setItem('ww_admin_token', t), jetonA);
    const admin = await ctxA.newPage();
    admin.on('dialog', d => d.accept().catch(() => {}));
    await admin.goto(urlServeur + '/admin/');
    await admin.waitForSelector(`.btn-edit[data-id="${idS}"]`);
    await admin.click(`.btn-edit[data-id="${idS}"]`);
    await admin.waitForSelector('#wf-reglages-marchand', { state: 'visible' });
    const blocAdmin = (await admin.locator('#wf-reglages-marchand-liste').innerText()).trim();
    const champAdmin = await admin.inputValue('#f-wf-inactive-days');
    await admin.locator('#section-workflows').screenshot({ path: path.join(captures, 'smart-5-fiche-admin.png') });
    await admin.click('#btn-effacer-reglages-marchand');
    await admin.waitForSelector('#wf-reglages-marchand', { state: 'hidden' });
    verifier('navigateur, fiche admin : réglages du marchand en orange (12 jours, message, boost 3) à côté du réglage WinWin (30) ; « Effacer » les retire',
      [blocAdmin, champAdmin, sql(`SELECT coalesce(marchand_inactive_days::text, 'null') FROM marchands WHERE id = '${idS}'`)],
      ['• Relance après 12 jours sans visite (réglage WinWin : 30 jours)\n• Message de relance : « Reviens vite {prenom} ! »\n• Boost à 3 de la récompense (réglage WinWin : 1)\n• Message du boost : « Encore {reste} ! »', '30', 'null']);
    await ctxA.close();
    console.log(`captures : ${captures}`);
  } finally {
    await navigateur.close();
  }
};
