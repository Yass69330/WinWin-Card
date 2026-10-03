'use strict';

// ════════════════════════════════════════════════════════════════════════════
// TEST NAVIGATEUR — la clé d'idempotence des écrans (étape 11b)
//
// Les vrais écrans (scanner, onglet scanner du dashboard) dans un vrai Chromium,
// contre le vrai serveur et la base rejouée du filet. Le cœur du test : le
// serveur crédite, mais la réponse est COUPÉE avant d'atteindre l'écran (réseau
// perdu, ou erreur 500) ; le nouvel essai doit reprendre la même clé et ne pas
// créditer une seconde fois.
//
// Hors `npm test` : exige Playwright, présent dans le conteneur cloud mais pas
// dépendance du projet. Lancement, depuis winwincard/backend :
//   NODE_PATH=$(npm root -g) FILET_EN_PLUS=tests/navigateur/cle_ecrans.js node tests/lancer.js
// La caméra est simulée (Chromium), jsQR remplacé par un leurre : les scans
// sont lancés en appelant les fonctions de la page, comme le ferait un tap.
// ════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { M } = require('../scenarios');

const DEJA_FR = 'Déjà enregistré — ce passage avait bien été pris en compte, rien n\'a été ajouté.';
const REFUS_ANNULE_FR = 'Ce passage a été annulé entre-temps. Rescannez pour l\'enregistrer.';

module.exports = async function ({ sql, verifier, secretJwt, urlServeur, api }) {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch { throw new Error('Playwright introuvable : lancer avec NODE_PATH=$(npm root -g)'); }

  const jeton = marchandId => jwt.sign({ role: 'marchand', marchand_id: marchandId, tv: 1 }, secretJwt, { expiresIn: '1h' });
  const client = marchandId => {
    const id = crypto.randomUUID(), serial = crypto.randomUUID();
    sql(`INSERT INTO clients (id, marchand_id, prenom, stored_value, pass_serial_number) VALUES ('${id}', '${marchandId}', 'Ecran', 0, '${serial}');
         INSERT INTO passes (client_id, marchand_id, serial_number) VALUES ('${id}', '${marchandId}', '${serial}');`);
    return { id, serial };
  };
  const etat = id => sql(`SELECT stored_value || '|' || (SELECT count(*) FROM scans WHERE client_id = '${id}') FROM clients WHERE id = '${id}'`);
  const titre = t => console.log(`\n— ${t}`);

  const navigateur = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    // Ouvre un écran déjà connecté. `coupure` : 'perdre' (le serveur crédite, la
    // réponse n'arrive jamais) ou 'erreur500' (le serveur crédite, l'écran reçoit
    // un 500) pour le PROCHAIN scan seulement. `cles` : clés envoyées, dans l'ordre.
    async function ouvrir(chemin, stockage) {
      const contexte = await navigateur.newContext({ serviceWorkers: 'block' });
      await contexte.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, stockage);
      const page = await contexte.newPage();
      page.on('dialog', d => d.dismiss().catch(() => {}));
      await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'text/javascript', body: 'window.jsQR = () => null;' }));
      const ecran = { page, coupure: null, cles: [] };
      await page.route('**/api/scan', async r => {
        if (r.request().method() !== 'POST') return r.continue();
        ecran.cles.push(JSON.parse(r.request().postData() || '{}').cle_idempotence);
        const coupure = ecran.coupure;
        ecran.coupure = null;
        if (!coupure) return r.continue();
        await r.fetch();                       // le serveur traite et crédite…
        if (coupure === 'perdre') return r.abort('failed');   // …la réponse se perd
        return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"panne simulée"}' });
      });
      await page.goto(urlServeur + chemin);
      return ecran;
    }

    // ── Scanner, tampons ────────────────────────────────────────────────────
    titre('Navigateur : scanner (tampons)');
    const sc = await ouvrir('/scanner/', { ww_token: jeton(M.tampons), ww_slug: 'filet-tampons', ww_nom: 'Filet Tampons', ww_type_programme: 'stamps', ww_scanner_lang: 'fr' });
    const p = sc.page;
    await p.waitForFunction(() => typeof submitScan === 'function' && state.token);
    const scanner = (serial, points) => p.evaluate(([s, n]) => submitScan(s, n), [serial, points]);
    const suivant = () => p.click('#btn-rescan');
    const deja = async () => (await p.locator('#result-deja').isVisible()) && (await p.locator('#result-deja').textContent());
    // Tap « + Ajouter un tampon » sur la carte restée devant la caméra : la carte
    // est posée sous verrou (comme après le scan précédent), puis le bouton est
    // tapé ; on attend la réponse du serveur et son affichage.
    const ajouterSurCarte = async (serial, affichage) => {
      await Promise.all([
        p.waitForResponse(r => r.url().endsWith('/api/scan') && r.request().method() === 'POST'),
        p.evaluate(s => { setCardLock(s, 'Ecran'); document.getElementById('locked-card-add').click(); }, serial),
      ]);
      await p.waitForFunction(affichage);
    };

    const a = client(M.tampons);
    sc.coupure = 'perdre';
    await scanner(a.serial);
    verifier('réponse perdue : le serveur a crédité (1 tampon, 1 ligne), l\'écran a eu une erreur réseau', etat(a.id), '1|1');
    await scanner(a.serial);
    verifier('… nouvel essai de la même carte : MÊME clé, rien recrédité', [etat(a.id), sc.cles[0] === sc.cles[1]], ['1|1', true]);
    verifier('… l\'écran dit « Déjà enregistré »', await deja(), DEJA_FR);
    await suivant();
    await ajouterSurCarte(a.serial, () => document.getElementById('progress-value').textContent === '2');
    verifier('après une réponse claire, « + Ajouter un tampon » : clé NEUVE, crédité (3 pizzas)', [etat(a.id), sc.cles[2] !== sc.cles[1]], ['2|2', true]);

    const b = client(M.tampons);
    await suivant();
    sc.coupure = 'erreur500';
    await scanner(b.serial);
    verifier('erreur 500 alors que le serveur a crédité : 1 tampon, 1 ligne', etat(b.id), '1|1');
    await suivant();
    await ajouterSurCarte(b.serial, () => document.getElementById('result-deja').style.display === 'block');
    verifier('… nouvel essai par « + Ajouter un tampon » : même clé, rien recrédité', [etat(b.id), sc.cles.at(-1) === sc.cles.at(-2)], ['1|1', true]);

    const c = client(M.tampons);
    await suivant();
    sc.coupure = 'perdre';
    await scanner(c.serial);
    await p.reload();
    await p.waitForFunction(() => typeof submitScan === 'function' && state.token);
    await scanner(c.serial);
    verifier('réponse perdue, puis écran RECHARGÉ (fermer/rouvrir) : même clé, rien recrédité', [etat(c.id), sc.cles.at(-1) === sc.cles.at(-2)], ['1|1', true]);

    const d = client(M.tampons);
    await suivant();
    sc.coupure = 'perdre';
    await scanner(d.serial);
    await scanner(d.serial.slice(-6));
    verifier('réponse perdue, nouvel essai par le CODE DE SECOURS : même clé, rien recrédité', [etat(d.id), sc.cles.at(-1) === sc.cles.at(-2)], ['1|1', true]);

    const e = client(M.tampons);
    await suivant();
    sc.coupure = 'perdre';
    await scanner(e.serial);
    await p.evaluate(() => {
      const k = JSON.parse(localStorage.getItem('ww_scanner_cle_en_attente'));
      k.cree -= 11 * 60 * 1000;
      localStorage.setItem('ww_scanner_cle_en_attente', JSON.stringify(k));
      _cleEnAttente = null;
    });
    await scanner(e.serial);
    verifier('clé de plus de 10 min : abandonnée, le nouvel essai est un NOUVEAU scan (crédité)', [etat(e.id), sc.cles.at(-1) !== sc.cles.at(-2)], ['2|2', true]);

    const f = client(M.tampons);
    await suivant();
    sc.coupure = 'perdre';
    await scanner(f.serial);
    const ligne = sql(`SELECT id FROM scans WHERE client_id = '${f.id}'`);
    await api('POST', `/api/scan/${ligne}/annuler`, jeton(M.tampons));
    await scanner(f.serial);
    verifier('scan annulé entre-temps, puis nouvel essai : refusé, message clair, rien recrédité',
      [etat(f.id), await p.locator('#result-error').textContent()], ['0|1', REFUS_ANNULE_FR]);
    await suivant();
    await scanner(f.serial);
    verifier('… le scan suivant prend une clé neuve et crédite', etat(f.id), '1|2');
    await sc.page.context().close();

    // ── Scanner, points ─────────────────────────────────────────────────────
    titre('Navigateur : scanner (points)');
    const sp = await ouvrir('/scanner/', { ww_token: jeton(M.points), ww_slug: 'filet-points', ww_nom: 'Filet Points', ww_type_programme: 'points', ww_scanner_lang: 'fr' });
    await sp.page.waitForFunction(() => typeof submitScan === 'function' && state.token);
    const scannerP = (serial, points) => sp.page.evaluate(([s, n]) => submitScan(s, n), [serial, points]);
    const g = client(M.points);
    sp.coupure = 'perdre';
    await scannerP(g.serial, 20);
    await scannerP(g.serial, 20);
    verifier('points : réponse perdue, même montant retapé : même clé, 20 crédités une seule fois', etat(g.id), '20|1');
    await sp.page.click('#btn-rescan');
    await scannerP(g.serial, 20);
    verifier('… après la réponse claire, un nouvel achat de 20 est crédité', etat(g.id), '40|2');
    const h = client(M.points);
    await sp.page.click('#btn-rescan');
    sp.coupure = 'perdre';
    await scannerP(h.serial, 20);
    await scannerP(h.serial, 25);
    verifier('points : réponse perdue, AUTRE montant tapé : nouveau scan, crédité (20 + 25)', [etat(h.id), sp.cles.at(-1) !== sp.cles.at(-2)], ['45|2', true]);
    await sp.page.context().close();

    // ── Dashboard, onglet scanner ───────────────────────────────────────────
    titre('Navigateur : onglet scanner du dashboard');
    const db = await ouvrir('/dashboard/', { ww_dash_token: jeton(M.tampons), ww_dash_id: M.tampons, ww_dash_nom: 'Filet Tampons', ww_dash_slug: 'filet-tampons', ww_dash_lang: 'fr' });
    await db.page.waitForFunction(() => typeof submitScanDashboard === 'function' && S.token);
    const k = client(M.tampons);
    db.coupure = 'perdre';
    await db.page.evaluate(s => submitScanDashboard(s), k.serial);
    await db.page.evaluate(() => { SC.processing = false; });
    await db.page.evaluate(s => submitScanDashboard(s), k.serial);
    verifier('dashboard : réponse perdue puis nouvel essai : même clé, rien recrédité, « Déjà enregistré »',
      [etat(k.id), db.cles[0] === db.cles[1], await db.page.locator('#sc-deja').textContent()], ['1|1', true, DEJA_FR]);
    await db.page.context().close();
  } finally {
    await navigateur.close();
  }
};
