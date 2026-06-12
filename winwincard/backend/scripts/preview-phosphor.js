'use strict';
/**
 * Génère deux aperçus PNG :
 *  1. preview_icons_phosphor.png — 12 icônes Phosphor dans des tampons
 *  2. preview_gradient_compare.png — dégradé actuel vs proposition
 */
const fs   = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const PHOSPHOR_DIR = path.join(__dirname, '../node_modules/@phosphor-icons/core/assets/regular');
const OUT_DIR = '/tmp';

// ── Helpers couleur ────────────────────────────────────────────────────────
function darken(hex, f) {
  const h = (hex || '#1a1a2e').replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  return `#${[r, g, b].map(c => Math.max(0, Math.round(c * (1 - f))).toString(16).padStart(2, '0')).join('')}`;
}
function lighten(hex, f) {
  const h = (hex || '#1a1a2e').replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  return `#${[r, g, b].map(c => Math.min(255, Math.round(c + (255 - c) * f)).toString(16).padStart(2, '0')).join('')}`;
}

// ── Chargement du contenu interne d'un SVG Phosphor ───────────────────────
function phosphorInner(file) {
  const raw = fs.readFileSync(path.join(PHOSPHOR_DIR, `${file}.svg`), 'utf8');
  return raw.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
}

// ── Tampon avec icône Phosphor ─────────────────────────────────────────────
// Transform : translate au centre → scale pour que l'icône ≈ 68% du diamètre
// Phosphor : viewBox 0 0 256 256, centre à 128,128.
function phosphorStamp({ cx, cy, r, filled, file, brandColor }) {
  const inner = phosphorInner(file);
  const scale = (r * 0.68) / 128; // 68% du rayon → icône ≈ 68% du demi-diamètre
  const transform = `translate(${cx},${cy}) scale(${scale.toFixed(4)}) translate(-128,-128)`;

  if (filled) {
    return `
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="white"/>
      <g transform="${transform}" fill="${brandColor}">${inner}</g>`;
  }
  return `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.55)" stroke-width="${(r * 0.09).toFixed(1)}"/>
    <g transform="${transform}" fill="rgba(255,255,255,0.28)">${inner}</g>`;
}

// ── Rendu resvg ────────────────────────────────────────────────────────────
function rasterize(svgStr) {
  const inst = new Resvg(svgStr, { font: { loadSystemFonts: false } });
  return Buffer.from(inst.render().asPng());
}

// ═══════════════════════════════════════════════════════════════════════════
// APERÇU 1 — Grille des 12 icônes
// ═══════════════════════════════════════════════════════════════════════════
const ICONS = [
  { label: 'Coffee',      file: 'coffee'       },
  { label: 'Scissors',    file: 'scissors'     },
  { label: 'Hamburger',   file: 'hamburger'    },
  { label: 'ShoppingBag', file: 'shopping-bag' },
  { label: 'Heart',       file: 'heart'        },
  { label: 'Star',        file: 'star'         },
  { label: 'Gift',        file: 'gift'         },
  { label: 'HairDryer',   file: 'hair-dryer'   },
  { label: 'Barbell',     file: 'barbell'      },
  { label: 'ForkKnife',   file: 'fork-knife'   },
  { label: 'Flower',      file: 'flower'       },
  { label: 'Check',       file: 'check'        },
];

function buildIconGrid() {
  const COLS = 6, ROWS = 2;
  const R       = 36;          // rayon du tampon
  const CELL_W  = 140;
  const CELL_H  = 110;
  const W = COLS * CELL_W;
  const H = ROWS * CELL_H + 40; // +40 pour le titre en bas
  const BG = '#1a1a2e';
  const BRAND = '#2e6fa8';

  let stamps = '';
  ICONS.forEach(({ label, file }, idx) => {
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const cx = col * CELL_W + CELL_W / 2;
    const cy = row * CELL_H + CELL_H / 2;

    // Deux tampons côte à côte : vide + rempli
    stamps += phosphorStamp({ cx: cx - R - 6, cy, r: R, filled: false,  file, brandColor: BRAND });
    stamps += phosphorStamp({ cx: cx + R + 6, cy, r: R, filled: true,   file, brandColor: BRAND });

    // Label sous les tampons
    stamps += `<text x="${cx}" y="${cy + R + 18}" font-family="sans-serif" font-size="11" fill="rgba(255,255,255,0.6)" text-anchor="middle">${label}</text>`;
  });

  // Titre
  const titleY = H - 14;
  const title = `<text x="${W/2}" y="${titleY}" font-family="sans-serif" font-size="12" fill="rgba(255,255,255,0.35)" text-anchor="middle">◯ = vide   ● = rempli  —  couleur_fond: ${BRAND}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  ${stamps}
  ${title}
</svg>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// APERÇU 2 — Comparaison dégradé : avant / option A / option B
// ═══════════════════════════════════════════════════════════════════════════

// On teste avec deux couleurs représentatives
const TEST_COLORS = ['#2e6fa8', '#7b3fa8', '#1a6e47'];

function stripBg_current(couleur, w, h) {
  return `<defs>
    <linearGradient id="bg_curr" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="${lighten(couleur, 0.06)}"/>
      <stop offset="100%" stop-color="${darken(couleur, 0.42)}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg_curr)"/>`;
}

function stripBg_flat(couleur, w, h) {
  return `<rect width="${w}" height="${h}" fill="${couleur}"/>`;
}

function stripBg_subtle(couleur, w, h) {
  return `<defs>
    <linearGradient id="bg_sub" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="${lighten(couleur, 0.10)}"/>
      <stop offset="100%" stop-color="${darken(couleur, 0.10)}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg_sub)"/>`;
}

function stampRow({ y, r, n = 7, brandColor, file = 'coffee', w }) {
  const spacing = (w - 120) / n;
  let out = '';
  for (let i = 0; i < n; i++) {
    const cx = 60 + spacing / 2 + i * spacing;
    out += phosphorStamp({ cx, cy: y, r, filled: i < 4, file, brandColor });
  }
  return out;
}

function buildOneStrip({ couleur, bgFn, id, w = 750, h = 110 }) {
  const stamps = stampRow({ y: h / 2, r: 22, n: 8, brandColor: couleur, file: 'coffee', w });
  return `<g id="strip_${id}">
    ${bgFn(couleur, w, h)}
    ${stamps}
  </g>`;
}

function buildGradientCompare() {
  const SW = 750, SH = 110;
  const PAD = 8;
  const LABEL_H = 22;
  const TOTAL_STRIPS = 3; // current, flat, subtle
  const COLOR_BLOCKS = TEST_COLORS.length;

  const ROW_H = SH + LABEL_H + PAD;
  const W = SW + 120; // +120 pour l'étiquette couleur à gauche
  const H = COLOR_BLOCKS * TOTAL_STRIPS * ROW_H + 40;

  const LABELS = [
    'Actuel   (lighten 6% → darken 42%)',
    'Option A  (couleur plate, sans dégradé)',
    'Option B  (lighten 10% → darken 10%)',
  ];
  const bgFns = [stripBg_current, stripBg_flat, stripBg_subtle];

  let content = `<rect width="${W}" height="${H}" fill="#111"/>`;

  TEST_COLORS.forEach((couleur, ci) => {
    bgFns.forEach((bgFn, bi) => {
      const y0 = (ci * TOTAL_STRIPS + bi) * ROW_H + 30;

      // Étiquette couleur (colonne gauche)
      if (bi === 0) {
        content += `<rect x="0" y="${y0}" width="112" height="${TOTAL_STRIPS * ROW_H - PAD}" fill="${couleur}" rx="4"/>
          <text x="56" y="${y0 + TOTAL_STRIPS * ROW_H / 2}" font-family="sans-serif" font-size="11" fill="white" text-anchor="middle" dominant-baseline="middle">${couleur}</text>`;
      }

      // Strip
      const sx = 116;
      const idStr = `c${ci}_b${bi}`;
      content += `<g transform="translate(${sx},${y0})">
        ${buildOneStrip({ couleur, bgFn, id: idStr, w: SW, h: SH })}
      </g>`;

      // Label de l'option
      content += `<text x="${sx}" y="${y0 + SH + LABEL_H - 5}" font-family="sans-serif" font-size="10" fill="rgba(255,255,255,0.45)">${LABELS[bi]}</text>`;
    });
  });

  // Titre
  content += `<text x="${W/2}" y="18" font-family="sans-serif" font-size="13" fill="rgba(255,255,255,0.7)" text-anchor="middle" font-weight="bold">Comparaison dégradé strip</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${content}</svg>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
(async () => {
  console.log('Génération des aperçus Phosphor Icons…');

  // 1. Grille des icônes
  const svgIcons = buildIconGrid();
  const pngIcons = rasterize(svgIcons);
  fs.writeFileSync(path.join(OUT_DIR, 'preview_icons_phosphor.png'), pngIcons);
  console.log('→ preview_icons_phosphor.png  (' + (pngIcons.length / 1024).toFixed(0) + ' KB)');

  // 2. Comparaison dégradé
  const svgGrad = buildGradientCompare();
  const pngGrad = rasterize(svgGrad);
  fs.writeFileSync(path.join(OUT_DIR, 'preview_gradient_compare.png'), pngGrad);
  console.log('→ preview_gradient_compare.png  (' + (pngGrad.length / 1024).toFixed(0) + ' KB)');

  console.log('Done.');
})();
