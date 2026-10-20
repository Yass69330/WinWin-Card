'use strict';

// ════════════════════════════════════════════════════════════════════════════
// TEST NAVIGATEUR — numéro de téléphone et récupération de carte à la caisse
// (f04 côté comptoir, 20/10)
//
// Dans le vrai écran du scanner (Chromium, format téléphone, en français),
// contre le vrai serveur et la base du filet. Même leurre de caméra que
// caisse_erreurs.js (jsQR remplacé : rend window.__carte tant qu'elle est posée).
//
// Vérifie : « + numéro » après un scan, en deux temps (confirmation AVANT
// l'écriture, décision du 20/10) ; « Corriger » ; « Retrouver une carte »
// jusqu'au QR ; la page que le client ouvre ; et que le scan lui-même ne fait
// toujours qu'une requête.
// ════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { M } = require('../scenarios');

module.exports = async function ({ sql, verifier, secretJwt, urlServeur }) {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch { throw new Error('Playwright introuvable : lancer avec NODE_PATH=$(npm root -g)'); }

  const jetonM = id => jwt.sign({ role: 'marchand', marchand_id: id, tv: 1 }, secretJwt, { expiresIn: '1h' });
  const client = id => {
    const cid = crypto.randomUUID(), serial = crypto.randomUUID();
    sql(`INSERT INTO clients (id, marchand_id, prenom, stored_value, pass_serial_number) VALUES ('${cid}', '${id}', 'Sarah', 3, '${serial}');
         INSERT INTO passes (client_id, marchand_id, serial_number) VALUES ('${cid}', '${id}', '${serial}');`);
    return { id: cid, serial };
  };
  const tel = id => sql(`SELECT coalesce(telephone_normalise, '-') || '|' || coalesce(telephone_source, '-') FROM clients WHERE id = '${id}'`);
  const titre = t => console.log(`\n— ${t}`);
  // Numéros propres à ce test (le filet en a déjà attaché d'autres).
  const N1 = '0507770001', N2 = '0507770002', NF = '0507770009';

  const nav = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    async function ouvrir(token) {
      const ctx = await nav.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 780 } });
      await ctx.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); },
        { ww_token: token, ww_slug: 'filet-tampons', ww_nom: 'Filet Tampons', ww_type_programme: 'stamps', ww_scanner_lang: 'fr' });
      const page = await ctx.newPage();
      const ecran = { page, requetes: [], reponses: [] };
      page.on('dialog', d => d.dismiss().catch(() => {}));
      page.on('request', r => { if (r.url().includes('/api/')) ecran.requetes.push(`${r.method()} ${new URL(r.url()).pathname}`); });
      page.on('response', async r => {
        if (r.url().includes('/api/comptoir/recuperations')) ecran.reponses.push(await r.json().catch(() => null));
      });
      await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'text/javascript',
        body: 'window.jsQR = () => (window.__carte ? { data: window.__carte } : null);' }));
      await page.goto(urlServeur + '/scanner/');
      await page.waitForFunction(() => typeof submitScan === 'function' && state.scanning);
      return ecran;
    }
    async function scannerCarte(page, serial) {
      await page.evaluate(s => { window.__carte = s; }, serial);
      await page.waitForFunction(() => document.getElementById('modal-confirm').classList.contains('open'));
      await page.click('#confirm-scan-btn');
      await page.waitForFunction(() => document.querySelector('#screen-result.active'));
      await page.evaluate(() => { window.__carte = null; });
    }
    const capture = async (page, nom) => { if (process.env.FILET_CAPTURES) await page.screenshot({ path: `${process.env.FILET_CAPTURES}/${nom}.png` }); };
    const texte = (page, sel) => page.$eval(sel, el => el.textContent.trim());
    const visible = (page, sel) => page.$eval(sel, el => el.offsetParent !== null);

    titre('Navigateur : numéro de téléphone et récupération de carte à la caisse (f04)');
    const e = await ouvrir(jetonM(M.tampons));
    const p = e.page;
    verifier('écran du scanner : « Retrouver une carte » à côté de « Saisie manuelle », rien ne déborde en largeur téléphone',
      [await texte(p, '#btn-open-retrouver'), await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)],
      ['Retrouver une carte', true]);

    // ── « + numéro » : confirmation AVANT d'écrire ──
    const c = client(M.tampons);
    e.requetes.length = 0;
    await scannerCarte(p, c.serial);
    verifier('après le scan : « + Numéro » proposé ; le scan n\'a fait qu\'UNE requête, aucune vers le comptoir',
      [await visible(p, '#btn-tel-ajouter'), await texte(p, '#btn-tel-ajouter'), e.requetes], [true, '+ Numéro', ['POST /api/scan']]);
    await p.click('#btn-tel-ajouter');
    await p.fill('#tel-input', N1);
    await p.click('#tel-continuer');
    await p.waitForFunction(() => document.getElementById('tel-confirmation').style.display === 'flex');
    await capture(p, '1-confirmation');
    verifier('1er temps : « Attacher le +971 50 777 0001 à la carte de Sarah ? », RIEN écrit en base',
      [await texte(p, '#tel-question'), tel(c.id)], ['Attacher le +971 50 777 0001 à la carte de Sarah ?', '-|-']);
    await p.click('#tel-oui');
    await p.waitForFunction(() => document.getElementById('result-tel').style.display === 'block');
    await capture(p, '2-attache');
    verifier('« Oui, attacher » : numéro écrit (origine comptoir), retour affiché sur le résultat, « Scan suivant » toujours là',
      [tel(c.id), await texte(p, '#result-tel'), await visible(p, '#btn-tel-ajouter'), await visible(p, '#btn-rescan')],
      ['+971507770001|comptoir', '📞 +971 50 777 0001 attaché à cette carte', false, true]);

    // ── « Corriger » : la faute de frappe ne s'écrit jamais ──
    await p.click('#btn-rescan');
    await p.waitForFunction(() => state.scanning && document.querySelector('#screen-scanner.active'));
    const c2 = client(M.tampons);
    await scannerCarte(p, c2.serial);
    await p.click('#btn-tel-ajouter');
    await p.fill('#tel-input', NF);
    await p.click('#tel-continuer');
    await p.waitForFunction(() => document.getElementById('tel-confirmation').style.display === 'flex');
    await p.click('#tel-corriger');
    await p.fill('#tel-input', N2);
    await p.click('#tel-continuer');
    await p.waitForFunction(t => document.getElementById('tel-question').textContent.includes(t), '0002');
    await p.click('#tel-oui');
    await p.waitForFunction(() => document.getElementById('result-tel').style.display === 'block');
    verifier('faute de frappe vue à la confirmation → « Corriger » → bon numéro : seul le bon est écrit',
      [tel(c2.id), sql(`SELECT count(*) FROM clients WHERE telephone_normalise = '+971507770009'`)], ['+971507770002|comptoir', '0']);

    // ── Numéro déjà pris : refus dès le 1er temps ──
    await p.click('#btn-rescan');
    await p.waitForFunction(() => state.scanning && document.querySelector('#screen-scanner.active'));
    const c3 = client(M.tampons);
    await scannerCarte(p, c3.serial);
    await p.click('#btn-tel-ajouter');
    await p.fill('#tel-input', N1);
    await p.click('#tel-continuer');
    await p.waitForFunction(() => document.getElementById('tel-erreur').style.display === 'block');
    verifier('numéro déjà lié : message avant toute confirmation, rien écrit',
      [await texte(p, '#tel-erreur'), tel(c3.id)], ['Ce numéro est déjà lié à la carte de Sarah', '-|-']);
    await p.click('#tel-annuler');
    await p.click('#btn-rescan');
    await p.waitForFunction(() => state.scanning && document.querySelector('#screen-scanner.active'));

    // ── Retrouver une carte → QR ──
    await p.click('#btn-open-retrouver');
    verifier('« Retrouver une carte » ouvert : détection de cartes en pause', await p.evaluate(() => state.processing), true);
    await p.fill('#retrouver-input', '+971 50 777 0001');
    await p.click('#retrouver-chercher');
    await p.waitForFunction(() => document.getElementById('retrouver-trouve').style.display === 'flex');
    await capture(p, '3-retrouve');
    verifier('recherche : prénom et solde (après le scan du début) à vérifier avec le client', await texte(p, '#retrouver-carte'), 'Sarah · 4 tampons');   // 3 + le scan du début
    await p.click('#retrouver-qr-btn');
    await p.waitForFunction(() => document.getElementById('retrouver-qr').style.display === 'flex');
    await capture(p, '4-qr');
    const src = await p.$eval('#retrouver-qr-img', el => el.getAttribute('src') || '');
    verifier('QR affiché, compte à rebours de 10 minutes, récupération tracée en base',
      [src.startsWith('data:image/png'), /^(10:00|9:5\d)$/.test(await texte(p, '#retrouver-minuteur')),
       sql(`SELECT count(*) FROM recuperations_carte WHERE client_id = '${c.id}'`)], [true, true, '1']);
    await p.click('#retrouver-fin');
    verifier('« Terminé » : fenêtre fermée, détection rétablie',
      [await p.evaluate(() => document.getElementById('modal-retrouver').classList.contains('open')), await p.evaluate(() => state.processing)],
      [false, false]);

    // ── La page que le client ouvre (iPhone) ──
    const url = (e.reponses[0] || {}).url || '';
    const ctxIphone = await nav.newContext({ viewport: { width: 390, height: 780 }, locale: 'fr-FR',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
    const pc = await ctxIphone.newPage();
    await pc.goto(url.replace(/^https?:\/\/[^/]+/, urlServeur));
    await pc.waitForFunction(() => !document.getElementById('carte').classList.contains('cache'));
    verifier('page du client (iPhone) : « Bonjour Sarah ! », « Ajouter à Apple Wallet » vers la MÊME carte, pas de bouton Google (carte sans Google)',
      [await texte(pc, '#titre'), await visible(pc, '#btn-apple'), (await pc.$eval('#btn-apple', a => a.href)).endsWith(`/api/passes/${c.serial}/apple`),
       await visible(pc, '#btn-google')],
      ['Bonjour Sarah !', true, true, false]);
    await capture(pc, '5-page-client');
    sql(`UPDATE recuperations_carte SET expire_le = now() - interval '1 second' WHERE client_id = '${c.id}'`);
    await pc.reload();
    await pc.waitForFunction(() => !document.getElementById('erreur').classList.contains('cache'));
    verifier('page du client, QR expiré : « Ce lien a expiré », demander un nouveau QR au comptoir',
      [await texte(pc, '#err-titre'), await texte(pc, '#err-sous')], ['Ce lien a expiré', 'Demandez au comptoir un nouveau QR code.']);
    await ctxIphone.close();
  } finally {
    await nav.close();
  }
};
