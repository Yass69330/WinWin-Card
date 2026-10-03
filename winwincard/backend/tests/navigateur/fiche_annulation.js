'use strict';

// ════════════════════════════════════════════════════════════════════════════
// TEST NAVIGATEUR — la fiche client du dashboard : annuler, ajuster (étape 13)
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
  const boutons = ecran => ecran.page.evaluate(() => [...document.querySelectorAll('#cs-scans-list .cs-undo')].map(b => b.dataset.id));
  const journal = id => sql(`SELECT coalesce(string_agg(stored_value_avant || '→' || stored_value_apres || (CASE WHEN annule_le IS NULL THEN '' ELSE '(annulé)' END), ',' ORDER BY date_ajustement), '')
                             FROM ajustements WHERE client_id = '${id}'`);
  // Fenêtre « Ajuster les points » de la fiche : saisir une valeur, valider.
  async function ajusterDansFiche(ecran, valeur) {
    await ecran.page.click('#cs-btn-adjust');
    await ecran.page.fill('#adjust-input', String(valeur));
    await ecran.page.click('#adjust-confirm');
    await ecran.page.waitForTimeout(600);
  }
  const erreurAjustement = ecran => ecran.page.evaluate(() => getComputedStyle(document.getElementById('adjust-err')).display !== 'none'
    && document.getElementById('adjust-err').textContent);
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

    // ── 13b : ajustements tracés, vérifiés, annulables dans l'ordre ─────────
    titre('Navigateur : ajustements dans la fiche (étape 13b)');
    const e2 = await ouvrir(M.tampons, 'filet-tampons');
    const g = client(M.tampons, 1);
    await api('POST', '/api/scan', tT, { serial_number: g.serial });       // 1 → 2
    await fiche(e2, g.id);
    await ajusterDansFiche(e2, 9);
    const ajId = sql(`SELECT id FROM ajustements WHERE client_id = '${g.id}'`);
    verifier('ajustement 2 → 9 depuis la fiche : tracé, visible « ✎ 2 → 9 pts · ajustement », « Annuler » dessus',
      [journal(g.id), await e2.page.evaluate(() => {
        const ligne = document.querySelector('#cs-scans-list .cs-scan-row').textContent.replace(/\s+/g, ' ').trim();
        return ligne.startsWith('✎ 2 → 9 pts') && ligne.includes('· ajustement');
      }), await boutons(e2)],
      ['2→9', true, [ajId]]);
    e2.dialogues.length = 0;
    await annulerDansFiche(e2, g.id);
    await e2.page.waitForFunction(() => S.clientData && S.clientData.client.stored_value === 2);
    verifier('« Annuler » l\'ajustement : « Annuler cet ajustement ? Le solde revient à 2. », solde 2, bouton passé au scan',
      [e2.dialogues[0], journal(g.id), (await boutons(e2)).length === 1 && (await boutons(e2))[0] !== ajId], ['Annuler cet ajustement ? Le solde revient à 2.', '2→9(annulé)', true]);
    await annulerDansFiche(e2, g.id);
    await e2.page.waitForFunction(() => S.clientData && S.clientData.client.stored_value === 1);
    verifier('… puis le scan d\'avant : 2 → 1 (plus de blocage « solde incohérent »)', solde(g.id), 1);

    const h = client(M.tampons, 2);
    await fiche(e2, h.id).catch(() => {});
    await e2.page.evaluate(id => openClientSheet(id), h.id);
    await e2.page.waitForFunction(id => S.clientData && S.clientData.client.id === id, h.id);
    await api('POST', '/api/scan', tT, { serial_number: h.serial });       // un scan passe : 2 → 3
    await ajusterDansFiche(e2, 5);
    verifier('un scan passe pendant que la fiche est ouverte : ajustement refusé, message clair, le scan est gardé',
      [await erreurAjustement(e2), solde(h.id), journal(h.id)],
      ['Un scan vient de passer : le solde est maintenant de 3. Vérifiez et recommencez.', 3, '']);
    await e2.page.click('#adjust-cancel');

    const k = client(M.tampons, 4);
    await e2.page.evaluate(id => openClientSheet(id), k.id);
    await e2.page.waitForFunction(id => S.clientData && S.clientData.client.id === id, k.id);
    await ajusterDansFiche(e2, 11);
    verifier('tampons : au-dessus du seuil refusé, comme avant (plafond inchangé)', [await erreurAjustement(e2), solde(k.id)], ['Valeur entre 0 et 10', 4]);
    await e2.page.context().close();

    const ep = await ouvrir(M.points, 'filet-points', { ww_dash_type_programme: 'points' });
    await ep.page.waitForFunction(() => S.typeProgramme === 'points');
    const q = client(M.points, 100);
    await ep.page.evaluate(id => openClientSheet(id), q.id);
    await ep.page.waitForFunction(id => S.clientData && S.clientData.client.id === id, q.id);
    ep.accepter = false; ep.dialogues.length = 0;
    await ajusterDansFiche(ep, 900);
    verifier('points : 900 > seuil 500 → confirmation à l\'écran ; « Non » : rien d\'écrit',
      [ep.dialogues[0], solde(q.id), journal(q.id)],
      ['Le solde (900) dépassera le seuil (500) : la récompense sera à remettre au prochain passage. Confirmer ?', 100, '']);
    ep.accepter = true;
    await ep.page.click('#adjust-confirm');
    await ep.page.waitForTimeout(600);
    verifier('… « Oui » : 900 accepté et tracé (plus de plafond au seuil en points)', [solde(q.id), journal(q.id)], [900, '100→900']);
    await ep.page.context().close();
  } finally {
    await nav.close();
  }
};
