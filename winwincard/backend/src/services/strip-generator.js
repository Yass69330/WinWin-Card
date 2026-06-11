// Strip & hero image generator — SVG templates + sharp rasterisation.
// Polices : DM Sans (labels, compteur) + Syne (nom marchand), OFL, embarquées en WOFF.
// Sorties : strip@2x 750×246, strip@3x 1125×369, hero Google 1032×336.
'use strict';

const fs    = require('fs');
const path  = require('path');
const sharp = require('sharp');

// ── Polices (chargées une seule fois au démarrage du module) ───────────────
let FONT_CSS = '';
(function loadFonts() {
  try {
    const b64woff = (pkg, file) => {
      const p = require.resolve(`@fontsource/${pkg}/files/${file}`);
      return fs.readFileSync(p).toString('base64');
    };
    const face = (fam, w, b64) =>
      `@font-face{font-family:'${fam}';font-weight:${w};font-style:normal;` +
      `src:url('data:font/woff;base64,${b64}') format('woff')}`;
    FONT_CSS = [
      face('DM Sans', 400, b64woff('dm-sans', 'dm-sans-latin-400-normal.woff')),
      face('DM Sans', 700, b64woff('dm-sans', 'dm-sans-latin-700-normal.woff')),
      face('Syne',    700, b64woff('syne',    'syne-latin-700-normal.woff')),
    ].join('');
  } catch (e) {
    console.warn('[strip-generator] Font loading failed, using system fallback:', e.message);
  }
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
function computeLayout(n) {
  const marginX = 36, availW = 750 - marginX * 2;
  const stampAreaTop = 80, stampAreaBot = 230; // zone verticale réservée aux tampons

  // Seuil de passage à deux rangées : > 14 (plus lisible à r≥18)
  if (n <= 14) {
    const spacing = availW / n;
    // rayon en fonction de la densité : ≥16px, ≤30px
    const r = Math.max(16, Math.min(30, spacing / 2 - 5));
    const cy = (stampAreaTop + stampAreaBot) / 2;
    return Array.from({ length: n }, (_, i) => ({
      x: marginX + spacing / 2 + i * spacing,
      y: cy,
      r,
    }));
  }

  // Deux rangées
  const row1 = Math.ceil(n / 2);
  const row2 = n - row1;
  const spacing = availW / Math.max(row1, row2);
  const r = Math.max(13, Math.min(22, spacing / 2 - 4));
  const cy1 = stampAreaTop + (stampAreaBot - stampAreaTop) * 0.33;
  const cy2 = stampAreaTop + (stampAreaBot - stampAreaTop) * 0.73;
  const stamps = [];
  for (let i = 0; i < row1; i++)
    stamps.push({ x: marginX + spacing / 2 + i * spacing, y: cy1, r });
  for (let i = 0; i < row2; i++)
    stamps.push({ x: marginX + spacing / 2 + i * spacing, y: cy2, r });
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
  return `
    <circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="rgba(255,255,255,0.32)" stroke-width="2"/>
    <g transform="translate(${x},${y}) scale(${scale})" style="opacity:0.22" color="white">${iconPath}</g>`;
}

// ── Génère le SVG d'un tampon logo_stamp ──────────────────────────────────
// logoB64: PNG logo normalisé (base64), null si non disponible → fallback icon
function logoStampSvg({ x, y, r, filled, logoB64, iconName, color, idx }) {
  if (!filled) {
    return `
      <circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="rgba(255,255,255,0.32)" stroke-width="2"/>`;
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

// ── Bloc compteur + arrière-plan du strip ─────────────────────────────────
function bgSvg({ w, h, couleurFond, customBgB64 }) {
  const bg = customBgB64
    ? `<image href="data:image/jpeg;base64,${customBgB64}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>
       <rect width="${w}" height="${h}" fill="${couleurFond}" opacity="0.55"/>`
    : `<defs>
         <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
           <stop offset="0%"   stop-color="${couleurFond}" stop-opacity="1"/>
           <stop offset="100%" stop-color="${darken(couleurFond, 0.25)}" stop-opacity="1"/>
         </linearGradient>
       </defs>
       <rect width="${w}" height="${h}" fill="url(#bg)"/>`;
  return bg;
}

// Assombrit une couleur hex d'un facteur [0,1]
function darken(hex, f) {
  const h = (hex || '#1a1a2e').replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  return `#${[r, g, b].map(c => Math.max(0, Math.round(c * (1 - f))).toString(16).padStart(2, '0')).join('')}`;
}

// ── Bloc texte marchand (titre + sous-titre) ───────────────────────────────
function headerTextSvg({ marchand, h, filledCount }) {
  const displayMax = marchand.display_max_value || marchand.max_value;
  return `
    <text x="36" y="${h === 246 ? 52 : 78}" font-family="Syne, sans-serif" font-weight="700"
      font-size="${h === 246 ? 28 : 42}" fill="white" opacity="0.95">${esc(marchand.pass_display_name || marchand.nom)}</text>
    <text x="36" y="${h === 246 ? 72 : 108}" font-family="DM Sans, sans-serif" font-weight="400"
      font-size="${h === 246 ? 13 : 20}" fill="white" opacity="0.5">Loyalty Card</text>`;
}

// Compteur N/M en bas à droite
function counterSvg({ filledCount, maxValue, w, h, stampsVisible }) {
  if (!stampsVisible) return '';
  const displayMax = maxValue;
  const fs = h === 246 ? 22 : 34;
  return `<text x="${w - 36}" y="${h === 246 ? 228 : 342}"
    font-family="DM Sans, sans-serif" font-weight="700" font-size="${fs}"
    fill="white" opacity="0.75" text-anchor="end">${filledCount} / ${displayMax}</text>`;
}

// Encode les entités HTML dans les textes marchands
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Constructeur SVG principal ─────────────────────────────────────────────
function buildSvg({ marchand, filledCount, logoB64, customBgB64, w = 750, h = 246 }) {
  const iStamps  = marchand.strip_mode === 'stamps';
  const theme    = marchand.strip_theme || 'icon_metier';
  const iconName = marchand.stamp_icon || 'coffee';
  const maxValue = marchand.max_value || 10;
  const bgColor  = marchand.couleur_fond || '#1a1a2e';
  const iColor   = iconColor(marchand);
  const premium  = theme === 'premium';

  // Mise à l'échelle des positions si h != 246 (même SVG, juste viewBox changé)
  const scaleY = h / 246;
  const scaleX = w / 750;

  let stampsHtml = '';
  if (iStamps && maxValue > 0) {
    // Calcul du layout dans l'espace 750×246, puis scale
    const positions = computeLayout(maxValue);
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

  // Ligne décorative sous le titre (mode static uniquement)
  const decorLine = !iStamps
    ? `<line x1="36" y1="${h === 246 ? 82 : 124}" x2="${w - 36}" y2="${h === 246 ? 82 : 124}"
          stroke="white" stroke-opacity="0.12" stroke-width="1"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}">
  <style>${FONT_CSS}</style>
  ${bgSvg({ w, h, couleurFond: bgColor, customBgB64 })}
  ${headerTextSvg({ marchand, h, filledCount })}
  ${decorLine}
  ${stampsHtml}
  ${counterSvg({ filledCount, maxValue, w, h, stampsVisible: iStamps })}
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

// ── Rendu sharp → Buffer PNG (3 variantes) ─────────────────────────────────
// Retourne { strip2x, strip3x, hero } — Buffers PNG optimisés.
// logoBuffer: null si logo_stamp inapplicable ou logo absent.
// customBgBuffer: null si pas de fond custom ou mode pas premium.
async function render({ marchand, filledCount, logoBuffer, customBgBuffer }) {
  const theme     = marchand.strip_theme || 'icon_metier';
  const maxValue  = marchand.max_value || 10;
  const isPremium = marchand.forfait === 'pro_plus';

  // Normalisation du logo pour logo_stamp (une fois, réutilisée pour toutes les variantes)
  let logoB64 = null;
  if (theme === 'logo_stamp' && logoBuffer) {
    // Utilise le rayon max possible (r≈28 pour 10 tampons) — downscalé au rendu
    const refRadius = Math.max(16, Math.min(30, (750 - 72) / maxValue / 2 - 5));
    logoB64 = await normalizeLogoForStamp(logoBuffer, refRadius).catch(e => {
      console.warn('[strip-generator] Logo normalisation échouée:', e.message);
      return null;
    });
  }

  // Background custom (Pro+ uniquement, non bloquant si absent)
  let customBgB64 = null;
  if (isPremium && customBgBuffer) {
    customBgB64 = customBgBuffer.toString('base64');
  }

  // Génère le SVG en base 750×246 — sharp redimensionne ensuite
  const svgBase = buildSvg({ marchand, filledCount, logoB64, customBgB64, w: 750, h: 246 });
  const svgBuf  = Buffer.from(svgBase);

  const [strip2x, strip3x, hero] = await Promise.all([
    sharp(svgBuf).resize(750,  246, { fit: 'fill' }).png({ compressionLevel: 9 }).toBuffer(),
    sharp(svgBuf).resize(1125, 369, { fit: 'fill' }).png({ compressionLevel: 6 }).toBuffer(),
    sharp(svgBuf).resize(1032, 336, { fit: 'fill' }).png({ compressionLevel: 6 }).toBuffer(),
  ]);

  return { strip2x, strip3x, hero };
}

module.exports = { render, buildSvg, computeLayout, normalizeLogoForStamp, VARIANTS, ICONS };
