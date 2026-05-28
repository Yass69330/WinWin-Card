const { PKPass } = require('passkit-generator');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');

// ── Auth token ───────────────────────────────────────────────
function computeAuthToken(serialNumber) {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'dev-secret')
    .update(serialNumber)
    .digest('hex')
    .slice(0, 32);
}

// ── Nettoyage PEM ────────────────────────────────────────────
// openssl pkcs12 ajoute des "Bag Attributes" avant le bloc PEM.
// passkit-generator ne les accepte pas — on extrait uniquement le bloc PEM.
// IMPORTANT : regex greedy sur le contenu interne pour gérer les blocs
// RSA multi-lignes sans risque de coupure prématurée.
function cleanPem(buf) {
  const str = buf.toString('utf8');
  // Greedy sur [\s\S]+ pour capturer tout le contenu jusqu'au DERNIER END possible.
  // On prend ensuite le premier match via le tableau de résultats globaux.
  const matches = [...str.matchAll(/(-----BEGIN [\w ]+-----[\s\S]+?-----END [\w ]+-----)/g)];
  if (!matches.length) throw new Error('Fichier PEM invalide — bloc BEGIN/END introuvable');
  // On prend le PREMIER bloc (le cert/key principal, pas les intermédiaires)
  const block = matches[0][1];
  // S'assurer que les sauts de ligne internes sont bien des \n (pas \r\n)
  return Buffer.from(block.replace(/\r\n/g, '\n').replace(/\r/g, '\n') + '\n');
}

// ── Chargement certificats ───────────────────────────────────
function loadCert(b64EnvKey, filePathEnvKey, defaultPath) {
  if (process.env[b64EnvKey]) {
    return Buffer.from(process.env[b64EnvKey], 'base64');
  }
  const filePath = process.env[filePathEnvKey] || defaultPath;
  return fs.readFileSync(path.resolve(filePath));
}

function loadCerts() {
  return {
    wwdr:       cleanPem(loadCert('APPLE_WWDR_CERT_B64',   'APPLE_WWDR_CERT',   './certs/wwdr.pem')),
    signerCert: cleanPem(loadCert('APPLE_SIGNER_CERT_B64', 'APPLE_SIGNER_CERT', './certs/signerCert.pem')),
    signerKey:  cleanPem(loadCert('APPLE_SIGNER_KEY_B64',  'APPLE_SIGNER_KEY',  './certs/signerKey.pem')),
  };
}

// ── Fetch image distante → Buffer ────────────────────────────
function fetchImage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} pour ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ── Générateur PNG minimal (pure Node.js, zéro dépendance) ──
function createSolidPng(width, height, r, g, b) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (const byte of buf) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const crcB = Buffer.alloc(4);
    crcB.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crcB]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // bit depth 8, RGB
  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(height * rowSize, 0);
  for (let y = 0; y < height; y++) {
    raw[y * rowSize] = 0;
    for (let x = 0; x < width; x++) {
      raw[y * rowSize + 1 + x * 3]     = r;
      raw[y * rowSize + 1 + x * 3 + 1] = g;
      raw[y * rowSize + 1 + x * 3 + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── Helpers ──────────────────────────────────────────────────
function hexToRgb(hex) {
  const h = (hex || '#1a1a2e').replace('#', '');
  return `rgb(${parseInt(h.slice(0,2),16)}, ${parseInt(h.slice(2,4),16)}, ${parseInt(h.slice(4,6),16)})`;
}

// Le pass devient doré à stored_value >= max_value - 1 :
// à max_value le reset se déclenche au prochain scan, donc le client
// ne verrait jamais l'état doré si on attendait max_value.
function isPassDoré(client, marchand) {
  const threshold = Math.max((marchand.max_value || 1) - 1, 1);
  return client.stored_value > 0 && client.stored_value >= threshold;
}

function selectStripImageUrl(marchand, storedValue) {
  if (Array.isArray(marchand.images_tiers)) {
    const tier = marchand.images_tiers.find(t => storedValue >= t.min && storedValue <= t.max);
    if (tier?.url) return tier.url;
  }
  return marchand.image_strip_url || null;
}

// ── Génération pass.json ─────────────────────────────────────
function buildPassJson({ client, marchand, serialNumber }) {
  const doré = isPassDoré(client, marchand);
  const displayMax = marchand.display_max_value || marchand.max_value;
  return {
    formatVersion: 1,
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_IDENTIFIER || 'pass.com.winwincard.loyalty',
    serialNumber,
    teamIdentifier: process.env.APPLE_TEAM_ID || 'LTW34ARCX2',
    webServiceURL: (process.env.API_BASE_URL || 'https://api.winwincard.fr') + '/',
    authenticationToken: computeAuthToken(serialNumber),
    organizationName: 'WinWin Card',
    description: `Carte de fidélité ${marchand.nom}`,
    backgroundColor: doré ? 'rgb(201, 168, 76)' : hexToRgb(marchand.couleur_fond),
    foregroundColor: doré ? 'rgb(25, 15, 0)'    : hexToRgb(marchand.couleur_texte || '#ffffff'),
    labelColor:      doré ? 'rgb(90, 65, 10)'   : hexToRgb(marchand.couleur_label || '#a0a0b0'),
    logoText: marchand.nom,
    storeCard: {
      headerFields: [],
      primaryFields: [{
        key: 'points',
        label: 'PROGRESSION',
        value: doré ? '🎉 Récompense !' : `${client.stored_value} / ${displayMax}`,
      }],
      secondaryFields: [{
        key: 'prenom',
        label: 'CLIENT',
        value: client.prenom,
      }],
      auxiliaryFields: [],
      backFields: [
        {
          key: 'programme',
          label: 'Comment ça marche ?',
          value: `Présentez votre pass à chaque visite.\nAprès ${displayMax} passages, votre récompense est automatiquement débloquée.`,
        },
        {
          key: 'rgpd',
          label: 'Vos données',
          value: 'Conformément au RGPD, vous pouvez demander la suppression de vos données directement en magasin.',
        },
      ],
    },
    barcodes: [{
      message: serialNumber,
      format: 'PKBarcodeFormatQR',
      messageEncoding: 'iso-8859-1',
    }],
  };
}

// ── Point d'entrée principal ─────────────────────────────────
// passkit-generator v3 exige un chemin de répertoire (string) pour model.
// On crée un répertoire temporaire, on y écrit les fichiers, puis on nettoie.
async function generateApplePass({ client, marchand, serialNumber }) {
  const certs = loadCerts();
  const passJson = buildPassJson({ client, marchand, serialNumber });

  const doré = isPassDoré(client, marchand);
  const [rf, gf, bf] = doré
    ? [201, 168, 76]
    : hexToRgb(marchand.couleur_fond || '#1a1a2e').match(/\d+/g).map(Number);

  const iconPng  = createSolidPng(29,  29,  rf, gf, bf);
  const icon2Png = createSolidPng(58,  58,  rf, gf, bf);
  const stripPng = createSolidPng(375, 123, rf, gf, bf);

  const stripUrl = selectStripImageUrl(marchand, client.stored_value);
  const [logoBuf, logo2Buf, stripBuf, strip2Buf] = await Promise.all([
    marchand.logo_url ? fetchImage(marchand.logo_url).catch(() => iconPng)  : iconPng,
    marchand.logo_url ? fetchImage(marchand.logo_url).catch(() => icon2Png) : icon2Png,
    stripUrl          ? fetchImage(stripUrl).catch(() => stripPng)           : stripPng,
    stripUrl          ? fetchImage(stripUrl).catch(() => stripPng)           : stripPng,
  ]);

  // passkit-generator v3 ajoute automatiquement ".pass" au chemin fourni.
  // On crée donc le répertoire AVEC l'extension .pass et on passe le chemin SANS.
  const tempBase = path.join(os.tmpdir(), `winwincard-${Date.now()}`);
  const modelDir = tempBase + '.pass';
  fs.mkdirSync(modelDir, { recursive: true });
  try {
    fs.writeFileSync(path.join(modelDir, 'pass.json'),    JSON.stringify(passJson));
    fs.writeFileSync(path.join(modelDir, 'icon.png'),     iconPng);
    fs.writeFileSync(path.join(modelDir, 'icon@2x.png'),  icon2Png);
    fs.writeFileSync(path.join(modelDir, 'logo.png'),     logoBuf);
    fs.writeFileSync(path.join(modelDir, 'logo@2x.png'),  logo2Buf);
    fs.writeFileSync(path.join(modelDir, 'strip.png'),    stripBuf);
    fs.writeFileSync(path.join(modelDir, 'strip@2x.png'), strip2Buf);

    // On passe tempBase (sans .pass) — passkit-generator cherche tempBase + '.pass'
    // Les certs sont passés en STRING (pas Buffer) : certaines versions de passkit-generator
    // v3 ne gèrent pas correctement les Buffer pour les champs PEM et signent silencieusement
    // avec un résultat invalide.
    const pass = await PKPass.from({
      model: tempBase,
      certificates: {
        wwdr:       certs.wwdr.toString('utf8'),
        signerCert: certs.signerCert.toString('utf8'),
        signerKey:  certs.signerKey.toString('utf8'),
        ...(process.env.APPLE_PASS_PHRASE ? { signerKeyPassphrase: process.env.APPLE_PASS_PHRASE } : {}),
      },
    });
    return pass.getAsBuffer();
  } finally {
    fs.rmSync(modelDir, { recursive: true, force: true });
  }
}

module.exports = { generateApplePass, computeAuthToken, createSolidPng, loadCerts };
