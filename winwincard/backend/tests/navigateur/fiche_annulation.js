'use strict';

// ════════════════════════════════════════════════════════════════════════════
// TEST NAVIGATEUR — annuler depuis la fiche client du dashboard (étape 13)
//
// La vraie fiche client, dans Chromium, contre le serveur et la base du filet.
// Hors `npm test` : exige Playwright. Lancement, depuis winwincard/backend :
//   NODE_PATH=$(npm root -g) FILET_EN_PLUS=tests/navigateur/fiche_annulation.js node tests/lancer.js
// ════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { M, B } = require('../scenarios');

module.exports = async function ({ sql, verifier, secretJwt, urlServeur, api }) {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch { throw new Error('Playwright introuvable : lancer avec NODE_PATH=$(npm root -g)'); }

  const jetonM = id => jwt.sign({ role: 'marchand', marchand_id: id, tv: 1 }, secretJwt, { expiresIn: '1h' });
  const jetonB = (id, pdv) => jwt.sign({ role: 'scanner', marchand_id: id, point_de_vente_id: pdv, tv: 1 }, secretJwt, { expiresIn: '1h' });
  const client = (id, solde = 0) => {
    const cid = crypto.randomUUID(), serial = crypto.randomUUID();
    sql(`INSERT INTO clients (id, marchand_id, prenom, stored_value, pass_serial_number) VALUES ('${cid}', '${id}', 'Lina', ${solde}, '${serial}');
         INSERT INTO passes (client_id, marchand_id, serial_number) VALUES ('${cid}', '${id}', '${serial}');`);
    return { id: cid, serial };
  };
  const solde = id => Number(sql(`SELECT stored_value FROM clients WHERE id = '${id}'`));
  const lignesActives = id => sql(`SELECT string_agg(id::text, ',' ORDER BY date_scan DESC, id DESC) FROM scans WHERE client_id = '${id}' AND annule_le IS NULL`).split(',').filter(Boolean);
  const titre = t => console.log(`\n— ${t}`);

  const nav = await chromium.launch();
  // Ouvre le dashboard connecté. `ecran.dialogues` : textes des confirm/alert ;
  // `ecran.accepter` : réponse aux confirm. `ecran.requetes` : appels /api/.
  async function ouvrir(marchandId, slug, extra = {}) {
    const ctx = await nav.newContext({ serviceWorkers: 'block' });
    await ctx.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); },
      { ww_dash_token: jetonM(marchandId), ww_dash_id: marchandId, ww_dash_nom: 'Filet', ww_dash_slug: slug, ww_dash_lang: 'fr', ...extra });
    const page = await ctx.newPage();
    const ecran = { page, dialogues: [], accepter: true, requetes: [] };
    page.on('dialog', d => { ecran.dialogues.push(d.message()); (d.type() === 'confirm' && !ecran.accepter ? d.dismiss() : d.accept()).catch(() => {}); });
    page.on('request', r => { if (r.url().includes('/api/')) ecran.requetes.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'text/javascript', body: 'window.jsQR = () => null;' }));
    await page.goto(urlServeur + '/dashboard/');
    await page.waitForFunction(() => typeof openClientSheet === 'function' && S.token && S.maxValue);
    return ecran;
  }
  async function fiche(ecran, clientId) {
    ecran.requetes.length = 0;
    await ecran.page.evaluate(id => openClientSheet(id), clientId);
    await ecran.page.waitForFunction(() => S.clientData && document.querySelector('#cs-scans-list .cs-scan-row'));
  }
  const boutons = ecran => ecran.page.evaluate(() => [...document.querySelectorAll('#cs-scans-list .cs-undo')].map(b => b.dataset.scan));
  async function annulerDansFiche(ecran, clientId) {
    await ecran.page.click('#cs-scans-list .cs-undo');
    await ecran.page.waitForFunction(() => S.clientData);   // fiche rechargée (ou inchangée si refus)
    await ecran.page.waitForTimeout(300);
  }

  try {
    titre('Navigateur : annuler depuis la fiche client du dashboard (étape 13a)');
    const e = await ouvrir(M.tampons, 'filet-tampons');
    const tT = jetonM(M.tampons);

    const c = client(M.tampons);
    for (let i = 0; i < 3; i++) await api('POST', '/api/scan', tT, { serial_number: c.serial });
    const [s3, s2] = lignesActives(c.id);
    await fiche(e, c.id);
    verifier('fiche ouverte : une seule requête (comme avant), « Annuler » sur le dernier passage seulement',
      [e.requetes.filter(r => r !== 'GET /api/merchants/me'), await boutons(e)], [[`GET /api/clients/${c.id}`], [s3]]);

    e.accepter = false;
    await e.page.click('#cs-scans-list .cs-undo');
    await e.page.waitForTimeout(300);
    verifier('« Annuler » puis « Non » à la confirmation : rien ne bouge', [solde(c.id), lignesActives(c.id).length], [3, 3]);

    e.accepter = true;
    e.dialogues.length = 0;
    await annulerDansFiche(e, c.id);
    await e.page.waitForFunction(id => S.clientData && S.clientData.client.id === id && S.clientData.client.stored_value === 2, c.id);
    verifier('« Annuler » puis « Oui » : confirmation claire, solde 3 → 2, le bouton passe au passage d\'avant',
      [e.dialogues[0], solde(c.id), await boutons(e)], ['Annuler ce passage ? Le solde revient à 2.', 2, [s2]]);
    verifier('… le passage annulé reste visible, barré « annulé »',
      await e.page.evaluate(() => document.querySelector('#cs-scans-list .cs-scan-row .cs-scan-date').textContent.includes('annulé')), true);

    const d = client(M.tampons);
    await api('POST', '/api/scan', tT, { serial_number: d.serial });
    sql(`UPDATE clients SET stored_value = 5 WHERE id = '${d.id}'`);   // ajustement d'avant l'étape 13b (sans trace)
    await fiche(e, d.id);
    e.dialogues.length = 0;
    await annulerDansFiche(e, d.id);
    verifier('solde modifié depuis le passage : refus en mots simples, rien ne bouge',
      [e.dialogues[1], solde(d.id)], ['Annulation impossible : le solde a changé depuis ce passage (ajustement).', 5]);
    await e.page.context().close();

    const r = await ouvrir(M.reseau, 'filet-reseau');
    const cr = client(M.reseau);
    await api('POST', '/api/scan', jetonB(M.reseau, B.b1), { serial_number: cr.serial });
    await fiche(r, cr.id);
    await annulerDansFiche(r, cr.id);
    verifier('réseau : le gérant annule depuis sa fiche le passage fait dans une boutique', [solde(cr.id), lignesActives(cr.id).length], [0, 0]);
    await r.page.context().close();
  } finally {
    await nav.close();
  }
};
