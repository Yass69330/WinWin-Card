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

// ── Icônes (coordonnées ±20 unités, centrées sur 0,0) ─────────────────────
// Utilisées via: <g transform="translate(cx,cy) scale(ICON_SCALE)"> ... </g>
// ICON_SCALE = r * 0.055  (r = rayon du tampon en px → icône ≈ 65% du diamètre)
const ICONS = {
  coffee: `
    <path d="M-9,-7 L9,-7 L7,9 L-7,9 Z" fill="currentColor"/>
    <path d="M9,0 Q15,0 15,4 Q15,8 9,8" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M-3,-10 Q-2,-8 -3,-7 M2,-11 Q3,-9 2,-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/>`,

  scissors: `
    <line x1="-11" y1="-11" x2="2"  y2="2"  stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="-11" y1="11"  x2="2"  y2="-2" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="8" cy="-8"  r="5" fill="none" stroke="currentColor" stroke-width="2"/>
    <circle cx="8" cy="8"   r="5" fill="none" stroke="currentColor" stroke-width="2"/>`,

  pizza: `
    <path d="M0,-14 L12,8 L-12,8 Z" fill="currentColor"/>
    <path d="M-12,8 Q0,16 12,8" fill="currentColor"/>
    <circle cx="-1" cy="0"  r="2" fill="white"/>
    <circle cx="4"  cy="-5" r="1.7" fill="white"/>
    <circle cx="-5" cy="-5" r="1.7" fill="white"/>`,

  bag: `
    <path d="M-10,-2 L10,-2 L11,12 L-11,12 Z" fill="currentColor"/>
    <path d="M-4,-2 Q-4,-10 0,-10 Q4,-10 4,-2" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>`,

  heart: `
    <path d="M0,11 C-4,6 -14,-1 -14,-7 C-14,-13 -7,-16 -3.5,-12 C-2,-10 0,-8 0,-8 C0,-8 2,-10 3.5,-12 C7,-16 14,-13 14,-7 C14,-1 4,6 0,11 Z" fill="currentColor"/>`,

  star: `
    <polygon points="0,-14 3.3,-5 13,-4 5.5,2.5 8,12 0,7 -8,12 -5.5,2.5 -13,-4 -3.3,-5" fill="currentColor"/>`,

  gift: `
    <rect x="-10" y="1"  width="20" height="12" rx="1.5" fill="currentColor"/>
    <rect x="-11" y="-3" width="22" height="5"  rx="1.5" fill="currentColor"/>
    <line x1="0" y1="-3" x2="0" y2="13" stroke="white" stroke-width="1.8"/>
    <line x1="-11" y1="5" x2="11" y2="5" stroke="white" stroke-width="1.8"/>
    <path d="M0,-3 Q-2,-9 -6,-7 Q-9,-5 -6,-3 Q-3,-1 0,-3 Z" fill="currentColor"/>
    <path d="M0,-3 Q2,-9  6,-7 Q9,-5  6,-3 Q3,-1 0,-3 Z"  fill="currentColor"/>`,

  nails: `
    <ellipse cx="0" cy="-4" rx="6" ry="8" fill="currentColor"/>
    <rect x="-2.5" y="4"  width="5" height="7"  rx="2" fill="currentColor"/>
    <rect x="-4"   y="-12" width="8" height="3.5" rx="1.5" fill="currentColor"/>`,

  music: `
    <ellipse cx="-5" cy="8" rx="5.5" ry="3.5" transform="rotate(-18 -5 8)" fill="currentColor"/>
    <rect x="-0.5" y="-11" width="2.5" height="19" fill="currentColor"/>
    <path d="M2,-11 L12,-7 L12,-1 L2,3 Z" fill="currentColor"/>`,

  dumbbell: `
    <rect x="-11" y="-2.5" width="22" height="5" rx="2" fill="currentColor"/>
    <rect x="-14" y="-7"   width="5"  height="14" rx="2" fill="currentColor"/>
    <rect x="9"   y="-7"   width="5"  height="14" rx="2" fill="currentColor"/>`,
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
    const stampAreaTop = showLabel ? 66 : 20;
    const spacing = availW / n;
    const r = Math.max(16, Math.min(30, spacing / 2 - 5));
    const cy = (stampAreaTop + stampAreaBot) / 2;
    return Array.from({ length: n }, (_, i) => ({
      x: marginX + spacing / 2 + i * spacing,
      y: cy,
      r,
    }));
  }

  // Deux rangées : row1 ≥ row2, row2 centrée sous row1.
  // Avec label : équi-répartition de l'espace — autant d'air entre la baseline du
  //   label (y=46) et le haut de rangée 1, qu'entre les bords des deux rangées.
  //   W = (stampAreaBot − 46 − 4r) / 2  →  cy1 = 46+r+W, cy2 = 46+3r+2W.
  // Sans label : rangées centrées dans toute la zone disponible (positions inchangées).
  const row1 = Math.ceil(n / 2);
  const row2 = n - row1;
  const spacing = availW / row1;
  const r = Math.max(13, Math.min(28, spacing / 2 - 4));

  let cy1, cy2;
  if (showLabel) {
    const labelBottom = 46;
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

// ── Couleur d'icône dans un tampon rempli ─────────────────────────────────
// Utilise couleur_fond du marchand pour l'icône sur fond blanc.
function iconColor(marchand) {
  return marchand.couleur_fond || '#1a1a2e';
}

// ── Génère le SVG d'un tampon (icon_metier / premium) ─────────────────────
function stampSvg({ x, y, r, filled, iconName, color, isLast, premium }) {
  const scale    = +(r * 0.055).toFixed(3);
  const iconKey  = (premium && isLast) ? 'gift' : (iconName in ICONS ? iconName : 'star');
  const iconPath = ICONS[iconKey];

  if (filled) {
    return `
      <circle cx="${x}" cy="${y}" r="${r}" fill="white"/>
      <g transform="translate(${x},${y}) scale(${scale})" color="${color}">${iconPath}</g>`;
  }
  // Tampon vide : contour clair + voile léger pour rester lisible sur fond sombre
  return `
    <circle cx="${x}" cy="${y}" r="${r}" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.58)" stroke-width="2.5"/>
    <g transform="translate(${x},${y}) scale(${scale})" style="opacity:0.3" color="white">${iconPath}</g>`;
}

// ── Génère le SVG d'un tampon logo_stamp ──────────────────────────────────
// logoB64: PNG logo normalisé (base64), null si non disponible → fallback icon
function logoStampSvg({ x, y, r, filled, logoB64, iconName, color, idx }) {
  if (!filled) {
    return `
      <circle cx="${x}" cy="${y}" r="${r}" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.58)" stroke-width="2.5"/>`;
  }
  if (!logoB64) {
    return stampSvg({ x, y, r, filled: true, iconName, color, isLast: false, premium: false });
  }
  const imgSize = r * 1.4;
  const imgX = +(x - imgSize / 2).toFixed(1);
  const imgY = +(y - imgSize / 2).toFixed(1);
  const clipId = `lclip${idx}`;
  return `
    <defs><clipPath id="${clipId}"><circle cx="${x}" cy="${y}" r="${r}"/></clipPath></defs>
    <circle cx="${x}" cy="${y}" r="${r}" fill="white"/>
    <image href="data:image/png;base64,${logoB64}" x="${imgX}" y="${imgY}"
      width="${imgSize}" height="${imgSize}"
      clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid meet"/>`;
}

// ── Arrière-plan du strip : dégradé diagonal dérivé de couleur_fond ──────────
// Couvre les 750px pleins (y compris les 60px de bord hors zone sûre Apple).
function bgSvg({ w, h, couleurFond, customBgB64 }) {
  if (customBgB64) {
    return `<image href="data:image/jpeg;base64,${customBgB64}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>
       <rect width="${w}" height="${h}" fill="${couleurFond}" opacity="0.55"/>`;
  }
  return `<defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%"   stop-color="${lighten(couleurFond, 0.06)}"/>
        <stop offset="100%" stop-color="${darken(couleurFond, 0.42)}"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#bg)"/>`;
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
function labelSvg({ w, h, couleurFond }) {
  const lum = relativeLuminance(couleurFond || '#1a1a2e');
  // Fond sombre (lum < 0.18) → texte blanc semi-transparent
  // Fond clair  (lum ≥ 0.18) → texte foncé dérivé du fond (toujours lisible)
  const fill    = lum < 0.18 ? 'white'                    : darken(couleurFond, 0.62);
  const opacity = lum < 0.18 ? '0.5'                      : '0.80';
  return `<text x="${w / 2}" y="${(46 / 246) * h}" font-family="DM Sans, sans-serif" font-weight="700"
    font-size="${(14 / 246) * h}" letter-spacing="${(3 / 246) * h}" fill="${fill}" opacity="${opacity}"
    text-anchor="middle">LOYALTY CARD</text>`;
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
  const bgColor   = marchand.couleur_fond || '#1a1a2e';
  const iColor    = iconColor(marchand);
  const premium   = theme === 'premium';
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
        return logoStampSvg({ x: sx, y: sy, r: sr, filled, logoB64, iconName, color: iColor, idx: i });
      }
      return stampSvg({ x: sx, y: sy, r: sr, filled, iconName, color: iColor, isLast: i === maxValue - 1, premium });
    }).join('');
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}">
  ${bgSvg({ w, h, couleurFond: bgColor, customBgB64 })}
  ${showLabel ? labelSvg({ w, h, couleurFond: bgColor }) : ''}
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
