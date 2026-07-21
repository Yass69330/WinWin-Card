// Strip & hero image generator — SVG templates + resvg rasterisation.
// Polices : DM Sans (labels, compteur) + Syne (nom marchand), OFL, WOFF via @fontsource.
// Rendu : @resvg/resvg-js (Rust/fontdb) — indépendant des polices système.
// Sorties : strip@2x 750×246, strip@3x 1125×369, hero Google 1032×336.
'use strict';

const fs    = require('fs');
const os    = require('os');
const path  = require('path');
const zlib  = require('zlib');
const sharp = require('sharp');
const { Resvg } = require('@resvg/resvg-js');

// ── WOFF → TTF (in-memory) ────────────────────────────────────────────────
// fontdb/ttf-parser ne lit pas les WOFF nativement. On décompresse les tables
// zlib et on reconstruit un TTF standard, écrit dans /tmp au démarrage.
// Sans cette conversion, le texte ne s'affiche pas sur Railway (pas de polices système).
function woffToTtf(woffBuf) {
  const numTables = woffBuf.readUInt16BE(12);
  const flavor    = woffBuf.readUInt32BE(4);
  const tables    = [];
  for (let i = 0; i < numTables; i++) {
    const base     = 44 + i * 20;
    const tag      = woffBuf.slice(base, base + 4).toString('latin1');
    const offset   = woffBuf.readUInt32BE(base + 4);
    const compLen  = woffBuf.readUInt32BE(base + 8);
    const origLen  = woffBuf.readUInt32BE(base + 12);
    const checksum = woffBuf.readUInt32BE(base + 16);
    const raw      = woffBuf.slice(offset, offset + compLen);
    const data     = Buffer.from(compLen < origLen ? zlib.inflateSync(raw) : raw);
    tables.push({ tag, data, checksum });
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const log2n = Math.floor(Math.log2(numTables));
  let pos = 12 + numTables * 16;
  for (const t of tables) {
    if (pos % 4) pos += 4 - pos % 4;
    t.off = pos;
    pos += t.data.length;
  }
  if (pos % 4) pos += 4 - pos % 4;

  const out = Buffer.alloc(pos);
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(numTables, 4);
  out.writeUInt16BE((1 << log2n) * 16, 6);
  out.writeUInt16BE(log2n, 8);
  out.writeUInt16BE(numTables * 16 - (1 << log2n) * 16, 10);

  let dirPos = 12;
  for (const t of tables) {
    out.write(t.tag, dirPos, 4, 'latin1');
    out.writeUInt32BE(t.checksum, dirPos + 4);
    out.writeUInt32BE(t.off, dirPos + 8);
    out.writeUInt32BE(t.data.length, dirPos + 12);
    dirPos += 16;
    t.data.copy(out, t.off);
  }
  return out;
}

// ── Polices : WOFF → TTF une fois au démarrage, écrits dans /tmp ─────────
const FONT_PATHS = (() => {
  const tmpDir = path.join(os.tmpdir(), 'winwincard-fonts');
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}
  const paths = [];
  const fonts = [
    ['dm-sans', 'dm-sans-latin-400-normal.woff', 'dm-sans-400.ttf'],
    ['dm-sans', 'dm-sans-latin-700-normal.woff', 'dm-sans-700.ttf'],
    ['syne',    'syne-latin-700-normal.woff',    'syne-700.ttf'],
  ];
  for (const [pkg, woff, out] of fonts) {
    try {
      const woffPath = require.resolve(`@fontsource/${pkg}/files/${woff}`);
      const ttfPath  = path.join(tmpDir, out);
      if (!fs.existsSync(ttfPath)) {
        fs.writeFileSync(ttfPath, woffToTtf(fs.readFileSync(woffPath)));
      }
      paths.push(ttfPath);
    } catch (e) {
      console.warn(`[strip-generator] Font setup failed (${woff}):`, e.message);
    }
  }
  if (paths.length === 0) console.warn('[strip-generator] No fonts — text uses system fallback');
  return paths;
})();

// ── Icônes Phosphor Regular (viewBox 0 0 256 256, MIT) ────────────────────
// Paths extraits de @phosphor-icons/core/assets/regular/.
// Transform dans stampSvg : translate(cx,cy) scale(r*0.68/128) translate(-128,-128)
// → icône ≈ 68% du rayon du tampon, centrée sur (cx,cy).
const ICONS = {
  'coffee':       `<path d="M80,56V24a8,8,0,0,1,16,0V56a8,8,0,0,1-16,0Zm40,8a8,8,0,0,0,8-8V24a8,8,0,0,0-16,0V56A8,8,0,0,0,120,64Zm32,0a8,8,0,0,0,8-8V24a8,8,0,0,0-16,0V56A8,8,0,0,0,152,64Zm96,56v8a40,40,0,0,1-37.51,39.91,96.59,96.59,0,0,1-27,40.09H208a8,8,0,0,1,0,16H32a8,8,0,0,1,0-16H56.54A96.3,96.3,0,0,1,24,136V88a8,8,0,0,1,8-8H208A40,40,0,0,1,248,120ZM200,96H40v40a80.27,80.27,0,0,0,45.12,72h69.76A80.27,80.27,0,0,0,200,136Zm32,24a24,24,0,0,0-16-22.62V136a95.78,95.78,0,0,1-1.2,15A24,24,0,0,0,232,128Z"/>`,
  'scissors':     `<path d="M157.73,113.13A8,8,0,0,1,159.82,102L227.48,55.7a8,8,0,0,1,9,13.21l-67.67,46.3a7.92,7.92,0,0,1-4.51,1.4A8,8,0,0,1,157.73,113.13Zm80.87,85.09a8,8,0,0,1-11.12,2.08L136,137.7,93.49,166.78a36,36,0,1,1-9-13.19L121.83,128,84.44,102.41a35.86,35.86,0,1,1,9-13.19l143,97.87A8,8,0,0,1,238.6,198.22ZM80,180a20,20,0,1,0-5.86,14.14A19.85,19.85,0,0,0,80,180ZM74.14,90.13a20,20,0,1,0-28.28,0A19.85,19.85,0,0,0,74.14,90.13Z"/>`,
  'hamburger':    `<path d="M48.07,104H207.93a16,16,0,0,0,15.72-19.38C216.22,49.5,176,24,128,24S39.78,49.5,32.35,84.62A16,16,0,0,0,48.07,104ZM128,40c39.82,0,74.21,20.61,79.93,48H48.07L48,87.93C53.79,60.61,88.18,40,128,40ZM229.26,152.48l-41.13,15L151,152.57a8,8,0,0,0-5.94,0l-37,14.81L71,152.57a8,8,0,0,0-5.7-.09l-44,16a8,8,0,0,0,5.47,15L40,178.69V184a40,40,0,0,0,40,40h96a40,40,0,0,0,40-40v-9.67l18.73-6.81a8,8,0,1,0-5.47-15ZM200,184a24,24,0,0,1-24,24H80a24,24,0,0,1-24-24V172.88l11.87-4.32L105,183.43a8,8,0,0,0,5.94,0l37-14.81,37,14.81a8,8,0,0,0,5.7.09l9.27-3.37ZM16,128a8,8,0,0,1,8-8H232a8,8,0,0,1,0,16H24A8,8,0,0,1,16,128Z"/>`,
  'shopping-bag': `<path d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,160H40V56H216V200ZM176,88a48,48,0,0,1-96,0,8,8,0,0,1,16,0,32,32,0,0,0,64,0,8,8,0,0,1,16,0Z"/>`,
  'heart':        `<path d="M178,40c-20.65,0-38.73,8.88-50,23.89C116.73,48.88,98.65,40,78,40a62.07,62.07,0,0,0-62,62c0,70,103.79,126.66,108.21,129a8,8,0,0,0,7.58,0C136.21,228.66,240,172,240,102A62.07,62.07,0,0,0,178,40ZM128,214.8C109.74,204.16,32,155.69,32,102A46.06,46.06,0,0,1,78,56c19.45,0,35.78,10.36,42.6,27a8,8,0,0,0,14.8,0c6.82-16.67,23.15-27,42.6-27a46.06,46.06,0,0,1,46,46C224,155.61,146.24,204.15,128,214.8Z"/>`,
  'star':         `<path d="M239.18,97.26A16.38,16.38,0,0,0,224.92,86l-59-4.76L143.14,26.15a16.36,16.36,0,0,0-30.27,0L90.11,81.23,31.08,86a16.46,16.46,0,0,0-9.37,28.86l45,38.83L53,211.75a16.38,16.38,0,0,0,24.5,17.82L128,198.49l50.53,31.08A16.4,16.4,0,0,0,203,211.75l-13.76-58.07,45-38.83A16.43,16.43,0,0,0,239.18,97.26Zm-15.34,5.47-48.7,42a8,8,0,0,0-2.56,7.91l14.88,62.8a.37.37,0,0,1-.17.48c-.18.14-.23.11-.38,0l-54.72-33.65a8,8,0,0,0-8.38,0L69.09,215.94c-.15.09-.19.12-.38,0a.37.37,0,0,1-.17-.48l14.88-62.8a8,8,0,0,0-2.56-7.91l-48.7-42c-.12-.1-.23-.19-.13-.5s.18-.27.33-.29l63.92-5.16A8,8,0,0,0,103,91.86l24.62-59.61c.08-.17.11-.25.35-.25s.27.08.35.25L153,91.86a8,8,0,0,0,6.75,4.92l63.92,5.16c.15,0,.24,0,.33.29S224,102.63,223.84,102.73Z"/>`,
  'gift':         `<path d="M216,72H180.92c.39-.33.79-.65,1.17-1A29.53,29.53,0,0,0,192,49.57,32.62,32.62,0,0,0,158.44,16,29.53,29.53,0,0,0,137,25.91a54.94,54.94,0,0,0-9,14.48,54.94,54.94,0,0,0-9-14.48A29.53,29.53,0,0,0,97.56,16,32.62,32.62,0,0,0,64,49.57,29.53,29.53,0,0,0,73.91,71c.38.33.78.65,1.17,1H40A16,16,0,0,0,24,88v32a16,16,0,0,0,16,16v64a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V136a16,16,0,0,0,16-16V88A16,16,0,0,0,216,72ZM149,36.51a13.69,13.69,0,0,1,10-4.5h.49A16.62,16.62,0,0,1,176,49.08a13.69,13.69,0,0,1-4.5,10c-9.49,8.4-25.24,11.36-35,12.4C137.7,60.89,141,45.5,149,36.51Zm-64.09.36A16.63,16.63,0,0,1,96.59,32h.49a13.69,13.69,0,0,1,10,4.5c8.39,9.48,11.35,25.2,12.39,34.92-9.72-1-25.44-4-34.92-12.39a13.69,13.69,0,0,1-4.5-10A16.6,16.6,0,0,1,84.87,36.87ZM40,88h80v32H40Zm16,48h64v64H56Zm144,64H136V136h64Zm16-80H136V88h80v32Z"/>`,
  'hair-dryer':   `<path d="M200,88a32,32,0,1,0-32,32A32,32,0,0,0,200,88Zm-32,16a16,16,0,1,1,16-16A16,16,0,0,1,168,104Zm9.42,102.62L209,137.07A64,64,0,0,0,168,24a8.4,8.4,0,0,0-1.32.11L29.37,47A16,16,0,0,0,16,62.78v50.44A16,16,0,0,0,29.37,129L128,145.44V200a16,16,0,0,0,16,16,40,40,0,0,0,40,40h16a8,8,0,0,0,0-16H184a24,24,0,0,1-24-24h2.85A16,16,0,0,0,177.42,206.62ZM32,62.78,168.64,40a48,48,0,0,1,0,96L32,113.23Zm134.68,89.11A8.4,8.4,0,0,0,168,152a63.9,63.9,0,0,0,17.82-2.54l-23,50.54H144V148.11Z"/>`,
  'barbell':      `<path d="M248,120h-8V88a16,16,0,0,0-16-16H208V64a16,16,0,0,0-16-16H168a16,16,0,0,0-16,16v56H104V64A16,16,0,0,0,88,48H64A16,16,0,0,0,48,64v8H32A16,16,0,0,0,16,88v32H8a8,8,0,0,0,0,16h8v32a16,16,0,0,0,16,16H48v8a16,16,0,0,0,16,16H88a16,16,0,0,0,16-16V136h48v56a16,16,0,0,0,16,16h24a16,16,0,0,0,16-16v-8h16a16,16,0,0,0,16-16V136h8a8,8,0,0,0,0-16ZM32,168V88H48v80Zm56,24H64V64H88V192Zm104,0H168V64h24V175.82c0,.06,0,.12,0,.18s0,.12,0,.18V192Zm32-24H208V88h16Z"/>`,
  'fork-knife':   `<path d="M72,88V40a8,8,0,0,1,16,0V88a8,8,0,0,1-16,0ZM216,40V224a8,8,0,0,1-16,0V176H152a8,8,0,0,1-8-8,268.75,268.75,0,0,1,7.22-56.88c9.78-40.49,28.32-67.63,53.63-78.47A8,8,0,0,1,216,40ZM200,53.9c-32.17,24.57-38.47,84.42-39.7,106.1H200ZM119.89,38.69a8,8,0,1,0-15.78,2.63L112,88.63a32,32,0,0,1-64,0l7.88-47.31a8,8,0,1,0-15.78-2.63l-8,48A8.17,8.17,0,0,0,32,88a48.07,48.07,0,0,0,40,47.32V224a8,8,0,0,0,16,0V135.32A48.07,48.07,0,0,0,128,88a8.17,8.17,0,0,0-.11-1.31Z"/>`,
  'flower':       `<path d="M210.35,129.36c-.81-.47-1.7-.92-2.62-1.36.92-.44,1.81-.89,2.62-1.36a40,40,0,1,0-40-69.28c-.81.47-1.65,1-2.48,1.59.08-1,.13-2,.13-3a40,40,0,0,0-80,0c0,.94,0,1.94.13,3-.83-.57-1.67-1.12-2.48-1.59a40,40,0,1,0-40,69.28c.81.47,1.7.92,2.62,1.36-.92.44-1.81.89-2.62,1.36a40,40,0,1,0,40,69.28c.81-.47,1.65-1,2.48-1.59-.08,1-.13,2-.13,2.95a40,40,0,0,0,80,0c0-.94-.05-1.94-.13-2.95.83.57,1.67,1.12,2.48,1.59A39.79,39.79,0,0,0,190.29,204a40.43,40.43,0,0,0,10.42-1.38,40,40,0,0,0,9.64-73.28ZM104,128a24,24,0,1,1,24,24A24,24,0,0,1,104,128Zm74.35-56.79a24,24,0,1,1,24,41.57c-6.27,3.63-18.61,6.13-35.16,7.19A40,40,0,0,0,154.53,98.1C163.73,84.28,172.08,74.84,178.35,71.21ZM128,32a24,24,0,0,1,24,24c0,7.24-4,19.19-11.36,34.06a39.81,39.81,0,0,0-25.28,0C108,75.19,104,63.24,104,56A24,24,0,0,1,128,32ZM44.86,80a24,24,0,0,1,32.79-8.79c6.27,3.63,14.62,13.07,23.82,26.89A40,40,0,0,0,88.81,120c-16.55-1.06-28.89-3.56-35.16-7.18A24,24,0,0,1,44.86,80ZM77.65,184.79a24,24,0,1,1-24-41.57c6.27-3.63,18.61-6.13,35.16-7.19a40,40,0,0,0,12.66,21.87C92.27,171.72,83.92,181.16,77.65,184.79ZM128,224a24,24,0,0,1-24-24c0-7.24,4-19.19,11.36-34.06a39.81,39.81,0,0,0,25.28,0C148,180.81,152,192.76,152,200A24,24,0,0,1,128,224Zm83.14-48a24,24,0,0,1-32.79,8.79c-6.27-3.63-14.62-13.07-23.82-26.89A40,40,0,0,0,167.19,136c16.55,1.06,28.89,3.56,35.16,7.18A24,24,0,0,1,211.14,176Z"/>`,
  'check':        `<path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/>`,
  'flower-tulip':    `<path d="M208,48a87.48,87.48,0,0,0-35.36,7.43c-15.1-25.37-39.92-38-41.06-38.59a8,8,0,0,0-7.16,0c-1.14.58-26,13.22-41.06,38.59A87.48,87.48,0,0,0,48,48a8,8,0,0,0-8,8V96a88.11,88.11,0,0,0,80,87.63v35.43L83.58,200.84a8,8,0,1,0-7.16,14.32l48,24a8,8,0,0,0,7.16,0l48-24a8,8,0,0,0-7.16-14.32L136,219.06V183.63A88.11,88.11,0,0,0,216,96V56A8,8,0,0,0,208,48ZM120,167.56A72.1,72.1,0,0,1,56,96V64.44A72.1,72.1,0,0,1,120,136Zm8-68.2A88.4,88.4,0,0,0,97.36,63.19c9.57-15.79,24-25.9,30.64-30,6.65,4.08,21.08,14.19,30.64,30A88.46,88.46,0,0,0,128,99.36ZM200,96a72.1,72.1,0,0,1-64,71.56V136a72.1,72.1,0,0,1,64-71.56Z"/>`,
  'game-controller': `<path d="M176,112H152a8,8,0,0,1,0-16h24a8,8,0,0,1,0,16ZM104,96H96V88a8,8,0,0,0-16,0v8H72a8,8,0,0,0,0,16h8v8a8,8,0,0,0,16,0v-8h8a8,8,0,0,0,0-16ZM241.48,200.65a36,36,0,0,1-54.94,4.81c-.12-.12-.24-.24-.35-.37L146.48,160h-37L69.81,205.09l-.35.37A36.08,36.08,0,0,1,44,216,36,36,0,0,1,8.56,173.75a.68.68,0,0,1,0-.14L24.93,89.52A59.88,59.88,0,0,1,83.89,40H172a60.08,60.08,0,0,1,59,49.25c0,.06,0,.12,0,.18l16.37,84.17a.68.68,0,0,1,0,.14A35.74,35.74,0,0,1,241.48,200.65ZM172,144a44,44,0,0,0,0-88H83.89A43.9,43.9,0,0,0,40.68,92.37l0,.13L24.3,176.59A20,20,0,0,0,58,194.3l41.92-47.59a8,8,0,0,1,6-2.71Zm59.7,32.59-8.74-45A60,60,0,0,1,172,160h-4.2L198,194.31a20.09,20.09,0,0,0,17.46,5.39,20,20,0,0,0,16.23-23.11Z"/>`,
  'sneaker':      `<path d="M228.65,129.11l-60.73-20.24a24,24,0,0,1-14.32-13L130.39,41.6s0-.07,0-.1A16,16,0,0,0,110.25,33L34.53,60.49A16.05,16.05,0,0,0,24,75.53V192a16,16,0,0,0,16,16H240a16,16,0,0,0,16-16V167.06A40,40,0,0,0,228.65,129.11ZM115.72,48l7.11,16.63-21.56,7.85A8,8,0,0,0,104,88a7.91,7.91,0,0,0,2.73-.49l22.4-8.14,4.74,11.07-16.6,6A8,8,0,0,0,120,112a7.91,7.91,0,0,0,2.73-.49l17.6-6.4a40.24,40.24,0,0,0,7.68,10l-14.74,5.36A8,8,0,0,0,136,136a8.14,8.14,0,0,0,2.73-.48l28-10.18,56.87,18.95A24,24,0,0,1,238.93,160H40V75.53ZM40,192h0V176H240v16Z"/>`,
};

// ── Dimensions des variantes ───────────────────────────────────────────────
const VARIANTS = {
  strip2x: { w: 750,  h: 246 },
  strip3x: { w: 1125, h: 369 },
  hero:    { w: 1032, h: 336 },
};

// ── Layout des tampons ─────────────────────────────────────────────────────
// Retourne un tableau de { x, y, r } (coordonnées dans l'espace 750×246).
// Zone sûre Apple Wallet : seuls les 630px centraux du strip sont garantis
// affichés → marge horizontale de 60px. Le décor de fond, lui, couvre les 750px.
function computeLayout(n, { showLabel = true } = {}) {
  const marginX = 60, availW = 750 - marginX * 2;
  const stampAreaBot = 226;

  // Rangée unique : centrage vertical ajusté pour laisser la place au label
  if (n <= 8) {
    const stampAreaTop = showLabel ? 82 : 20;
    const spacing = availW / n;
    const r = Math.max(14, Math.min(26, spacing / 2 - 5));
    const cy = (stampAreaTop + stampAreaBot) / 2;
    return Array.from({ length: n }, (_, i) => ({
      x: marginX + spacing / 2 + i * spacing,
      y: cy,
      r,
    }));
  }

  // Deux rangées : row1 ≥ row2, row2 centrée sous row1.
  // Avec label : équi-répartition de l'espace — autant d'air entre la baseline du
  //   label (y=64) et le haut de rangée 1, qu'entre les bords des deux rangées.
  //   W = (stampAreaBot − 64 − 4r) / 2  →  cy1 = 64+r+W, cy2 = 64+3r+2W.
  // Sans label : rangées centrées dans toute la zone disponible (positions inchangées).
  const row1 = Math.ceil(n / 2);
  const row2 = n - row1;
  const spacing = availW / row1;
  const r = Math.max(11, Math.min(24, spacing / 2 - 4));

  let cy1, cy2;
  if (showLabel) {
    const labelBottom = 64;
    const W = (stampAreaBot - labelBottom - 4 * r) / 2;
    cy1 = labelBottom + r + W;
    cy2 = labelBottom + 3 * r + 2 * W;
  } else {
    const stampAreaTop = 20;
    cy1 = stampAreaTop + (stampAreaBot - stampAreaTop) * 0.30;
    cy2 = stampAreaTop + (stampAreaBot - stampAreaTop) * 0.72;
  }
  const row2Shift = (row1 - row2) * spacing / 2;
  const stamps = [];
  for (let i = 0; i < row1; i++)
    stamps.push({ x: marginX + spacing / 2 + i * spacing, y: cy1, r });
  for (let i = 0; i < row2; i++)
    stamps.push({ x: marginX + row2Shift + spacing / 2 + i * spacing, y: cy2, r });
  return stamps;
}

// ── Couleurs adaptatives des tampons (WCAG) ───────────────────────────────
// Fond sombre (lum < 0.18) → tampons clairs (comportement historique)
// Fond clair  (lum ≥ 0.18) → tampons foncés contrastés
// Même seuil et même logique que labelSvg — cohérence visuelle garantie.
function stampColors(bgColor, overrides = {}) {
  const lum = relativeLuminance(bgColor || '#1a1a2e');
  // Palette WCAG automatique — calcul strictement inchangé.
  const base = lum >= 0.18
    ? {
        emptyFill:   'rgba(0,0,0,0.05)',
        emptyStroke: 'rgba(0,0,0,0.40)',
        filledFill:  darken(bgColor, 0.62),
        filledIcon:  lighten(bgColor, 0.88),
        ghostIcon:   'rgba(0,0,0,0.20)',
      }
    : {
        emptyFill:   'rgba(255,255,255,0.07)',
        emptyStroke: 'rgba(255,255,255,0.58)',
        filledFill:  'white',
        filledIcon:  bgColor || '#1a1a2e',
        ghostIcon:   'rgba(255,255,255,0.30)',
      };

  // Overrides manuels par marchand (couleur_pastille_*). Chaque valeur non-vide
  // écrase le calcul WCAG pour cette sortie ; NULL/undefined/'' → repli sur la
  // base (via ||) → zéro régression quand rien n'est configuré.
  //   • fond    → filledFill (cercle rempli)
  //   • contour → emptyStroke ET filledStroke (contour des deux états — décision A/B)
  //   • icone   → filledIcon (icône remplie)
  // Restent WCAG (décision A) : emptyFill (fond des vides) et ghostIcon (icône
  // fantôme, portée par une pastille vide). filledStroke est NOUVEAU : null par
  // défaut → aucun contour rendu sur la pastille remplie (comportement historique).
  // NB : les overrides ne sont PAS passés en état reward (cf. buildSvg, décision C).
  return {
    emptyFill:    base.emptyFill,
    emptyStroke:  overrides.contour || base.emptyStroke,
    filledFill:   overrides.fond    || base.filledFill,
    filledStroke: overrides.contour || null,
    filledIcon:   overrides.icone   || base.filledIcon,
    ghostIcon:    base.ghostIcon,
  };
}

// ── Génère le SVG d'un tampon (icon_metier) ───────────────────────────────
// Phosphor viewBox 0 0 256 256, centre à (128,128).
// Transform : translate(cx,cy) scale(r*0.68/128) translate(-128,-128)
//   → icône ≈ 68% du rayon, centrée sur (cx,cy).
// Règles visuelles :
//   - Tampon vide         → cercle seul (aucune icône)
//   - Tampon vide + isLast → cercle + icône cadeau fantôme (toujours visible)
//   - Tampon rempli        → cercle coloré + icône contrastée
//   - Tampon rempli + isLast → cercle coloré + icône cadeau contrastée
function stampSvg({ x, y, r, filled, iconName, isLast, emptyFill, emptyStroke, filledFill, filledStroke, filledIcon, ghostIcon }) {
  const scale    = +((r * 0.68) / 128).toFixed(4);
  const iconKey  = isLast ? 'gift' : (iconName in ICONS ? iconName : 'star');
  const iconPath = ICONS[iconKey];
  const tr = `translate(${x},${y}) scale(${scale}) translate(-128,-128)`;

  if (filled) {
    // filledStroke (couleur_pastille_contour) : contour optionnel de la pastille
    // remplie — rien si non défini (comportement historique). Rend visible un
    // cercle transparent/sombre (ex. étoile dorée cerclée sur fond noir).
    const stroke = filledStroke ? ` stroke="${filledStroke}" stroke-width="2.5"` : '';
    return `
      <circle cx="${x}" cy="${y}" r="${r}" fill="${filledFill}"${stroke}/>
      <g transform="${tr}" fill="${filledIcon}">${iconPath}</g>`;
  }
  if (isLast) {
    return `
      <circle cx="${x}" cy="${y}" r="${r}" fill="${emptyFill}" stroke="${emptyStroke}" stroke-width="2.5"/>
      <g transform="${tr}" fill="${ghostIcon}">${iconPath}</g>`;
  }
  return `
    <circle cx="${x}" cy="${y}" r="${r}" fill="${emptyFill}" stroke="${emptyStroke}" stroke-width="2.5"/>`;
}

// ── Génère le SVG d'un tampon logo_stamp ──────────────────────────────────
// logoB64: PNG logo normalisé (base64), null si non disponible → fallback icon
function logoStampSvg({ x, y, r, filled, logoB64, iconName, idx, emptyFill, emptyStroke, filledFill, filledStroke, filledIcon, ghostIcon }) {
  if (!filled) {
    return `
      <circle cx="${x}" cy="${y}" r="${r}" fill="${emptyFill}" stroke="${emptyStroke}" stroke-width="2.5"/>`;
  }
  if (!logoB64) {
    return stampSvg({ x, y, r, filled: true, iconName, isLast: false, emptyFill, emptyStroke, filledFill, filledStroke, filledIcon, ghostIcon });
  }
  const imgSize = r * 1.4;
  const imgX = +(x - imgSize / 2).toFixed(1);
  const imgY = +(y - imgSize / 2).toFixed(1);
  const clipId = `lclip${idx}`;
  // Contour optionnel de la pastille remplie (couleur_pastille_contour), cohérent
  // avec stampSvg — rien si non défini.
  const stroke = filledStroke ? ` stroke="${filledStroke}" stroke-width="2.5"` : '';
  return `
    <defs><clipPath id="${clipId}"><circle cx="${x}" cy="${y}" r="${r}"/></clipPath></defs>
    <circle cx="${x}" cy="${y}" r="${r}" fill="${filledFill}"${stroke}/>
    <image href="data:image/png;base64,${logoB64}" x="${imgX}" y="${imgY}"
      width="${imgSize}" height="${imgSize}"
      clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid meet"/>`;
}

// ── Arrière-plan du strip : couleur plate identique à couleur_fond du pass ──
// Couleur plate = accord visuel parfait entre strip et fond du pass Apple/Google.
// Couvre les 750px pleins (y compris les 60px de bord hors zone sûre Apple).
function bgSvg({ w, h, couleurFond, customBgB64 }) {
  if (customBgB64) {
    return `<image href="data:image/jpeg;base64,${customBgB64}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>
       <rect width="${w}" height="${h}" fill="${couleurFond}" opacity="0.55"/>`;
  }
  return `<rect width="${w}" height="${h}" fill="${couleurFond}"/>`;
}

// Assombrit une couleur hex d'un facteur [0,1]
function darken(hex, f) {
  const h = (hex || '#1a1a2e').replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  return `#${[r, g, b].map(c => Math.max(0, Math.round(c * (1 - f))).toString(16).padStart(2, '0')).join('')}`;
}

// Éclaircit une couleur hex vers le blanc d'un facteur [0,1]
function lighten(hex, f) {
  const h = (hex || '#1a1a2e').replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  return `#${[r, g, b].map(c => Math.min(255, Math.round(c + (255 - c) * f)).toString(16).padStart(2, '0')).join('')}`;
}

// Luminance relative WCAG 2.1 d'une couleur hex
function relativeLuminance(hex) {
  const h = (hex || '#1a1a2e').replace('#', '');
  return [0, 2, 4].reduce((lum, i, j) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    const lin = c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    return lum + lin * [0.2126, 0.7152, 0.0722][j];
  }, 0);
}

// ── Label optionnel, centré en haut — couleur adaptative à la luminosité du fond
// Texte bilingue selon la langue du marchand (figée à la création) : défaut EN.
function labelSvg({ w, h, couleurFond, langue }) {
  const lum = relativeLuminance(couleurFond || '#1a1a2e');
  // Fond sombre (lum < 0.18) → texte blanc semi-transparent
  // Fond clair  (lum ≥ 0.18) → texte foncé dérivé du fond (toujours lisible)
  const fill    = lum < 0.18 ? 'white'                    : darken(couleurFond, 0.62);
  const opacity = lum < 0.18 ? '0.5'                      : '0.80';
  const text    = langue === 'fr' ? 'CARTE DE FIDÉLITÉ' : 'LOYALTY CARD';
  return `<text x="${w / 2}" y="${(60 / 246) * h}" font-family="DM Sans, sans-serif" font-weight="700"
    font-size="${(22 / 246) * h}" letter-spacing="${(3.5 / 246) * h}" fill="${fill}" opacity="${opacity}"
    text-anchor="middle">${text}</text>`;
}

// ── Constructeur SVG principal ─────────────────────────────────────────────
// Contenu (tampons, label) dans la zone sûre Apple (630px centraux en espace
// 750) ; le décor de fond couvre toute la largeur. Pas de nom marchand, pas
// de compteur, aucune signature WinWin : le strip est 100% au marchand.
function buildSvg({ marchand, filledCount, logoB64, customBgB64, w = 750, h = 246 }) {
  const iStamps   = marchand.strip_mode === 'stamps';
  const theme     = marchand.strip_theme || 'icon_metier';
  const iconName  = marchand.stamp_icon || 'coffee';
  const maxValue  = marchand.max_value || 10;
  // Récompense atteinte : utiliser couleur_fond_reward comme base du dégradé
  // (label adaptatif + icône icones suivent automatiquement cette couleur)
  const isReward  = filledCount >= maxValue;
  const bgColor   = isReward
    ? (marchand.couleur_fond_reward || '#c9a84c')
    : (marchand.couleur_fond || '#1a1a2e');
  // Décision C : les couleurs manuelles de pastille ne s'appliquent PAS en reward
  // (le fond passe au doré ; une icône dorée sur doré serait illisible au moment
  // même de la récompense). En reward → overrides vides → palette WCAG depuis
  // couleur_fond_reward, strictement comme avant.
  const overrides = isReward ? {} : {
    fond:    marchand.couleur_pastille_fond,
    contour: marchand.couleur_pastille_contour,
    icone:   marchand.couleur_pastille_icone,
  };
  const colors    = stampColors(bgColor, overrides); // WCAG auto + overrides manuels éventuels
  const showLabel = marchand.strip_label !== 'off';

  // Mise à l'échelle des positions si h != 246 (même SVG, juste viewBox changé)
  const scaleY = h / 246;
  const scaleX = w / 750;

  let stampsHtml = '';
  if (iStamps && maxValue > 0) {
    // Calcul du layout dans l'espace 750×246, puis scale
    const positions = computeLayout(maxValue, { showLabel });
    stampsHtml = positions.map((pos, i) => {
      const filled = i < filledCount;
      const sx = +(pos.x * scaleX).toFixed(1);
      const sy = +(pos.y * scaleY).toFixed(1);
      const sr = +(pos.r * Math.min(scaleX, scaleY)).toFixed(1);

      if (theme === 'logo_stamp') {
        return logoStampSvg({ x: sx, y: sy, r: sr, filled, logoB64, iconName, idx: i, ...colors });
      }
      return stampSvg({ x: sx, y: sy, r: sr, filled, iconName, isLast: i === maxValue - 1, ...colors });
    }).join('');
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}">
  ${bgSvg({ w, h, couleurFond: bgColor, customBgB64 })}
  ${showLabel ? labelSvg({ w, h, couleurFond: bgColor, langue: marchand.langue }) : ''}
  ${stampsHtml}
</svg>`;
}

// ── Normalisation logo pour logo_stamp ─────────────────────────────────────
// Trim + contain carré + fond transparent → PNG base64
async function normalizeLogoForStamp(logoBuffer, diameter) {
  const size = Math.round(diameter * 2.4); // sursampling pour qualité
  const buf = await sharp(logoBuffer)
    .trim({ threshold: 20 })
    .resize({ width: size, height: size, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return buf.toString('base64');
}

// ── Rastériseur SVG → Buffer PNG via @resvg/resvg-js ──────────────────────
// Utilise les TTF convertis en mémoire depuis WOFF (fontdb ne lit pas WOFF nativement).
// Aucune dépendance fontconfig/pango : fonctionne sur Railway nixpacks sans polices système.
function rasterize(svgStr, fitTo = { mode: 'original' }) {
  const inst = new Resvg(svgStr, {
    fitTo,
    font: {
      loadSystemFonts: false,
      fontFiles:        FONT_PATHS,
      defaultFontFamily: 'DM Sans',
      sansSerifFamily:   'DM Sans',
    },
  });
  return Buffer.from(inst.render().asPng());
}

// ── Rendu → Buffer PNG (3 variantes) ───────────────────────────────────────
// Retourne { strip2x, strip3x, hero } — Buffers PNG.
// staticImageBuffer: si fourni, l'image uploadée remplace entièrement le strip
//   (redimensionné aux bonnes dimensions par sharp, aucun SVG généré).
// logoBuffer: null si logo_stamp inapplicable ou logo absent.
// customBgBuffer: null si pas de fond custom ou mode pas premium.
async function render({ marchand, filledCount, logoBuffer, customBgBuffer, staticImageBuffer }) {
  // Mode image statique uploadée — override total, toutes variantes
  if (staticImageBuffer) {
    const [strip2x, strip3x, hero] = await Promise.all([
      sharp(staticImageBuffer).resize(VARIANTS.strip2x.w, VARIANTS.strip2x.h, { fit: 'cover', position: 'centre' }).png().toBuffer(),
      sharp(staticImageBuffer).resize(VARIANTS.strip3x.w, VARIANTS.strip3x.h, { fit: 'cover', position: 'centre' }).png().toBuffer(),
      sharp(staticImageBuffer).resize(VARIANTS.hero.w,    VARIANTS.hero.h,    { fit: 'cover', position: 'centre' }).png().toBuffer(),
    ]);
    return { strip2x, strip3x, hero };
  }

  const theme    = marchand.strip_theme || 'icon_metier';
  const maxValue = marchand.max_value || 10;

  // Normalisation du logo pour logo_stamp (une fois, réutilisée pour toutes les variantes)
  let logoB64 = null;
  if (theme === 'logo_stamp' && logoBuffer) {
    const refRadius = Math.max(16, Math.min(30, (750 - 72) / maxValue / 2 - 5));
    logoB64 = await normalizeLogoForStamp(logoBuffer, refRadius).catch(e => {
      console.warn('[strip-generator] Logo normalisation échouée:', e.message);
      return null;
    });
  }

  // Background custom (si fourni)
  let customBgB64 = null;
  if (customBgBuffer) {
    customBgB64 = customBgBuffer.toString('base64');
  }

  // strip2x et strip3x partagent le même SVG 750×246 (strip3x = zoom ×1.5)
  // hero est regénéré aux dimensions exactes 1032×336 (rapport légèrement différent)
  const svgStrip = buildSvg({ marchand, filledCount, logoB64, customBgB64, w: 750,  h: 246 });
  const svgHero  = buildSvg({ marchand, filledCount, logoB64, customBgB64, w: 1032, h: 336 });

  const [strip2x, strip3x, hero] = await Promise.all([
    Promise.resolve(rasterize(svgStrip, { mode: 'original' })),
    Promise.resolve(rasterize(svgStrip, { mode: 'zoom', value: 1.5 })),
    Promise.resolve(rasterize(svgHero,  { mode: 'original' })),
  ]);

  return { strip2x, strip3x, hero };
}

module.exports = { render, buildSvg, computeLayout, normalizeLogoForStamp, VARIANTS, ICONS };
