#!/usr/bin/env node
// ============================================================
// WinWin Card — Test génération .pkpass local
//
// Usage :
//   node scripts/test-pass.js
//   node scripts/test-pass.js --certs ~/Desktop --out ~/Desktop/test.pkpass
//
// Prérequis :
//   npm install   (depuis le dossier backend/)
//   3 fichiers .pem dans --certs (signerCert.pem, signerKey.pem, wwdr.pem)
// ============================================================

const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ── Parsing arguments CLI ────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}

const certsDir = getArg('--certs', path.join(os.homedir(), 'Desktop'));
const outFile  = getArg('--out',   path.join(os.homedir(), 'Desktop', 'winwincard-test.pkpass'));

// ── Variables d'environnement pour le service ────────────────
process.env.APPLE_SIGNER_CERT  = path.join(certsDir, 'signerCert.pem');
process.env.APPLE_SIGNER_KEY   = path.join(certsDir, 'signerKey.pem');
process.env.APPLE_WWDR_CERT    = path.join(certsDir, 'wwdr.pem');
process.env.APPLE_PASS_TYPE_IDENTIFIER = 'pass.com.winwincard.loyalty';
process.env.APPLE_TEAM_ID      = 'LTW34ARCX2';
process.env.API_BASE_URL       = 'https://api.winwincard.fr';
process.env.JWT_SECRET         = 'test-secret-32-chars-minimum-ok';

// ── Vérification des certificats ─────────────────────────────
const certFiles = ['signerCert.pem', 'signerKey.pem', 'wwdr.pem'];
let certsOk = true;

console.log('\n📋 Vérification des certificats...');
for (const file of certFiles) {
  const fullPath = path.join(certsDir, file);
  if (fs.existsSync(fullPath)) {
    console.log(`  ✅ ${file}`);
  } else {
    console.log(`  ❌ ${file} introuvable dans ${certsDir}`);
    certsOk = false;
  }
}

if (!certsOk) {
  console.error(`\n❌ Certificats manquants. Place tes .pem dans : ${certsDir}`);
  console.error('   Ou relance avec : node scripts/test-pass.js --certs /chemin/vers/certs\n');
  process.exit(1);
}

// ── Données de test ──────────────────────────────────────────
const testClient = {
  prenom:        'Marie',
  stored_value:  7,
};

const testMarchand = {
  nom:            'Café Le Central',
  couleur_fond:   '#1a1a2e',
  couleur_texte:  '#ffffff',
  couleur_label:  '#a0a0b0',
  logo_url:       null,
  image_strip_url: null,
  images_tiers:   null,
  max_value:      10,
};

const testSerial = 'test-serial-' + Date.now();

// ── Génération ───────────────────────────────────────────────
async function main() {
  console.log('\n🔨 Génération du pass...');
  console.log(`   Client  : ${testClient.prenom} (${testClient.stored_value}/${testMarchand.max_value} points)`);
  console.log(`   Marchand: ${testMarchand.nom}`);
  console.log(`   Serial  : ${testSerial}`);

  const { generateApplePass } = require('../src/services/apple-pass');

  let buffer;
  try {
    buffer = await generateApplePass({
      client:   testClient,
      marchand: testMarchand,
      serialNumber: testSerial,
    });
  } catch (err) {
    console.error('\n❌ Erreur génération :', err.message);
    if (err.message.includes('passphrase') || err.message.includes('bad decrypt')) {
      console.error('   → La clé privée est protégée par un mot de passe.');
      console.error('   → Ajoute APPLE_PASS_PHRASE=ton_mdp dans .env ou déchiffre la clé :');
      console.error('   → openssl rsa -in signerKey.pem -out signerKey_nopass.pem');
    }
    if (err.message.includes('certificate')) {
      console.error('   → Vérifie que signerCert.pem est bien le certificat Pass Type (pas un autre).');
    }
    process.exit(1);
  }

  fs.writeFileSync(outFile, buffer);

  const sizeKb = (buffer.length / 1024).toFixed(1);
  console.log(`\n✅ Pass généré avec succès ! (${sizeKb} KB)`);
  console.log(`   Fichier : ${outFile}`);
  console.log('\n📱 Pour tester sur iPhone :');
  console.log('   1. AirDrop le fichier vers ton iPhone');
  console.log('   2. Ouvre-le → "Ajouter" dans Wallet');
  console.log('   3. Vérifie que le nom du marchand et les points s\'affichent correctement');
  console.log('\n⚠️  Note : le QR code est valide mais le webservice (APNs) n\'est pas encore actif.\n');
}

main().catch(err => {
  console.error('Erreur inattendue :', err);
  process.exit(1);
});
