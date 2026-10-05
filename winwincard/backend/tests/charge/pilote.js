'use strict';

// ════════════════════════════════════════════════════════════════════════════
// PILOTE DE LA CAMPAGNE (étape 15, temps 2) — service « pilote » du projet
// Railway de TEST. Un geste = une valeur de CAMPAGNE_ETAPE puis « Deploy » ; le
// pilote fait l'étape, écrit son résultat dans son journal et s'arrête
// (politique de redémarrage : Never).
//
//   attente   rien (valeur de repos : un push sur la branche de campagne
//             redéploie le pilote, qui rejouerait sinon la dernière étape)
//   temoin    prépare la base de test neuve (preparer.js, mode temoin)
//   donnees   charge les données factices au palier CHARGE_PLAFOND
//   adresse   sonde d'adresse contre l'entrée PUBLIQUE du serveur de test
//             (CIBLE_PUBLIQUE), puis l'adresse de la même sonde à ouvrir dans
//             un navigateur
//   autre     liste de scénarios du générateur (ex. scan,rush,campagne),
//             contre le serveur de test par le réseau privé (CIBLE)
//
// Variables : CAMPAGNE_ETAPE, CAMPAGNE_DATABASE_URL (temoin, donnees), CIBLE,
// CIBLE_PUBLIQUE, JWT_SECRET (celui du TEST), IMITATEUR, CHARGE_* (générateur
// et préparation). Les garde-fous sont ceux de preparer.js et de generateur.js :
// jamais la production, jamais une base sans témoin.
// ════════════════════════════════════════════════════════════════════════════

const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');

const ETAPE = (process.env.CAMPAGNE_ETAPE || 'attente').trim();
const dire = m => console.log(`[pilote] ${m}`);

// Arrêt demandé par Railway (redéploiement) : l'étape en cours est arrêtée et
// le dit. La préparation des données est une seule transaction : rien à moitié.
let enfant = null;
process.on('SIGTERM', () => {
  dire('ARRÊT demandé pendant l\'étape : interrompue');
  if (enfant) enfant.kill('SIGTERM');
  process.exit(143);
});

function lancer(fichier, envEnPlus) {
  return new Promise(resolve => {
    enfant = spawn(process.execPath, [path.join(__dirname, fichier)], {
      env: { ...process.env, NODE_OPTIONS: '', ...envEnPlus }, stdio: 'inherit' });
    enfant.on('exit', code => resolve(code ?? 1));
  });
}

(async () => {
  dire(`étape « ${ETAPE} »`);
  let code = 0;
  if (ETAPE === 'attente') {
    dire('rien à faire');
  } else if (ETAPE === 'temoin' || ETAPE === 'donnees') {
    code = await lancer('preparer.js', { CAMPAGNE_MODE: ETAPE });
  } else if (ETAPE === 'adresse') {
    code = await lancer('generateur.js', { CHARGE_SCENARIOS: 'adresse' });
    const publique = (process.env.CIBLE_PUBLIQUE || '').replace(/\/$/, '');
    if (code === 0 && publique) {
      // Clé dérivée du JWT_SECRET de TEST : n'ouvre que les sondes du serveur de test.
      const cle = crypto.createHash('sha256').update(`${process.env.JWT_SECRET}:campagne`).digest('hex').slice(0, 32);
      dire(`à ouvrir dans un navigateur (wifi, puis 4G) : ${publique}/__campagne/adresse?cle=${cle}`);
    }
  } else if (/^[a-z]+(,[a-z]+)*$/.test(ETAPE)) {
    code = await lancer('generateur.js', { CHARGE_SCENARIOS: ETAPE });
  } else {
    dire('CAMPAGNE_ETAPE inconnue : attente, temoin, donnees, adresse, ou une liste de scénarios (scan,rush,dashboard,campagne,cron,wifi)');
    code = 2;
  }
  dire(`FIN de l'étape « ${ETAPE} » : sortie ${code}${code === 0 ? ' (réussie)' : ' (ÉCHEC ou REFUS, voir au-dessus)'}`);
  process.exit(code);
})();
