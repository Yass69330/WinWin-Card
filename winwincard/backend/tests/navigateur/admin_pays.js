'use strict';

// ════════════════════════════════════════════════════════════════════════════
// TEST NAVIGATEUR — champ « Pays (format des numéros) » de la fiche marchand
// (admin, H0, migration 074, 05/11)
//
// Création : le pays suit la langue. Modification : aperçu, confirmation
// (dialogue accepté ici), écriture immédiate par POST /marchands/:id/pays ;
// retour à « Émirats ». Contre le vrai serveur et la base du filet.
// ════════════════════════════════════════════════════════════════════════════

const jwt = require('jsonwebtoken');
const { M } = require('../scenarios');

module.exports = async function ({ sql, verifier, secretJwt, urlServeur }) {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch { throw new Error('Playwright introuvable : lancer avec NODE_PATH=$(npm root -g)'); }

  const nav = await chromium.launch();
  try {
    console.log('\n— Navigateur : fiche marchand, champ « Pays » (admin, H0)');
    const ctx = await nav.newContext({ serviceWorkers: 'block', viewport: { width: 520, height: 1400 } });
    await ctx.addInitScript(t => localStorage.setItem('ww_admin_token', t), jwt.sign({ role: 'admin' }, secretJwt, { expiresIn: '1h' }));
    const p = await ctx.newPage();
    const dialogues = [];
    p.on('dialog', d => { dialogues.push(d.message()); d.accept().catch(() => {}); });
    const ouvrirFiche = async () => {
      await p.goto(urlServeur + '/admin/');
      await p.waitForSelector(`.btn-edit[data-id="${M.reseau}"]`);
      await p.click(`.btn-edit[data-id="${M.reseau}"]`);
      await p.waitForSelector('#section-api', { state: 'visible' });
    };
    const pays = () => sql(`SELECT pays FROM marchands WHERE id = '${M.reseau}'`);

    await ouvrirFiche();
    verifier('fiche d\'un marchand AE : le champ affiche « Émirats »', [await p.inputValue('#f-pays'), pays()], ['AE', 'AE']);

    await p.selectOption('#f-pays', 'FR');
    await p.waitForFunction(() => document.getElementById('pays-statut').textContent.includes('France'));
    verifier('passage en France : confirmation avec les comptes (aperçu), puis écrit tout de suite (sans « Enregistrer »)',
      [dialogues.length, /numéro\(s\) de client lus autrement/.test(dialogues[0] || ''), pays()], [1, true, 'FR']);

    await ouvrirFiche();
    verifier('fiche rouverte : « France »', await p.inputValue('#f-pays'), 'FR');
    await p.selectOption('#f-pays', 'AE');
    await p.waitForFunction(() => document.getElementById('pays-statut').textContent.includes('Émirats'));
    verifier('retour aux Émirats : écrit', pays(), 'AE');

    // Création : le pays suit la langue.
    await p.goto(urlServeur + '/admin/');
    await p.waitForSelector(`.btn-edit[data-id="${M.reseau}"]`);
    await p.evaluate(() => openCreateSheet());
    await p.selectOption('#f-langue', 'fr');
    const apresFr = await p.inputValue('#f-pays');
    await p.selectOption('#f-langue', 'en');
    verifier('création : la langue « Français » met le pays en France, « English » le remet aux Émirats',
      [apresFr, await p.inputValue('#f-pays')], ['FR', 'AE']);
    await ctx.close();
  } finally {
    await nav.close();
  }
};
