'use strict';

// ════════════════════════════════════════════════════════════════════════════
// TEST NAVIGATEUR — l'Aperçu calculé en base et la panne lisible (étape 26)
//
// Le vrai dashboard dans un vrai Chromium, contre le vrai serveur et la base du
// filet. Joué APRÈS les scénarios : il réutilise les marchands de la section 19
// (« Filet Apercu Gros », mono-boutique ; « Filet Apercu Reseau », un réseau).
//   - Aperçu mono-boutique : les cartes d'apercu_stats, rien par boutique ;
//   - réseau : l'Aperçu et l'onglet Réseau affichent les mêmes chiffres ;
//   - panne : « Statistiques indisponibles » et Réessayer, jamais des zéros ;
//   - connexion : 503 database_unavailable → message lisible, pas le code brut.
// Captures d'écran dans CAPTURES (dossier ; défaut : dossier temporaire).
//
// Hors `npm test` : exige Playwright. Lancement, depuis winwincard/backend :
//   NODE_PATH=$(npm root -g) FILET_EN_PLUS=tests/navigateur/apercu_ecrans.js node tests/lancer.js
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
  const titre = t => console.log(`\n— ${t}`);
  const marchand = slug => sql(`SELECT id || '|' || nom FROM marchands WHERE slug = '${slug}'`).split('|');

  const navigateur = await chromium.launch();
  try {
    async function ouvrir(slug, avantChargement) {
      const [id, nom] = marchand(slug);
      const contexte = await navigateur.newContext({ serviceWorkers: 'block', viewport: { width: 420, height: 1100 } });
      const jeton = jwt.sign({ role: 'marchand', marchand_id: id, tv: 1 }, secretJwt, { expiresIn: '1h' });
      await contexte.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); },
        { ww_dash_token: jeton, ww_dash_id: id, ww_dash_nom: nom, ww_dash_slug: slug, ww_dash_lang: 'fr' });
      const page = await contexte.newPage();
      page.on('dialog', d => d.dismiss().catch(() => {}));
      if (avantChargement) await avantChargement(page);
      await page.goto(urlServeur + '/dashboard/');
      return page;
    }
    const cartes = async (page, selecteur) => page.$$eval(`${selecteur} .stat-card`, els => els.map(e =>
      [e.querySelector('.stat-label').textContent.trim(), e.querySelector('.stat-value').textContent.trim()]));

    titre('Navigateur : Aperçu mono-boutique');
    const mono = await ouvrir('filet-apercu-gros');
    await mono.waitForSelector('#stats-grid .stat-card');
    const cMono = await cartes(mono, '#stats-grid');
    await mono.locator('#tab-overview').screenshot({ path: path.join(captures, '1-apercu-mono-boutique.png') });
    const texteMono = await mono.locator('#stats-grid').innerText();
    verifier('Aperçu mono-boutique : 6 cartes (pas de « Taux de retour ») et la répartition sur 30 jours, rien par boutique, onglet Réseau caché',
      [cMono.map(c => c[0]).join(' | '), /Répartition des passages \(30 jours\)/.test(texteMono), /boutique/i.test(texteMono),
       await mono.locator('#nav-reseau').isVisible()],
      ['Clients au total | Scans aujourd\'hui | Actifs (30 jours) | Visites moy. / client actif (30j) | Taux de rétention | Nouveaux ce mois',
       true, false, false]);
    verifier('… les chiffres de la base : 1 200 clients, 1 200 actifs, 2x, rétention 100 %',
      [cMono[0][1], cMono[2][1], cMono[3][1], cMono[4][1]], ['1200', '1200', '2x', '100%']);
    await mono.context().close();

    titre('Navigateur : réseau, Aperçu et onglet Réseau');
    const reseau = await ouvrir('filet-apercu-reseau');
    await reseau.waitForSelector('#stats-grid .stat-card');
    await reseau.waitForSelector('#nav-reseau', { state: 'visible' });
    const cApercu = await cartes(reseau, '#stats-grid');
    await reseau.locator('#tab-overview').screenshot({ path: path.join(captures, '2-apercu-reseau.png') });
    await reseau.click('#nav-reseau');
    await reseau.waitForSelector('#tab-reseau .stat-card');
    const cReseau = await cartes(reseau, '#tab-reseau');
    await reseau.locator('#tab-reseau').screenshot({ path: path.join(captures, '3-onglet-reseau.png') });
    verifier('réseau : l\'Aperçu et l\'onglet Réseau affichent exactement les mêmes cartes ; le tableau par boutique reste dans l\'onglet Réseau',
      [JSON.stringify(cApercu) === JSON.stringify(cReseau), cApercu.length, await reseau.locator('#tab-reseau table.rs-table').count()],
      [true, 6, 1]);

    const nomsTableau = page => page.$$eval('#tab-reseau table.rs-table tbody tr td:first-child', tds => tds.map(td => td.textContent.trim()));

    // Déconnexion puis connexion d'un AUTRE réseau, sans recharger la page : l'onglet
    // Réseau montre le nouveau réseau, jamais les chiffres du précédent (défaut
    // corrigé au découpage, 18/10 : avant, la mémoire du réseau survivait).
    const nomsA = await nomsTableau(reseau);
    reseau.removeAllListeners('dialog');
    reseau.on('dialog', d => d.accept().catch(() => {}));
    await reseau.click('#btn-logout');
    await reseau.waitForSelector('#screen-login.active');
    const [idB, nomB] = marchand('filet-reseau');
    const jetonB = jwt.sign({ role: 'marchand', marchand_id: idB, tv: 1 }, secretJwt, { expiresIn: '1h' });
    await reseau.evaluate(d => { saveSession(d); showDashboard(); }, { token: jetonB, marchand_id: idB, nom: nomB, slug: 'filet-reseau' });
    await reseau.waitForSelector('#nav-reseau', { state: 'visible' });
    await reseau.click('#nav-reseau');
    await reseau.waitForSelector('#tab-reseau table.rs-table');
    const nomsB = await nomsTableau(reseau);
    const boutiquesB = sql(`SELECT string_agg(nom, '|') FROM points_de_vente WHERE marchand_id = '${idB}'`).split('|');
    verifier('déconnexion puis autre réseau (même page) : l\'onglet Réseau montre les boutiques du nouveau compte, aucune de l\'ancien',
      [nomsB.some(n => boutiquesB.some(b => n.startsWith(b))), nomsB.some(n => nomsA.includes(n))], [true, false]);

    // Tri du tableau (reseau.js, t42), sur ce réseau à plusieurs boutiques : un clic
    // sur « Boutique » trie A → Z, un second Z → A.
    await reseau.click('#tab-reseau th[data-sort="nom"]');
    const az = await nomsTableau(reseau);
    await reseau.click('#tab-reseau th[data-sort="nom"]');
    const za = await nomsTableau(reseau);
    const triAZ = [...az].sort((x, y) => x.toLowerCase() < y.toLowerCase() ? -1 : x.toLowerCase() > y.toLowerCase() ? 1 : 0);
    verifier('réseau : clic sur « Boutique » → tri A → Z, second clic → Z → A',
      [az.length > 1, JSON.stringify(az) === JSON.stringify(triAZ), JSON.stringify(za) === JSON.stringify([...triAZ].reverse())], [true, true, true]);
    await reseau.context().close();

    titre('Navigateur : statistiques en panne');
    let panne = true;
    const enPanne = await ouvrir('filet-apercu-gros', page => page.route('**/api/merchants/me/stats', r => panne
      ? r.fulfill({ status: 503, contentType: 'application/json', headers: { 'Retry-After': '30' }, body: '{"error":"database_unavailable"}' })
      : r.continue()));
    await enPanne.waitForSelector('#btn-stats-retry');
    const textePanne = await enPanne.locator('#stats-grid').innerText();
    await enPanne.locator('#tab-overview').screenshot({ path: path.join(captures, '4-apercu-en-panne.png') });
    verifier('panne : « Statistiques indisponibles pour le moment. » et Réessayer, aucun chiffre affiché',
      [textePanne.includes('Statistiques indisponibles pour le moment.'), textePanne.includes('Réessayer'),
       await enPanne.locator('#stats-grid .stat-card').count()], [true, true, 0]);
    panne = false;
    await enPanne.click('#btn-stats-retry');
    await enPanne.waitForSelector('#stats-grid .stat-card');
    verifier('… Réessayer, la base revenue : les statistiques s\'affichent (rien n\'avait été gardé)',
      (await cartes(enPanne, '#stats-grid'))[0], ['Clients au total', '1200']);
    await enPanne.context().close();

    titre('Navigateur : connexion du dashboard, base indisponible');
    const contexte = await navigateur.newContext({ serviceWorkers: 'block', viewport: { width: 420, height: 800 } });
    await contexte.addInitScript(() => localStorage.setItem('ww_dash_lang', 'fr'));
    const login = await contexte.newPage();
    await login.route('**/api/merchants/login', r => r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"database_unavailable"}' }));
    await login.goto(urlServeur + '/dashboard/');
    await login.fill('#in-slug', 'filet-tampons');
    await login.fill('#in-pwd', 'nimporte');
    await login.click('#btn-login');
    await login.waitForSelector('#login-err', { state: 'visible' });
    await login.screenshot({ path: path.join(captures, '5-connexion-base-indisponible.png') });
    verifier('connexion, base indisponible : message lisible (avant : « database_unavailable » brut)',
      (await login.locator('#login-err').innerText()).trim(), 'Service momentanément indisponible. Réessayez dans un instant.');
    await contexte.close();
    console.log(`captures : ${captures}`);
  } finally {
    await navigateur.close();
  }
};
