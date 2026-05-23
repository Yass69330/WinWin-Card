const { PKPass } = require('passkit-generator');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');

// ── Auth token ───────────────────────────────────────────────
// Calculé à la volée — jamais stocké.
// Apple l'envoie en Authorization: ApplePass <token> sur le webservice.
function computeAuthToken(serialNumber) {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'dev-secret')
    .update(serialNumber)
    .digest('hex')
    .slice(0, 32);
}

// ── Chargement certificats ───────────────────────────────────
// Priorité : variable env base64 (Railway prod) > chemin fichier (dev)
function loadCert(b64EnvKey, filePathEnvKey, defaultPath) {
  if (process.env[b64EnvKey]) {
    return Buffer.from(process.env[b64EnvKey], 'base64');
  }
  const filePath = process.env[filePathEnvKey] || defaultPath;
  return fs.readFileSync(path.resolve(filePath));
}

function loadCerts() {
  return {
    wwdr:       loadCert('APPLE_WWDR_CERT_B64',    'APPLE_WWDR_CERT',    './certs/wwdr.pem'),
    signerCert: loadCert('APPLE_SIGNER_CERT_B64',  'APPLE_SIGNER_CERT',  './certs/signerCert.pem'),
    signerKey:  loadCert('APPLE_SIGNER_KEY_B64',   'APPLE_SIGNER_KEY',   './certs/signerKey.pem'),
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

// ── Générateur PNG minimal (pure Node.js, aucune dépendance) ─
// Utilisé pour les images placeholder quand le marchand n'a pas encore uploadé ses assets.
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

// ── Conversion hex → rgb() ───────────────────────────────────
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

// ── Sélection image strip selon tier ────────────────────────
function selectStripImageUrl(marchand, storedValue) {
  if (marchand.images_tiers && Array.isArray(marchand.images_tiers)) {
    const tier = marchand.images_tiers.find(
      t => storedValue >= t.min && storedValue <= t.max
    );
    if (tier?.url) return tier.url;
  }
  return marchand.image_strip_url || null;
}

// ── Génération pass.json ─────────────────────────────────────
function buildPassJson({ client, marchand, serialNumber }) {
  const progression = `${client.stored_value} / ${marchand.max_value}`;
  const isRecompense = client.stored_value >= marchand.max_value;

  return {
    formatVersion: 1,
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_IDENTIFIER || 'pass.com.winwincard.loyalty',
    serialNumber,
    teamIdentifier: process.env.APPLE_TEAM_ID || 'LTW34ARCX2',
    webServiceURL: (process.env.API_BASE_URL || 'https://api.winwincard.fr') + '/',
    authenticationToken: computeAuthToken(serialNumber),
    organizationName: 'WinWin Card',
    description: `Carte de fidélité ${marchand.nom}`,
    backgroundColor: hexToRgb(marchand.couleur_fond  || '#1a1a2e'),
    foregroundColor: hexToRgb(marchand.couleur_texte || '#ffffff'),
    labelColor:      hexToRgb(marchand.couleur_label || '#a0a0b0'),
    logoText: marchand.nom,
    storeCard: {
      headerFields: [],
      primaryFields: [
        {
          key: 'points',
          label: 'PROGRESSION',
          value: isRecompense ? '🎉 Récompense !' : progression,
        }
      ],
      secondaryFields: [
        {
          key: 'prenom',
          label: 'CLIENT',
          value: client.prenom
        }
      ],
      auxiliaryFields: [],
      backFields: [
        {
          key: 'programme',
          label: 'Comment ça marche ?',
          value: `Présentez votre pass à chaque visite pour gagner des points.\nAprès ${marchand.max_value} passages, votre récompense est automatiquement débloquée.`
        },
        {
          key: 'rgpd',
          label: 'Vos données',
          value: 'Conformément au RGPD, vous pouvez demander la suppression de vos données directement en magasin.'
        }
      ]
    },
    barcodes: [
      {
        message: serialNumber,
        format: 'PKBarcodeFormatQR',
        messageEncoding: 'iso-8859-1'
      }
    ]
  };
}

// ── Point d'entrée principal ─────────────────────────────────
async function generateApplePass({ client, marchand, serialNumber }) {
  const certs = loadCerts();

  const passJson = buildPassJson({ client, marchand, serialNumber });

  // Prépare les images
  const iconPlaceholder  = createSolidPng(29,  29,  26, 26, 46);
  const icon2xPlaceholder = createSolidPng(58,  58,  26, 26, 46);
  const stripPlaceholder = createSolidPng(375, 123, 26, 26, 46);

  const [iconBuf, icon2xBuf, logoBuf, logo2xBuf, stripBuf, strip2xBuf] = await Promise.all([
    marchand.icon_url    ? fetchImage(marchand.icon_url).catch(() => iconPlaceholder)   : iconPlaceholder,
    marchand.icon_url    ? fetchImage(marchand.icon_url).catch(() => icon2xPlaceholder) : icon2xPlaceholder,
    marchand.logo_url    ? fetchImage(marchand.logo_url).catch(() => iconPlaceholder)   : iconPlaceholder,
    marchand.logo_url    ? fetchImage(marchand.logo_url).catch(() => icon2xPlaceholder) : icon2xPlaceholder,
    (() => {
      const url = selectStripImageUrl(marchand, client.stored_value);
      return url ? fetchImage(url).catch(() => stripPlaceholder) : stripPlaceholder;
    })(),
    (() => {
      const url = selectStripImageUrl(marchand, client.stored_value);
      return url ? fetchImage(url).catch(() => stripPlaceholder) : stripPlaceholder;
    })()
  ]);

  const pass = await PKPass.from({
    model: {
      'pass.json':    Buffer.from(JSON.stringify(passJson)),
      'icon.png':     iconBuf,
      'icon@2x.png':  icon2xBuf,
      'logo.png':     logoBuf,
      'logo@2x.png':  logo2xBuf,
      'strip.png':    stripBuf,
      'strip@2x.png': strip2xBuf,
    },
    certificates: certs,
  });

  return pass.getAsBuffer();
}

module.exports = { generateApplePass, computeAuthToken };
