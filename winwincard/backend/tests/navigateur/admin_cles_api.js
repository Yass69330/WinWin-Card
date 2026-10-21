'use strict';

// ════════════════════════════════════════════════════════════════════════════
// TEST NAVIGATEUR — section « API caisse » de la fiche marchand (admin, 20/10)
//
// API des caisses, étape 1 : réglage de la conversion et du plafond (saisis en
// AED, enregistrés en fils), création d'une clé montrée UNE seule fois,
// révocation. Étape 2 : code caisse d'une boutique. Contre le vrai serveur et la
// base du filet.
// ════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { M } = require('../scenarios');

module.exports = async function ({ sql, verifier, secretJwt, urlServeur }) {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch { throw new Error('Playwright introuvable : lancer avec NODE_PATH=$(npm root -g)'); }

  const titre = t => console.log(`\n— ${t}`);
  const sha = x => crypto.createHash('sha256').update(x).digest('hex');
  const nav = await chromium.launch();
  try {
    titre('Navigateur : fiche marchand, section « API caisse » (admin)');
    const ctx = await nav.newContext({ serviceWorkers: 'block', viewport: { width: 520, height: 1400 } });
    await ctx.addInitScript(t => localStorage.setItem('ww_admin_token', t), jwt.sign({ role: 'admin' }, secretJwt, { expiresIn: '1h' }));
    const p = await ctx.newPage();
    p.on('dialog', d => d.accept().catch(() => {}));
    const ouvrirFiche = async () => {
      await p.goto(urlServeur + '/admin/');
      await p.waitForSelector(`.btn-edit[data-id="${M.reseau}"]`);
      await p.click(`.btn-edit[data-id="${M.reseau}"]`);
      await p.waitForSelector('#section-api', { state: 'visible' });
      await p.waitForFunction(() => !document.getElementById('api-cles-liste').textContent.includes('Chargement'));
    };
    // Point de départ connu : aucune clé (les scénarios en créent pour ce marchand).
    sql(`DELETE FROM api_cles WHERE marchand_id = '${M.reseau}'`);
    // La fiche exige un e-mail ; le marchand du filet n'en a pas.
    const emailAvant = sql(`SELECT coalesce(email_contact, '') FROM marchands WHERE id = '${M.reseau}'`);
    sql(`UPDATE marchands SET email_contact = 'filet-reseau@example.com' WHERE id = '${M.reseau}'`);
    const reglages = () => sql(`SELECT fils_par_point || '|' || plafond_vente_fils FROM marchands WHERE id = '${M.reseau}'`);

    await ouvrirFiche();
    verifier('fiche admin : section « API caisse » affichée, réglages par défaut en AED (1,00 AED pour 1 point, plafond 50 000 AED), aucune clé',
      [await p.inputValue('#f-api-aed-par-point'), await p.inputValue('#f-api-plafond-aed'), (await p.locator('#api-cles-liste').innerText()).trim()],
      ['1.00', '50000', 'Aucune clé.']);

    await p.fill('#f-api-aed-par-point', '0.5');
    await p.fill('#f-api-plafond-aed', '1000');
    await p.click('#btn-save-merchant');
    await p.waitForFunction(() => !document.getElementById('sheet-backdrop').classList.contains('open')
      || document.getElementById('sheet-err').style.display === 'block');
    const erreurFiche = await p.evaluate(() => document.getElementById('sheet-err').style.display === 'block' && document.getElementById('sheet-err').textContent);
    verifier('« 0,5 AED pour 1 point » et « plafond 1 000 AED » enregistrés en fils (50, 100 000)', [erreurFiche, reglages()], [false, '50|100000']);

    await ouvrirFiche();
    await p.click('#btn-api-cle-live');
    await p.waitForSelector('#api-cle-nouvelle', { state: 'visible' });
    await p.waitForFunction(() => document.querySelectorAll('#api-cles-liste .api-cle').length === 1);
    const cle = (await p.locator('#api-cle-valeur').innerText()).trim();
    if (process.env.FILET_CAPTURES) await p.locator('#section-api').screenshot({ path: `${process.env.FILET_CAPTURES}/admin-api-caisse.png` });
    verifier('« Générer une clé de production » : la clé s\'affiche une fois (avertissement), la base n\'en garde que l\'empreinte, la liste montre son préfixe',
      [/^wwk_live_[A-Za-z0-9_-]{40}$/.test(cle), sql(`SELECT count(*) FROM api_cles WHERE marchand_id = '${M.reseau}' AND empreinte = '${sha(cle)}'`),
       (await p.locator('#api-cles-liste').innerText()).includes(cle.slice(0, 15) + '…'),
       (await p.locator('#api-cle-nouvelle').innerText()).includes('elle ne sera plus jamais affichée')],
      [true, '1', true, true]);

    await ouvrirFiche();
    verifier('fiche rouverte : la clé n\'est plus nulle part dans la page (seul son préfixe reste)',
      [await p.isVisible('#api-cle-nouvelle'), (await p.content()).includes(cle.slice(15))], [false, false]);

    await p.click('#api-cles-liste [data-revoquer]');
    await p.waitForFunction(() => document.getElementById('api-cles-liste').textContent.includes('révoquée'));
    verifier('« Révoquer » : clé révoquée en base, la liste le dit, plus de bouton',
      [sql(`SELECT revoquee_le IS NOT NULL FROM api_cles WHERE marchand_id = '${M.reseau}'`), await p.locator('#api-cles-liste [data-revoquer]').count()],
      ['t', 0]);

    await p.fill('#f-api-aed-par-point', '0');
    await p.click('#btn-save-merchant');
    await p.waitForSelector('#sheet-err', { state: 'visible' });
    verifier('montant pour 1 point à 0 : refusé avant envoi, message clair, réglage inchangé',
      [(await p.locator('#sheet-err').innerText()).trim(), reglages()],
      ['API caisse : montant pour 1 point invalide (0,01 AED au moins)', '50|100000']);
    // Étape 2 (21/10) : code caisse d'une boutique, depuis la fiche « Boutiques ».
    const { B } = require('../scenarios');
    const avantCode = sql(`SELECT coalesce(code_externe, '') FROM points_de_vente WHERE id = '${B.b2}'`);
    const p2 = await ctx.newPage();
    p2.on('dialog', d => d.accept(d.type() === 'prompt' ? 'DXB-NAV-2' : undefined).catch(() => {}));
    await p2.goto(urlServeur + '/admin/');
    await p2.waitForSelector(`.btn-pdv[data-id="${M.reseau}"]`);
    await p2.click(`.btn-pdv[data-id="${M.reseau}"]`);
    await p2.waitForSelector(`.btn-pdv-code[data-id="${B.b2}"]`);
    await p2.click(`.btn-pdv-code[data-id="${B.b2}"]`);
    await p2.waitForFunction(() => document.getElementById('pdv-list').textContent.includes('DXB-NAV-2'));
    verifier('fiche « Boutiques » : « Code caisse » enregistre le code (DXB-NAV-2) et l\'affiche sous la boutique',
      sql(`SELECT code_externe FROM points_de_vente WHERE id = '${B.b2}'`), 'DXB-NAV-2');
    sql(`UPDATE points_de_vente SET code_externe = ${avantCode ? `'${avantCode}'` : 'NULL'} WHERE id = '${B.b2}'`);
    sql(`UPDATE marchands SET fils_par_point = 100, plafond_vente_fils = 5000000, email_contact = ${emailAvant ? `'${emailAvant}'` : 'NULL'} WHERE id = '${M.reseau}'`);
    await ctx.close();
  } finally {
    await nav.close();
  }
};
