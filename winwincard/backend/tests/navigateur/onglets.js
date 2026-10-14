'use strict';

// ════════════════════════════════════════════════════════════════════════════
// TEST NAVIGATEUR — TOUS LES ONGLETS DU DASHBOARD (f17)
//
// Joué APRÈS les scénarios : marchand « Filet Thème » (Pro+, section 26) et ses
// deux thèmes. Trois choses :
//   1. chaque onglet s'ouvre sans aucune erreur de page ni de console ;
//   2. « Ma carte » cassé (ma-carte.js remplacé par un fichier invalide) : seul
//      cet onglet le dit, les autres fonctionnent ;
//   3. « Ma carte » : aperçus, choix d'un thème, activation, arrêt.
// Captures dans CAPTURES. Hors `npm test` : exige Playwright. Lancement :
//   NODE_PATH=$(npm root -g) FILET_EN_PLUS=tests/navigateur/onglets.js node tests/lancer.js
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

// Bruit attendu d'un navigateur sans caméra ni réseau extérieur : pas une erreur du dashboard.
const BRUIT = /Requested device not found|NotFoundError|NotAllowedError|getUserMedia|net::ERR_|Failed to load resource/;

module.exports = async function ({ sql, verifier, secretJwt, urlServeur }) {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch { throw new Error('Playwright introuvable : lancer avec NODE_PATH=$(npm root -g)'); }
  const captures = process.env.CAPTURES || fs.mkdtempSync(path.join(os.tmpdir(), 'captures-'));
  fs.mkdirSync(captures, { recursive: true });
  console.log('\n— Navigateur : tous les onglets du dashboard, « Ma carte »');

  const [id, nom, slug] = sql(`SELECT id || '|' || nom || '|' || slug FROM marchands WHERE slug = 'filet-theme'`).split('|');
  // Une boutique pour que l'onglet Réseau s'affiche aussi.
  sql(`INSERT INTO points_de_vente (marchand_id, nom, actif, scanner_login) VALUES ('${id}', 'Boutique Thème', true, 'filet-theme-b1') ON CONFLICT DO NOTHING`);
  const jeton = jwt.sign({ role: 'marchand', marchand_id: id, tv: 1 }, secretJwt, { expiresIn: '1h' });

  const sharp = require('sharp');
  const logo = svg => sharp(Buffer.from(svg)).png().toBuffer();
  const logos = {
    'standard.png': await logo(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="100"><text x="4" y="66" font-family="Georgia, serif" font-style="italic" font-weight="700" font-size="58" fill="#f0a35e">3Poivres</text></svg>`),
    'ramadan.png': await logo(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="100"><circle cx="48" cy="50" r="34" fill="#d4af37"/><circle cx="62" cy="42" r="30" fill="#0b3d2e"/><text x="96" y="64" font-family="Georgia, serif" font-weight="700" font-size="40" fill="#d4af37">Ramadan</text></svg>`),
  };
  const navigateur = await chromium.launch();
  async function ouvrir({ largeur = 420, hauteur = 1100, casser = false } = {}) {
    const contexte = await navigateur.newContext({ serviceWorkers: 'block', viewport: { width: largeur, height: hauteur } });
    await contexte.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); },
      { ww_dash_token: jeton, ww_dash_id: id, ww_dash_nom: nom, ww_dash_slug: slug, ww_dash_lang: 'fr', ww_dash_forfait: 'pro_plus' });
    // Logos préfabriqués : servis ici comme le ferait Storage (le filet n'a pas de Storage).
    await contexte.route('https://logos.exemple/**', r => r.fulfill({ contentType: 'image/png', body: logos[r.request().url().split('/').pop()] || logos['standard.png'] }));
    if (casser) await contexte.route('**/dashboard/ma-carte.js*', r => r.fulfill({ contentType: 'application/javascript', body: 'window.MaCarte = { charger( ;' }));
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(`page : ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !BRUIT.test(m.text())) erreurs.push(`console : ${m.text()}`); });
    page.on('dialog', d => d.accept().catch(() => {}));
    await page.goto(urlServeur + '/dashboard/');
    await page.waitForSelector('#stats-grid .stat-card');
    return { contexte, page, erreurs };
  }
  async function toutOuvrir(page) {
    const onglets = await page.$$eval('.nav-btn', bs => bs.filter(b => b.style.display !== 'none').map(b => b.dataset.tab));
    const etat = {};
    for (const o of onglets) {
      await page.click(`.nav-btn[data-tab="${o}"]`);
      await page.waitForTimeout(o === 'scanner' ? 1200 : 800);
      etat[o] = await page.evaluate(t => {
        const p = document.getElementById('tab-' + t);
        return p.classList.contains('active') && p.textContent.trim().length > 0;
      }, o);
    }
    await page.click('.nav-btn[data-tab="overview"]');
    return { onglets, etat };
  }

  try {
    // 1. Tous les onglets, sans erreur.
    const a = await ouvrir({ hauteur: 2600 });   // l'onglet entier visible pour les captures
    const tous = await toutOuvrir(a.page);
    verifier('navigateur, tous les onglets (Pro+, réseau) : chacun s\'ouvre, rempli, sans aucune erreur de page ni de console',
      [tous.onglets.join(','), Object.values(tous.etat).every(Boolean), a.erreurs],
      ['overview,reseau,clients,scans,scanner,notifs,carte', true, []]);

    // 3. « Ma carte » : aperçus, choix, activation, arrêt.
    const p = a.page;
    // L'onglet a déjà été ouvert une fois : attendre SA nouvelle lecture, puis le rendu.
    await Promise.all([p.waitForResponse(r => r.url().includes('/api/merchants/me/themes')), p.click('.nav-btn[data-tab="carte"]')]);
    await p.waitForSelector('#tab-carte .mc-carte');
    await p.waitForFunction(() => [...document.querySelectorAll('#tab-carte img')].every(i => i.complete));
    await p.waitForTimeout(200);
    const images = await p.$$eval('#tab-carte .mc-carte', els => els.map(e =>
      [e.querySelector('.mc-logo'), e.querySelector('.mc-banniere'), e.querySelector('.mc-qr')].map(i => !!(i && i.naturalWidth > 0)).join('')));
    verifier('navigateur, « Ma carte » : chaque aperçu affiche un vrai logo, la vraie bannière et le QR (images chargées)',
      images, ['truetruetrue', 'truetruetrue', 'truetruetrue']);
    const noms = await p.$$eval('#tab-carte .mc-nom', els => els.map(e => e.textContent.trim()));
    const fonds = await p.$$eval('#tab-carte .mc-carte', els => els.map(e => getComputedStyle(e).backgroundColor));
    const cases = await p.$$eval('#tab-carte .mc-case', els => els.map(e => e.textContent.trim()));
    await p.locator('#tab-carte').screenshot({ path: path.join(captures, 'f17-1-ma-carte.png') });
    await p.click('#tab-carte [data-choisir]');
    await p.waitForSelector('#tab-carte .mc-form');
    const message = (await p.textContent('#tab-carte .mc-msg')).trim();
    await p.locator('#tab-carte .mc-form').screenshot({ path: path.join(captures, 'f17-2-choix.png') });
    await p.fill('#tab-carte .mc-form input[name="fin"]', await p.inputValue('#tab-carte .mc-form input[name="debut"]'));
    await p.click('#tab-carte .mc-form button[type="submit"]');
    await p.waitForSelector('#tab-carte .mc-etat #mc-arreter');
    const etat = (await p.textContent('#tab-carte .mc-etat')).replace(/\s+/g, ' ').trim();
    const boutons = await p.$$eval('#tab-carte [data-choisir]', b => b.length);
    await p.locator('#tab-carte').screenshot({ path: path.join(captures, 'f17-3-theme-en-cours.png') });
    const fiche = sql(`SELECT theme_actif->>'etat' FROM marchands WHERE id = '${id}'`);
    await p.click('#mc-arreter');
    await p.waitForFunction(() => !document.querySelector('#tab-carte .mc-etat #mc-arreter'));
    verifier('navigateur, « Ma carte » : carte standard + 2 thèmes (fond et texte de la case dessinés) ; message d\'ouverture affiché avant activation ; activé → « en cours », plus de choix possible ; arrêt → carte standard ; aucune erreur',
      [noms, fonds, cases, message, /Thème « Ramadan » en cours/.test(etat), boutons, fiche,
       sql(`SELECT theme_actif IS NULL FROM marchands WHERE id = '${id}'`), a.erreurs],
      [['Carte standard', 'Ramadan', 'Fête nationale'], ['rgb(74, 26, 42)', 'rgb(11, 61, 46)', 'rgb(0, 115, 47)'], ['Ramadan Kareem'],
       'À l\'ouverture, vos clients reçoivent : « Ramadan Kareem ! Votre carte se met aux couleurs du mois. »', true, 0, 'en_cours', 't', []]);
    await a.contexte.close();

    // Largeur de téléphone : la barre d'onglets tient (7 onglets).
    const tel = await ouvrir({ largeur: 375 });
    const deborde = await tel.page.evaluate(() => document.querySelector('.dash-nav').scrollWidth > document.querySelector('.dash-nav').clientWidth);
    await tel.page.click('.nav-btn[data-tab="carte"]');
    await tel.page.waitForSelector('#tab-carte .mc-carte');
    await tel.page.waitForFunction(() => [...document.querySelectorAll('#tab-carte img')].every(i => i.complete));
    await tel.page.screenshot({ path: path.join(captures, 'f17-4-telephone-375.png') });
    verifier('navigateur, téléphone (375 px) : la barre des 7 onglets ne déborde pas', deborde, false);
    await tel.contexte.close();

    // 2. ma-carte.js cassé : seul « Ma carte » le dit.
    const c = await ouvrir({ casser: true });
    const casse = await toutOuvrir(c.page);
    await c.page.click('.nav-btn[data-tab="carte"]');
    const texteCarte = (await c.page.textContent('#tab-carte')).trim();
    await c.page.screenshot({ path: path.join(captures, 'f17-5-onglet-casse.png') });
    await c.page.click('.nav-btn[data-tab="clients"]');
    await c.page.waitForTimeout(600);
    const clientsOk = await c.page.evaluate(() => document.getElementById('tab-clients').classList.contains('active'));
    verifier('navigateur, « Ma carte » cassé (fichier invalide) : les autres onglets s\'ouvrent ; « Ma carte » affiche « indisponible » ; seule erreur : celle du fichier cassé',
      [Object.entries(casse.etat).filter(([o]) => o !== 'carte').every(([, v]) => v), texteCarte, clientsOk,
       c.erreurs.length, /Unexpected|SyntaxError|expected/i.test(c.erreurs[0] || '')],
      [true, 'Onglet momentanément indisponible. Rechargez la page.', true, 1, true]);
    await c.contexte.close();
    console.log(`captures : ${captures}`);
  } finally {
    await navigateur.close();
  }
};
