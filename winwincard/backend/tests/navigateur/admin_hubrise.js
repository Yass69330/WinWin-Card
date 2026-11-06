'use strict';

// ════════════════════════════════════════════════════════════════════════════
// TEST NAVIGATEUR — section « Hubrise » de la fiche marchand (admin, H1a, 06/11)
//
// Le serveur du filet n'a pas de réglages Hubrise : la section le dit et le
// bouton de lien est désactivé. Une connexion posée en base s'affiche (nom,
// location), jamais son jeton ; « Couper » la coupe (sans révocation, faute de
// réglages). Le parcours OAuth lui-même est au filet (section 32, faux Hubrise).
// ════════════════════════════════════════════════════════════════════════════

const jwt = require('jsonwebtoken');
const { M } = require('../scenarios');

module.exports = async function ({ sql, verifier, secretJwt, urlServeur }) {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch { throw new Error('Playwright introuvable : lancer avec NODE_PATH=$(npm root -g)'); }

  const nav = await chromium.launch();
  try {
    console.log('\n— Navigateur : fiche marchand, section « Hubrise » (admin, H1a)');
    const ctx = await nav.newContext({ serviceWorkers: 'block', viewport: { width: 520, height: 1400 } });
    await ctx.addInitScript(t => localStorage.setItem('ww_admin_token', t), jwt.sign({ role: 'admin' }, secretJwt, { expiresIn: '1h' }));
    const p = await ctx.newPage();
    p.on('dialog', d => d.accept().catch(() => {}));
    const ouvrirFiche = async () => {
      await p.goto(urlServeur + '/admin/');
      await p.waitForSelector(`.btn-edit[data-id="${M.reseau}"]`);
      await p.click(`.btn-edit[data-id="${M.reseau}"]`);
      await p.waitForSelector('#section-hubrise', { state: 'visible' });
      await p.waitForFunction(() => !document.getElementById('hubrise-etat').textContent.includes('Chargement'));
    };
    sql(`DELETE FROM hubrise_connexions WHERE marchand_id = '${M.reseau}'`);

    await ouvrirFiche();
    verifier('fiche admin : section « Hubrise » affichée ; serveur sans réglages → message « pas configuré », bouton de lien désactivé, « Non connecté »',
      [/pas configuré/.test(await p.innerText('#hubrise-etat')), await p.isDisabled('#btn-hubrise-lien'), /Non connecté/.test(await p.innerText('#hubrise-etat'))],
      [true, true, true]);

    sql(`INSERT INTO hubrise_connexions (marchand_id, account_id, location_id, nom_location, scope, jeton_chiffre)
         VALUES ('${M.reseau}', 'acc-nav', 'loc-nav', 'Boutique <b>Lyon</b>', 'location[orders.read,customer_list.read]', 'v1:AAAA:BBBB:CCCC')`);
    await ouvrirFiche();
    const texte = await p.innerText('#hubrise-etat');
    verifier('connexion en base : « Connecté », nom de la location échappé, identifiant de location ; aucun jeton dans la page',
      [/Connecté/.test(texte), texte.includes('Boutique <b>Lyon</b>'), texte.includes('loc-nav'), (await p.content()).includes('v1:AAAA')],
      [true, true, true, false]);
    await p.click('[data-hubrise-couper]');
    await p.waitForFunction(() => /coupée/.test(document.getElementById('hubrise-statut').textContent));
    verifier('« Couper » : coupée en base (par WinWin, jeton effacé), la fiche l\'affiche, révocation non confirmée (pas de réglages)',
      [sql(`SELECT coupee_par || '|' || (jeton_chiffre IS NULL) FROM hubrise_connexions WHERE location_id = 'loc-nav'`),
       /révocation chez Hubrise non confirmée/.test(await p.innerText('#hubrise-statut'))], ['winwin|true', true]);
    sql(`DELETE FROM hubrise_connexions WHERE marchand_id = '${M.reseau}'`);
    await ctx.close();
  } finally {
    await nav.close();
  }
};
