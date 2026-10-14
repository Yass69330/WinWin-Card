'use strict';

// ════════════════════════════════════════════════════════════════════════════
// CONTRÔLE DE SYNTAXE DES ÉCRANS (f17) — joué par `npm test`, avant les scénarios
//
// Le dashboard, l'admin et la caisse sont des pages à <script> en ligne : une
// seule erreur de syntaxe n'importe où arrête tout l'écran, et rien côté
// serveur ne s'en aperçoit. Ce contrôle compile (sans l'exécuter) chaque script
// en ligne de ces pages et chaque fichier JS du dashboard (ma-carte.js…).
// Il ne voit que la SYNTAXE : une erreur à l'exécution relève du test
// navigateur « tous les onglets » (tests/navigateur/onglets.js).
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUBLIC = path.resolve(__dirname, '..', 'public');
const PAGES = ['dashboard/index.html', 'admin/index.html', 'scanner/index.html'];

function scriptsEnLigne(html) {
  const scripts = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attributs = m[1] || '';
    if (/\bsrc\s*=/.test(attributs)) continue;                       // fichier externe : contrôlé à part
    if (/type\s*=\s*["']?(application\/(ld\+)?json|text\/template)/i.test(attributs)) continue;
    scripts.push({ code: m[2], ligne: html.slice(0, m.index).split('\n').length });
  }
  return scripts;
}

function controler(nom, code) {
  try { new vm.Script(code, { filename: nom }); return null; }
  catch (e) { return `${nom} : ${e.message}`; }
}

// Rend [{ nom, erreur }] ; erreur null = la syntaxe passe.
function controlerTout() {
  const resultats = [];
  for (const page of PAGES) {
    const fichier = path.join(PUBLIC, page);
    if (!fs.existsSync(fichier)) continue;
    const scripts = scriptsEnLigne(fs.readFileSync(fichier, 'utf8'));
    const erreurs = scripts.map(s => controler(`${page}:${s.ligne}`, s.code)).filter(Boolean);
    resultats.push({ nom: `${page} (${scripts.length} script(s) en ligne)`, erreur: erreurs.join(' | ') || null });
  }
  const dossier = path.join(PUBLIC, 'dashboard');
  for (const f of fs.readdirSync(dossier).filter(f => f.endsWith('.js') && f !== 'sw.js').sort()) {
    resultats.push({ nom: `dashboard/${f}`, erreur: controler(`dashboard/${f}`, fs.readFileSync(path.join(dossier, f), 'utf8')) });
  }
  return resultats;
}

module.exports = { controlerTout, scriptsEnLigne, controler };
