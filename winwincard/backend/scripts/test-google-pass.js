#!/usr/bin/env node
// ============================================================
// WinWin Card — Test génération Google Wallet
//
// Usage :
//   GOOGLE_SERVICE_ACCOUNT_JSON=$(cat ~/Desktop/service-account.json) \
//   GOOGLE_WALLET_ISSUER_ID=3388000000022XXXXXX \
//   node scripts/test-google-pass.js
//
// Prérequis :
//   - Projet Google Cloud avec l'API "Google Wallet" activée
//   - Service account avec le rôle "Wallet Object Issuer"
//   - GOOGLE_SERVICE_ACCOUNT_JSON et GOOGLE_WALLET_ISSUER_ID définis
// ============================================================

process.env.JWT_SECRET = 'test-secret-32-chars-minimum-ok';

const { createOrUpdateLoyaltyClass, generateGoogleWalletUrl, isConfigured } = require('../src/services/google-pass');

if (!isConfigured()) {
  console.error('\n❌ Google Wallet non configuré.');
  console.error('   Lance le script avec :');
  console.error('   GOOGLE_SERVICE_ACCOUNT_JSON=$(cat service-account.json) \\');
  console.error('   GOOGLE_WALLET_ISSUER_ID=3388000000022XXXXXX \\');
  console.error('   node scripts/test-google-pass.js\n');
  process.exit(1);
}

const testMarchand = {
  id:             'aaaaaaaa-0000-0000-0000-000000000001',
  nom:            'Café Le Central',
  couleur_fond:   '#1a1a2e',
  couleur_texte:  '#ffffff',
  couleur_label:  '#a0a0b0',
  logo_url:       null,
  image_strip_url: null,
  images_tiers:   null,
  max_value:      10,
};

const testClient = {
  prenom:        'Marie',
  stored_value:  7,
};

const testSerial = `test-serial-${Date.now()}`;

async function main() {
  console.log('\n📋 Configuration détectée :');
  console.log(`   Issuer ID : ${process.env.GOOGLE_WALLET_ISSUER_ID}`);

  console.log('\n1️⃣  Création/mise à jour de la LoyaltyClass...');
  try {
    await createOrUpdateLoyaltyClass(testMarchand);
    console.log('   ✅ LoyaltyClass OK');
  } catch (err) {
    console.error('   ❌ Erreur LoyaltyClass :', err.message);
    process.exit(1);
  }

  console.log('\n2️⃣  Génération du lien "Add to Google Wallet"...');
  try {
    const url = await generateGoogleWalletUrl({
      client:       testClient,
      marchand:     testMarchand,
      serialNumber: testSerial,
    });
    console.log('   ✅ URL générée !\n');
    console.log('   ' + url);
    console.log('\n📱 Ouvre cette URL sur un téléphone Android (ou Chrome sur iOS)');
    console.log('   → Tu dois voir le bouton "Ajouter à Google Wallet"\n');
  } catch (err) {
    console.error('   ❌ Erreur génération URL :', err.message);
    if (err.message.includes('PERMISSION_DENIED')) {
      console.error('   → Le service account n\'a pas le rôle "Wallet Object Issuer"');
      console.error('   → Va dans Google Cloud Console → IAM → ajoute le rôle au service account');
    }
    if (err.message.includes('INVALID_ARGUMENT')) {
      console.error('   → L\'Issuer ID est peut-être incorrect');
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Erreur inattendue :', err);
  process.exit(1);
});
