'use strict';

// ════════════════════════════════════════════════════════════════════════════
// TEST NAVIGATEUR — la caisse après une erreur (étape 12)
//
// Les cas du diagnostic du 03/10, dans le vrai écran du scanner (Chromium,
// format téléphone, en français) contre le vrai serveur et la base du filet. La
// caméra est simulée par une carte « tenue devant l'objectif » (jsQR remplacé
// par un leurre qui rend son serial tant que window.__carte est posée).
//
// Contrainte de Yass (03/10) vérifiée ici aussi : le scan normal ne change en
// rien — aucune requête à l'ouverture, une seule requête par scan ; les seuls
// appels en plus sont le nouvel essai (après une erreur) et le renouvellement
// de session (rare).
//
// Hors `npm test` : exige Playwright. Lancement, depuis winwincard/backend :
//   NODE_PATH=$(npm root -g) FILET_EN_PLUS=tests/navigateur/cle_ecrans.js,tests/navigateur/caisse_erreurs.js node tests/lancer.js
// Le cas du limiteur épuise le quota de l'adresse locale : il passe en DERNIER.
// ════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { M, B } = require('../scenarios');

module.exports = async function ({ sql, verifier, secretJwt, urlServeur, api }) {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch { throw new Error('Playwright introuvable : lancer avec NODE_PATH=$(npm root -g)'); }

  const maintenant = () => Math.floor(Date.now() / 1000);
  const jetonM = (id, extra = {}) => jwt.sign({ role: 'marchand', marchand_id: id, tv: 1, ...extra }, secretJwt, { expiresIn: '1h' });
  const jetonB = (id, pdv) => jwt.sign({ role: 'scanner', marchand_id: id, point_de_vente_id: pdv, tv: 1 }, secretJwt, { expiresIn: '1h' });
  // Session longue (« se souvenir », un an) dont il reste `reste` jours.
  const jetonLong = (id, reste) => jwt.sign({ role: 'marchand', marchand_id: id, tv: 1,
    iat: maintenant() - (365 - reste) * 86400, exp: maintenant() + reste * 86400 }, secretJwt);
  const jetonAdmin = jwt.sign({ role: 'admin' }, secretJwt, { expiresIn: '1h' });
  const client = id => {
    const cid = crypto.randomUUID(), serial = crypto.randomUUID();
    sql(`INSERT INTO clients (id, marchand_id, prenom, stored_value, pass_serial_number) VALUES ('${cid}', '${id}', 'Sarah', 3, '${serial}');
         INSERT INTO passes (client_id, marchand_id, serial_number) VALUES ('${cid}', '${id}', '${serial}');`);
    return { id: cid, serial };
  };
  const etat = id => sql(`SELECT stored_value || '|' || (SELECT count(*) FROM scans WHERE client_id = '${id}') FROM clients WHERE id = '${id}'`);
  const titre = t => console.log(`\n— ${t}`);

  const nav = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    // Ouvre le scanner connecté. `reponse` : traitement des POST /api/scan
    // (null = le vrai serveur). `requetes` : toutes les requêtes /api/ de la page.
    async function ouvrir(token, reponse, extra = {}) {
      const ctx = await nav.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 780 } });
      await ctx.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); },
        { ww_token: token, ww_slug: 'demo', ww_nom: 'Boulangerie Démo', ww_type_programme: 'stamps', ww_scanner_lang: 'fr', ...extra });
      const page = await ctx.newPage();
      const ecran = { page, requetes: [], envois: 0 };
      page.on('dialog', d => d.dismiss().catch(() => {}));
      page.on('request', r => { if (r.url().includes('/api/')) ecran.requetes.push(`${r.method()} ${new URL(r.url()).pathname}`); });
      await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'text/javascript',
        body: 'window.jsQR = () => (window.__carte ? { data: window.__carte } : null);' }));
      await page.route('**/api/scan', r => {
        if (r.request().method() !== 'POST') return r.continue();
        ecran.envois++;
        return reponse ? reponse(r, ecran.envois) : r.continue();
      });
      await page.goto(urlServeur + '/scanner/');
      await page.waitForFunction(() => typeof submitScan === 'function' && state.scanning);
      return ecran;
    }
    // Geste caissière : carte devant la caméra → « Valider ce scan ? » → Valider.
    async function scannerCarte(page, serial) {
      await page.evaluate(s => { window.__carte = s; }, serial);
      await page.waitForFunction(() => document.getElementById('modal-confirm').classList.contains('open'));
      await page.click('#confirm-scan-btn');
    }
    const panneau = page => page.evaluate(() => document.getElementById('modal-incident').classList.contains('open')
      && [document.getElementById('incident-titre').textContent, document.getElementById('incident-principal').textContent]);
    const attendrePanneau = (page, ms = 30000) => page.waitForFunction(() => document.getElementById('modal-incident').classList.contains('open'), null, { timeout: ms });
    const resultat = page => page.waitForFunction(() => document.querySelector('#screen-result.active'));
    const bandeau = page => page.evaluate(() => document.getElementById('locked-card').classList.contains('open')
      && document.getElementById('locked-card-title').textContent);
    const ecranConnexion = page => page.evaluate(() => document.querySelector('#screen-login.active') !== null
      && document.getElementById('input-slug').value);

    // ── Le scan normal ne change pas ────────────────────────────────────────
    titre('Navigateur : la caisse après une erreur (étape 12)');
    {
      const c = client(M.tampons);
      const e = await ouvrir(jetonM(M.tampons), null);
      await e.page.waitForTimeout(500);
      verifier('ouverture de l\'appli : AUCUNE requête (pas de vérification de session)', e.requetes, []);
      await scannerCarte(e.page, c.serial);
      await resultat(e.page);
      await e.page.waitForTimeout(500);
      verifier('scan normal : UNE seule requête, crédité, mêmes écrans', [e.requetes, etat(c.id), await e.page.locator('#result-name').textContent()],
        [['POST /api/scan'], '4|1', 'Sarah']);
      await e.page.click('#btn-rescan');
      await e.page.waitForFunction(() => document.getElementById('locked-card').classList.contains('open'));
      verifier('carte encore tenue après un succès : « ✓ Sarah — déjà scanné » (inchangé)', await bandeau(e.page), '✓ Sarah — déjà scanné');
      await e.page.context().close();
    }

    // ── A. Erreur réseau ────────────────────────────────────────────────────
    {
      const c = client(M.tampons);
      const e = await ouvrir(jetonM(M.tampons), (r, n) => (n === 1 ? r.abort('failed') : r.continue()));
      await scannerCarte(e.page, c.serial);
      await resultat(e.page);
      verifier('A. réseau coupé UNE fois : nouvel essai automatique, crédité, aucun panneau',
        [etat(c.id), e.envois, await panneau(e.page)], ['4|1', 2, false]);
      await e.page.context().close();
    }
    {
      const c = client(M.tampons);
      let coupe = true;
      const e = await ouvrir(jetonM(M.tampons), r => (coupe ? r.abort('failed') : r.continue()));
      await scannerCarte(e.page, c.serial);
      await attendrePanneau(e.page);
      await e.page.waitForTimeout(1500);
      verifier('A. réseau coupé deux fois : panneau « Connexion perdue », Réessayer',
        await panneau(e.page), ['Connexion perdue', 'Réessayer']);
      verifier('… la carte tenue devant la caméra n\'est PAS reproposée (pas de « Valider ce scan ? »)',
        await e.page.evaluate(() => document.getElementById('modal-confirm').classList.contains('open')), false);
      coupe = false;
      await e.page.click('#incident-principal');
      await resultat(e.page);
      verifier('… « Réessayer » : crédité une fois', etat(c.id), '4|1');
      await e.page.context().close();
    }
    {
      const c = client(M.tampons);
      const e = await ouvrir(jetonM(M.tampons), r => r.abort('failed'));
      await scannerCarte(e.page, c.serial);
      await attendrePanneau(e.page);
      await e.page.evaluate(() => { window.__carte = null; });
      await e.page.click('#incident-secondaire');
      await e.page.evaluate(s => { window.__carte = s; }, c.serial);
      await e.page.waitForFunction(() => document.getElementById('locked-card').classList.contains('open'));
      verifier('A. « Annuler » puis carte toujours tenue : « ⚠️ Passage non confirmé » (plus « Carte déjà scannée »)',
        await bandeau(e.page), '⚠️ Passage non confirmé');
      await e.page.context().close();
    }

    // ── B. Pas de réponse ───────────────────────────────────────────────────
    {
      const c = client(M.tampons);
      const e = await ouvrir(jetonM(M.tampons), () => { /* jamais de réponse */ });
      const t0 = Date.now();
      await scannerCarte(e.page, c.serial);
      await attendrePanneau(e.page, 25000);
      const duree = (Date.now() - t0) / 1000;
      verifier('B. aucune réponse : panneau « Connexion perdue » au bout de 15 s (pas de « Traitement… » sans fin)',
        [await panneau(e.page), duree >= 14 && duree <= 17, e.envois], [['Connexion perdue', 'Réessayer'], true, 1]);
      await e.page.context().close();
    }

    // ── C. Session expirée (dont l'échéance d'un an) ────────────────────────
    {
      const c = client(M.tampons);
      const expire = jwt.sign({ role: 'marchand', marchand_id: M.tampons, tv: 1, exp: maintenant() - 60 }, secretJwt);
      const e = await ouvrir(expire, null, { ww_scanner_identifiant: 'filet-tampons' });
      await scannerCarte(e.page, c.serial);
      await attendrePanneau(e.page);
      verifier('C. session expirée : panneau « Session expirée », Se reconnecter', await panneau(e.page), ['Session expirée', 'Se reconnecter']);
      await e.page.click('#incident-principal');
      verifier('… écran de connexion, identifiant pré-rempli, rien crédité', [await ecranConnexion(e.page), etat(c.id)], ['filet-tampons', '3|0']);
      await e.page.context().close();
    }

    // ── D. Marchand suspendu ────────────────────────────────────────────────
    {
      const c = client(M.suspendu);
      const e = await ouvrir(jetonM(M.suspendu), null);
      await api('PATCH', `/api/admin/marchands/${M.suspendu}/suspension`, jetonAdmin, { actif: false });
      await scannerCarte(e.page, c.serial);
      await attendrePanneau(e.page);
      verifier('D. marchand suspendu : panneau « Compte suspendu », Se déconnecter', await panneau(e.page), ['Compte suspendu', 'Se déconnecter']);
      await e.page.click('#incident-principal');
      verifier('… écran de connexion', (await ecranConnexion(e.page)) !== false, true);
      await api('PATCH', `/api/admin/marchands/${M.suspendu}/suspension`, jetonAdmin, { actif: true });
      await e.page.context().close();
    }

    // ── E. Session révoquée ─────────────────────────────────────────────────
    {
      const c = client(M.tampons);
      const e = await ouvrir(jetonM(M.tampons, { tv: 0 }), null);
      await scannerCarte(e.page, c.serial);
      await attendrePanneau(e.page);
      verifier('E. session révoquée par l\'admin : panneau « Session expirée »', await panneau(e.page), ['Session expirée', 'Se reconnecter']);
      await e.page.context().close();
    }

    // ── F. Boutique coupée ──────────────────────────────────────────────────
    {
      const c = client(M.reseau);
      const e = await ouvrir(jetonB(M.reseau, B.coupee), null);
      await scannerCarte(e.page, c.serial);
      await attendrePanneau(e.page);
      verifier('F. boutique coupée : panneau « Caisse désactivée » (plus d\'écran figé)', await panneau(e.page), ['Caisse désactivée', 'Se déconnecter']);
      await e.page.context().close();
    }

    // ── G. Erreur serveur ───────────────────────────────────────────────────
    {
      const c = client(M.tampons);
      let pannes = 2;
      const e = await ouvrir(jetonM(M.tampons), r => (pannes-- > 0
        ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"TypeError: fetch failed"}' })
        : r.continue()));
      await scannerCarte(e.page, c.serial);
      await attendrePanneau(e.page);
      verifier('G. erreur serveur deux fois : panneau « Connexion perdue » (plus « TypeError: fetch failed »)',
        [await panneau(e.page), e.envois], [['Connexion perdue', 'Réessayer'], 2]);
      await e.page.click('#incident-principal');
      await resultat(e.page);
      verifier('… « Réessayer » : crédité une fois', etat(c.id), '4|1');
      await e.page.context().close();
    }

    // ── Refus en mots simples, bandeau juste ────────────────────────────────
    {
      const e = await ouvrir(jetonM(M.tampons), null);
      await scannerCarte(e.page, crypto.randomUUID());
      await resultat(e.page);
      verifier('carte inconnue : « Carte inconnue chez ce commerce »', await e.page.locator('#result-error').textContent(), 'Carte inconnue chez ce commerce');
      await e.page.click('#btn-rescan');
      await e.page.evaluate(() => { window.__carte = null; state.processing = false; });
      await e.page.evaluate(() => submitScan('zz'));
      verifier('code mal tapé : message clair', await e.page.locator('#result-error').textContent(),
        'Code invalide — scannez le QR ou tapez les 6 caractères du code de secours');
      await e.page.click('#btn-rescan');
      const c = client(M.tampons);
      await e.page.evaluate(s => { window.__carte = s; }, c.serial);
      await e.page.waitForFunction(() => document.getElementById('modal-confirm').classList.contains('open'));
      await e.page.click('#confirm-scan-cancel');
      await e.page.waitForFunction(() => document.getElementById('locked-card').classList.contains('open'));
      verifier('« Annuler » sur « Valider ce scan ? » : « Carte non enregistrée » (plus « Carte déjà scannée »)',
        [await bandeau(e.page), etat(c.id)], ['Carte non enregistrée', '3|0']);
      await e.page.context().close();
    }

    // ── Renouvellement silencieux ───────────────────────────────────────────
    {
      const c = client(M.tampons);
      const e = await ouvrir(jetonLong(M.tampons, 30), null);
      await scannerCarte(e.page, c.serial);
      await resultat(e.page);
      await e.page.waitForFunction(() => {
        try { return JSON.parse(atob(localStorage.getItem('ww_token').split('.')[1])).exp * 1000 - Date.now() > 300 * 86400000; }
        catch { return false; }
      });
      const neuf = jwt.decode(await e.page.evaluate(() => localStorage.getItem('ww_token')));
      verifier('session à 30 jours de l\'échéance : renouvelée APRÈS le scan, un an, même marchand',
        [e.requetes, Math.round((neuf.exp - maintenant()) / 86400), neuf.marchand_id],
        [['POST /api/scan', 'POST /api/scanner/renouveler'], 365, M.tampons]);
      await e.page.click('#btn-rescan');
      await e.page.evaluate(() => { window.__carte = null; });
      await scannerCarte(e.page, client(M.tampons).serial);
      await resultat(e.page);
      await e.page.waitForTimeout(500);
      verifier('… scan suivant : plus aucun renouvellement (une seule requête)', e.requetes.slice(2), ['POST /api/scan']);
      await e.page.context().close();

      const loin = await ouvrir(jetonLong(M.tampons, 200), null);
      await scannerCarte(loin.page, client(M.tampons).serial);
      await resultat(loin.page);
      await loin.page.waitForTimeout(500);
      verifier('session à 200 jours de l\'échéance : aucun renouvellement', loin.requetes, ['POST /api/scan']);
      await loin.page.context().close();
    }

    // ── Dashboard, onglet scanner : session expirée ─────────────────────────
    {
      const ctx = await nav.newContext({ serviceWorkers: 'block' });
      await ctx.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); },
        { ww_dash_token: jetonM(M.tampons), ww_dash_id: M.tampons, ww_dash_nom: 'Filet Tampons', ww_dash_slug: 'filet-tampons', ww_dash_lang: 'fr' });
      const page = await ctx.newPage();
      page.on('dialog', d => d.dismiss().catch(() => {}));
      await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'text/javascript', body: 'window.jsQR = () => null;' }));
      await page.goto(urlServeur + '/dashboard/');
      await page.waitForFunction(() => typeof submitScanDashboard === 'function' && S.token);
      const expire = jwt.sign({ role: 'marchand', marchand_id: M.tampons, tv: 1, exp: maintenant() - 60 }, secretJwt);
      await page.evaluate(t => { S.token = t; }, expire);
      await page.evaluate(s => submitScanDashboard(s), client(M.tampons).serial);
      const panneauDb = await page.evaluate(() => document.getElementById('modal-sc-incident').classList.contains('open')
        && document.getElementById('sc-incident-titre').textContent);
      await page.click('#sc-incident-principal');
      verifier('dashboard : session expirée pendant un scan → « Session expirée », puis connexion, identifiant pré-rempli',
        [panneauDb, await page.evaluate(() => document.getElementById('screen-login').classList.contains('active') && document.getElementById('in-slug').value)],
        ['Session expirée', 'filet-tampons']);
      await ctx.close();
    }

    // ── H. Limiteur (EN DERNIER : épuise le quota de l'adresse locale) ──────
    {
      const c = client(M.tampons);
      const e = await ouvrir(jetonM(M.tampons), null);
      let r429 = null;
      for (let n = 0; n < 320 && !r429; n++) {
        const r = await fetch(urlServeur + '/health');
        if (r.status === 429) r429 = r;
      }
      const brut = await fetch(urlServeur + '/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      verifier('H. limiteur : réponse en JSON {"error":"rate_limited"}, avec le délai (Retry-After)',
        [brut.status, await brut.json(), Number(brut.headers.get('retry-after')) > 0], [429, { error: 'rate_limited' }, true]);
      await scannerCarte(e.page, c.serial);
      await attendrePanneau(e.page);
      const [titreH] = await panneau(e.page);
      const texteH = await e.page.locator('#incident-texte').textContent();
      verifier('… écran : « Trop de demandes », délai en minutes, rien crédité (plus « Unexpected token »)',
        [titreH, /^Ce passage n'a pas été enregistré\. Réessayez dans \d+ min environ\.$/.test(texteH), etat(c.id)], ['Trop de demandes', true, '3|0']);
      await e.page.evaluate(() => { window.__carte = null; });
      await e.page.click('#incident-secondaire');
      await e.page.evaluate(s => { window.__carte = s; }, c.serial);
      await e.page.waitForFunction(() => document.getElementById('locked-card').classList.contains('open'));
      verifier('… « Annuler » : « Carte non enregistrée »', await bandeau(e.page), 'Carte non enregistrée');
      await e.page.context().close();
    }
  } finally {
    await nav.close();
  }
};
