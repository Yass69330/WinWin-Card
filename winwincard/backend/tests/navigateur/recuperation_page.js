'use strict';

// ════════════════════════════════════════════════════════════════════════════
// TEST NAVIGATEUR — la page de récupération de carte (API des caisses, étape 3)
//
// La caisse demande un lien (POST /api/v1/recuperations) ; le client l'ouvre sur
// son nouveau téléphone (iPhone simulé, en français) : « Bonjour … ! » et
// « Ajouter à Apple Wallet » vers la MÊME carte ; lien expiré : message clair.
// ════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { M } = require('../scenarios');

module.exports = async function ({ sql, verifier, secretJwt, urlServeur }) {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch { throw new Error('Playwright introuvable : lancer avec NODE_PATH=$(npm root -g)'); }
  console.log('\n— Navigateur : page de récupération de carte (API, étape 3)');

  // Une carte avec un numéro rattaché, et une clé d'API du commerçant.
  const cid = crypto.randomUUID(), serial = crypto.randomUUID();
  sql(`INSERT INTO clients (id, marchand_id, prenom, stored_value, pass_serial_number, telephone, telephone_source)
       VALUES ('${cid}', '${M.points}', 'Sarah', 140, '${serial}', '0507770101', 'caisse');
       INSERT INTO passes (client_id, marchand_id, serial_number) VALUES ('${cid}', '${M.points}', '${serial}');`);
  const admin = jwt.sign({ role: 'admin' }, secretJwt, { expiresIn: '1h' });
  const enJson = (chemin, auth, corps) => fetch(urlServeur + chemin, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` }, body: JSON.stringify(corps) }).then(r => r.json());
  const cle = (await enJson(`/api/admin/marchands/${M.points}/cles-api`, admin, { environnement: 'test' })).cle;
  const lien = (await enJson('/api/v1/recuperations', cle, { telephone: '+971 50 777 0101' })).url;

  const nav = await chromium.launch();
  try {
    const ctx = await nav.newContext({ viewport: { width: 390, height: 780 }, locale: 'fr-FR',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
    const p = await ctx.newPage();
    await p.goto(String(lien).replace(/^https?:\/\/[^/]+/, urlServeur));
    await p.waitForFunction(() => !document.getElementById('carte').classList.contains('cache'));
    if (process.env.FILET_CAPTURES) await p.screenshot({ path: `${process.env.FILET_CAPTURES}/recuperation-page.png` });
    const texte = sel => p.$eval(sel, el => el.textContent.trim());
    verifier('page du client (iPhone) : « Bonjour Sarah ! », le commerce, « Ajouter à Apple Wallet » vers la MÊME carte, pas de bouton Google (carte sans Google)',
      [await texte('#titre'), await texte('#sous'), (await p.$eval('#btn-apple', a => a.href)).endsWith(`/api/passes/${serial}/apple`),
       await p.$eval('#btn-google', el => el.offsetParent !== null)],
      ['Bonjour Sarah !', 'Voici votre carte Filet Points, avec tous vos points.', true, false]);
    sql(`UPDATE recuperations_carte SET expire_le = now() - interval '1 second' WHERE client_id = '${cid}'`);
    await p.reload();
    await p.waitForFunction(() => !document.getElementById('erreur').classList.contains('cache'));
    verifier('lien expiré : « Ce lien a expiré », demander un nouveau lien en magasin',
      [await texte('#err-titre'), await texte('#err-sous')], ['Ce lien a expiré', 'Demandez un nouveau lien en magasin.']);
    await ctx.close();
  } finally {
    await nav.close();
  }
};
