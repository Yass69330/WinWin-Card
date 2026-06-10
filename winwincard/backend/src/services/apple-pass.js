const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const dns = require('dns').promises;
const net = require('net');
const zlib = require('zlib');
const crypto = require('crypto');

// ── Auth token ───────────────────────────────────────────────
function computeAuthToken(serialNumber) {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update(serialNumber)
    .digest('hex')
    .slice(0, 32);
}

// ── Nettoyage PEM ────────────────────────────────────────────
function cleanPem(buf) {
  const str = buf.toString('utf8');
  const matches = [...str.matchAll(/(-----BEGIN [\w ]+-----[\s\S]+?-----END [\w ]+-----)/g)];
  if (!matches.length) throw new Error('Fichier PEM invalide — bloc BEGIN/END introuvable');
  const block = matches[0][1];
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

// ── Fetch image distante → Buffer (sécurisé) ─────────────────
// Protections : timeout 5s, taille max 5 MB, anti-SSRF (refus des hôtes locaux
// et des IP privées/internes — y compris l'endpoint metadata 169.254.169.254).
const FETCH_TIMEOUT_MS = 5000;
const MAX_IMAGE_BYTES  = 5 * 1024 * 1024;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 127) return true;                 // "this host" / loopback
    if (a === 10) return true;                             // privé
    if (a === 172 && b >= 16 && b <= 31) return true;      // privé
    if (a === 192 && b === 168) return true;               // privé
    if (a === 169 && b === 254) return true;               // link-local + metadata cloud
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;     // loopback / unspecified
    if (lower.startsWith('fe80')) return true;             // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
    if (lower.startsWith('::ffff:')) return isPrivateIp(lower.replace('::ffff:', '')); // IPv4-mapped
    return false;
  }
  return false;
}

async function fetchImage(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`URL invalide: ${url}`); }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Protocole non autorisé: ${parsed.protocol}`);
  }

  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0') {
    throw new Error(`Hôte non autorisé: ${host}`);
  }

  // Anti-SSRF : résoudre le DNS et refuser toute IP interne
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`Résolution DNS échouée: ${host}`);
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) throw new Error(`IP interne bloquée (${address}) pour ${host}`);
  }

  return new Promise((resolve, reject) => {
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.get(url, { timeout: FETCH_TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        res.resume(); // vider le flux pour libérer le socket
        return reject(new Error(`HTTP ${res.statusCode} pour ${url}`));
      }
      const chunks = [];
      let total = 0;
      res.on('data', c => {
        total += c.length;
        if (total > MAX_IMAGE_BYTES) {
          request.destroy();
          reject(new Error(`Image trop volumineuse (> ${MAX_IMAGE_BYTES} octets): ${url}`));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error(`Timeout ${FETCH_TIMEOUT_MS}ms pour ${url}`)));
    request.on('error', reject);
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

// ── ZIP STORE builder (pure Node.js) ────────────────────────
// Apple Wallet requires STORE (no compression) for all files.
function createZip(files) {
  // files: Array<{ name: string, data: Buffer }>
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

  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const size = data.length;

    // Local file header
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);  // signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(0, 8);            // compression: STORE
    local.writeUInt16LE(0, 10);           // mod time
    local.writeUInt16LE(0, 12);           // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);        // compressed size
    local.writeUInt32LE(size, 22);        // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);           // extra field length
    nameBytes.copy(local, 30);

    localHeaders.push(Buffer.concat([local, data]));

    // Central directory header
    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0); // signature
    central.writeUInt16LE(20, 4);          // version made by
    central.writeUInt16LE(20, 6);          // version needed
    central.writeUInt16LE(0, 8);           // flags
    central.writeUInt16LE(0, 10);          // compression: STORE
    central.writeUInt16LE(0, 12);          // mod time
    central.writeUInt16LE(0, 14);          // mod date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);       // compressed size
    central.writeUInt32LE(size, 24);       // uncompressed size
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);          // extra field length
    central.writeUInt16LE(0, 32);          // file comment length
    central.writeUInt16LE(0, 34);          // disk number start
    central.writeUInt16LE(0, 36);          // internal attributes
    central.writeUInt32LE(0, 38);          // external attributes
    central.writeUInt32LE(offset, 42);     // relative offset of local header
    nameBytes.copy(central, 46);

    centralHeaders.push(central);
    offset += 30 + nameBytes.length + size;
  }

  const centralDir = Buffer.concat(centralHeaders);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);          // signature
  eocd.writeUInt16LE(0, 4);                    // disk number
  eocd.writeUInt16LE(0, 6);                    // disk with central dir
  eocd.writeUInt16LE(files.length, 8);         // entries on disk
  eocd.writeUInt16LE(files.length, 10);        // total entries
  eocd.writeUInt32LE(centralDir.length, 12);   // central dir size
  eocd.writeUInt32LE(offset, 16);              // central dir offset
  eocd.writeUInt16LE(0, 20);                   // comment length

  return Buffer.concat([...localHeaders, centralDir, eocd]);
}

// ── Signature PKCS#7 via OpenSSL natif ───────────────────────
async function signManifest(manifestBuf, certs, tempDir) {
  const signerCertPath = path.join(tempDir, 'signer.pem');
  const signerKeyPath  = path.join(tempDir, 'key.pem');
  const wwdrPath       = path.join(tempDir, 'wwdr.pem');
  const manifestPath   = path.join(tempDir, 'manifest.json');
  const signaturePath  = path.join(tempDir, 'signature');

  fs.writeFileSync(signerCertPath, certs.signerCert);
  fs.writeFileSync(signerKeyPath,  certs.signerKey);
  fs.writeFileSync(wwdrPath,       certs.wwdr);
  fs.writeFileSync(manifestPath,   manifestBuf);

  // Apple Wallet exige une signature CMS détachée (sans -nodetach),
  // avec attributs signés standards (sans -noattr), et SHA256 depuis iOS 16+.
  const args = [
    'smime', '-sign',
    '-binary',
    '-signer', signerCertPath,
    '-inkey',  signerKeyPath,
    '-certfile', wwdrPath,
    '-md', 'sha256',
    '-in', manifestPath,
    '-out', signaturePath,
    '-outform', 'DER',
  ];

  if (process.env.APPLE_PASS_PHRASE) {
    args.push('-passin', `pass:${process.env.APPLE_PASS_PHRASE}`);
  }

  await execFileAsync('openssl', args);
  return fs.readFileSync(signaturePath);
}

// ── Helpers ──────────────────────────────────────────────────
function hexToRgb(hex) {
  const h = (hex || '#1a1a2e').replace('#', '');
  return `rgb(${parseInt(h.slice(0,2),16)}, ${parseInt(h.slice(2,4),16)}, ${parseInt(h.slice(4,6),16)})`;
}

function isPassDoré(client, marchand) {
  return client.stored_value > 0 && client.stored_value >= (marchand.max_value || 1);
}

function selectStripImageUrl(marchand, storedValue) {
  if (Array.isArray(marchand.images_tiers)) {
    const tier = marchand.images_tiers.find(t => storedValue >= t.min && storedValue <= t.max);
    if (tier?.url) return tier.url;
  }
  return marchand.image_strip_url || null;
}

// ── Génération pass.json ─────────────────────────────────────
function buildPassJson({ client, marchand, serialNumber, passNotification }) {
  const doré = isPassDoré(client, marchand);
  const displayMax = marchand.display_max_value || marchand.max_value;
  return {
    formatVersion: 1,
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_IDENTIFIER || 'pass.com.winwincard.loyalty',
    serialNumber,
    teamIdentifier: process.env.APPLE_TEAM_ID || 'LTW34ARCX2',
    webServiceURL: (process.env.API_BASE_URL || 'https://app.winwin-card.com') + '/',
    authenticationToken: computeAuthToken(serialNumber),
    organizationName: marchand.nom,
    description: `${marchand.nom} Loyalty Card`,
    backgroundColor: doré
      ? (marchand.couleur_fond_reward ? hexToRgb(marchand.couleur_fond_reward) : 'rgb(201, 168, 76)')
      : hexToRgb(marchand.couleur_fond),
    foregroundColor: doré && !marchand.couleur_fond_reward ? 'rgb(25, 15, 0)'  : hexToRgb(marchand.couleur_texte || '#ffffff'),
    labelColor:      doré && !marchand.couleur_fond_reward ? 'rgb(90, 65, 10)' : hexToRgb(marchand.couleur_label || '#a0a0b0'),
    storeCard: {
      headerFields: [
        {
          key:   'nom_marchand',
          label: '',
          value: marchand.pass_display_name || marchand.nom,
        },
      ],
      primaryFields: [],
      secondaryFields: [
        {
          key:   'prenom',
          label: 'CLIENT',
          value: client.prenom,
        },
        {
          key:           'points',
          label:         doré ? '🎉 REWARD' : 'PROGRESS',
          value:         `${client.stored_value} / ${displayMax}`,
          textAlignment: 'PKTextAlignmentRight',
        },
      ],
      auxiliaryFields: [],
      backFields: [
        {
          // Toujours présent même vide — iOS compare old/new value et déclenche
          // une notification visible grâce à changeMessage quand la valeur change.
          key:           'notification_txt',
          label:         marchand.notification_titre || '',
          value:         passNotification ?? marchand.notification_message ?? '',
          changeMessage: '%@',
        },
        {
          key: 'programme',
          label: 'How it works',
          value: marchand.how_it_works || `Show your pass at every visit.\nAfter ${displayMax} visits, your reward is automatically unlocked.`,
        },
        ...(marchand.referral_enabled ? [{
          key:   'referral',
          label: 'Refer a Friend',
          value: `Share this link and earn ${marchand.referral_bonus_points || 1} point(s) when your friends make their first visit.\n\n${process.env.API_BASE_URL || 'https://app.winwin-card.com'}/l/${marchand.slug}?ref=${serialNumber}`,
        }] : []),
        ...(marchand.telephone || marchand.adresse ? [{
          key:   'contact',
          label: 'Contact',
          value: [marchand.telephone, marchand.adresse].filter(Boolean).join('\n'),
        }] : []),
        {
          key: 'rgpd',
          label: 'Your data',
          value: 'You can request deletion of your personal data in-store at any time.',
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
async function generateApplePass({ client, marchand, serialNumber, passNotification = null }) {
  const certs = loadCerts();
  const passJson = buildPassJson({ client, marchand, serialNumber, passNotification });

  const doré = isPassDoré(client, marchand);
  const rewardHex = doré && marchand.couleur_fond_reward ? marchand.couleur_fond_reward : null;
  const [rf, gf, bf] = rewardHex
    ? hexToRgb(rewardHex).match(/\d+/g).map(Number)
    : doré
    ? [201, 168, 76]
    : hexToRgb(marchand.couleur_fond || '#1a1a2e').match(/\d+/g).map(Number);

  // L'icône (notification + Wallet) utilise toujours la couleur du marchand,
  // pas l'or du pass doré — garantit une couleur uniforme sur tous les appareils.
  const [ri, gi, bi] = hexToRgb(marchand.couleur_fond || '#1a1a2e').match(/\d+/g).map(Number);
  const iconPng  = createSolidPng(29,  29,  ri, gi, bi);
  const icon2Png = createSolidPng(58,  58,  ri, gi, bi);
  const icon3Png = createSolidPng(87,  87,  ri, gi, bi);
  const stripPng = createSolidPng(375, 123, rf, gf, bf);

  const stripUrl = selectStripImageUrl(marchand, client.stored_value);
  const iconUrl  = marchand.icon_url || marchand.logo_url || null;
  // icon@3x.png (87×87px) is what Apple uses on all modern iPhones (@3x screens).
  // icon.png / icon@2x.png keep their correct pixel sizes via solid-color fallbacks
  // so older devices render cleanly too. No image resizing library needed.
  const [icon3Buf, logoBuf, logo2Buf, stripBuf, strip2Buf] = await Promise.all([
    iconUrl           ? fetchImage(iconUrl).catch(() => icon3Png)            : icon3Png,
    marchand.logo_url ? fetchImage(marchand.logo_url).catch(() => iconPng)   : iconPng,
    marchand.logo_url ? fetchImage(marchand.logo_url).catch(() => icon2Png)  : icon2Png,
    stripUrl          ? fetchImage(stripUrl).catch(() => stripPng)           : stripPng,
    stripUrl          ? fetchImage(stripUrl).catch(() => stripPng)           : stripPng,
  ]);

  const passJsonBuf = Buffer.from(JSON.stringify(passJson));

  // Fichiers du pass (hors manifest et signature)
  // icon.png = icône notification iOS — utilise le logo marchand si disponible, sinon couleur unie
  const passFiles = [
    { name: 'pass.json',    data: passJsonBuf },
    { name: 'icon.png',     data: iconPng },    // 29×29 @1x — solid color, correct size
    { name: 'icon@2x.png',  data: icon2Png },   // 58×58 @2x — solid color, correct size
    { name: 'icon@3x.png',  data: icon3Buf },   // 87×87 @3x — icon_url image, used on all modern iPhones
    { name: 'logo.png',     data: logoBuf },
    { name: 'logo@2x.png',  data: logo2Buf },
    { name: 'strip.png',    data: stripBuf },
    { name: 'strip@2x.png', data: strip2Buf },
  ];

  // Manifest : SHA1 de chaque fichier
  const manifest = {};
  for (const { name, data } of passFiles) {
    manifest[name] = crypto.createHash('sha1').update(data).digest('hex');
  }
  const manifestBuf = Buffer.from(JSON.stringify(manifest));

  // Signature via OpenSSL
  const tempDir = path.join(os.tmpdir(), `winwincard-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tempDir, { recursive: true });
  let signatureBuf;
  try {
    signatureBuf = await signManifest(manifestBuf, certs, tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  // Assemblage ZIP final
  const allFiles = [
    ...passFiles,
    { name: 'manifest.json', data: manifestBuf },
    { name: 'signature',     data: signatureBuf },
  ];

  const buffer = createZip(allFiles);
  const magic = buffer.slice(0, 4).toString('hex');
  console.log('[apple-pass] Pass généré OK (OpenSSL)', { size: buffer.length, magic, files: allFiles.map(f => f.name) });
  return buffer;
}

module.exports = { generateApplePass, computeAuthToken, createSolidPng, loadCerts };
