'use strict';

// Run from repo root: node winwincard/backend/scripts/test-strip-generator.js
// Tests strip generation locally — no network calls, no Supabase.

const path   = require('path');
const assert = require('assert');

// Resolve from script location
const genPath = path.resolve(__dirname, '../src/services/strip-generator');
const { render, computeLayout, VARIANTS } = require(genPath);

let passed = 0;
let failed = 0;

function ok(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${label}\n    ${e.message}`);
    failed++;
  }
}

async function run() {
  console.log('\n─── computeLayout ───────────────────────────────');

  ok('n=5 → single row (n<=8)', () => {
    const positions = computeLayout(5);
    assert.strictEqual(positions.length, 5);
    const ys = [...new Set(positions.map(p => p.y))];
    assert.strictEqual(ys.length, 1, 'Expected 1 row');
    positions.forEach(p => {
      assert.ok(p.x >= 60, `x=${p.x} must be >= 60 (safe zone left)`);
      assert.ok(p.x <= 690, `x=${p.x} must be <= 690 (safe zone right)`);
    });
  });

  ok('n=8 → single row (boundary)', () => {
    const positions = computeLayout(8);
    assert.strictEqual(positions.length, 8);
    const ys = [...new Set(positions.map(p => p.y))];
    assert.strictEqual(ys.length, 1, 'n=8 must be single row');
  });

  ok('n=9 → two rows', () => {
    const positions = computeLayout(9);
    assert.strictEqual(positions.length, 9);
    const ys = [...new Set(positions.map(p => p.y))];
    assert.strictEqual(ys.length, 2, 'n=9 must be two rows');
  });

  ok('n=10 → two rows (5+5), row2 centred', () => {
    const positions = computeLayout(10);
    const ys = [...new Set(positions.map(p => p.y))];
    assert.strictEqual(ys.length, 2);
    const row1 = positions.slice(0, 5);
    const row2 = positions.slice(5);
    assert.strictEqual(row1.length, 5);
    assert.strictEqual(row2.length, 5);
    // Row2 centred: with equal rows the shift is 0 → same x start
    const xDiff = Math.abs(row1[0].x - row2[0].x);
    assert.ok(xDiff < 1, `row2 offset should be 0 for equal rows, got ${xDiff}`);
  });

  ok('n=9 → row2 (4 stamps) centred under row1 (5 stamps)', () => {
    const positions = computeLayout(9);
    const ys = [...new Set(positions.map(p => p.y))].sort((a, b) => a - b);
    const row1 = positions.filter(p => p.y === ys[0]);
    const row2 = positions.filter(p => p.y === ys[1]);
    assert.strictEqual(row1.length, 5);
    assert.strictEqual(row2.length, 4);
    // row2 should be shifted right by spacing/2
    assert.ok(row2[0].x > row1[0].x, 'row2 first stamp should be shifted right');
  });

  ok('n=12 → two rows, all stamps within safe zone', () => {
    const positions = computeLayout(12);
    positions.forEach(p => {
      assert.ok(p.x - p.r >= 60, `stamp at x=${p.x} r=${p.r} clips left safe zone`);
      assert.ok(p.x + p.r <= 690, `stamp at x=${p.x} r=${p.r} clips right safe zone`);
    });
  });

  ok('n=16 → two rows, all stamps within safe zone', () => {
    const positions = computeLayout(16);
    positions.forEach(p => {
      assert.ok(p.x - p.r >= 60, `stamp at x=${p.x} r=${p.r} clips left safe zone`);
      assert.ok(p.x + p.r <= 690, `stamp at x=${p.x} r=${p.r} clips right safe zone`);
    });
  });

  console.log('\n─── render() — generated strip ─────────────────');

  const baseMarchand = {
    slug: 'test', nom: 'Test', couleur_fond: '#1a3a5c',
    max_value: 5, strip_mode: 'stamps', strip_theme: 'icon_metier',
    stamp_icon: 'coffee', strip_label: 'on', forfait: 'pro',
  };

  await ok_async('render icon_metier max=5 filled=3 → correct dimensions', async () => {
    const { strip2x, strip3x, hero } = await render({ marchand: baseMarchand, filledCount: 3, logoBuffer: null, customBgBuffer: null });
    assertPngDimensions(strip2x, VARIANTS.strip2x.w, VARIANTS.strip2x.h, 'strip2x');
    assertPngDimensions(strip3x, VARIANTS.strip3x.w, VARIANTS.strip3x.h, 'strip3x');
    assertPngDimensions(hero,    VARIANTS.hero.w,    VARIANTS.hero.h,    'hero');
  });

  await ok_async('render max=8 (single row boundary) → strip2x correct', async () => {
    const m = { ...baseMarchand, max_value: 8 };
    const { strip2x } = await render({ marchand: m, filledCount: 4, logoBuffer: null, customBgBuffer: null });
    assertPngDimensions(strip2x, 750, 246, 'strip2x n=8');
  });

  await ok_async('render max=10 (two rows) → strip2x correct', async () => {
    const m = { ...baseMarchand, max_value: 10 };
    const { strip2x } = await render({ marchand: m, filledCount: 6, logoBuffer: null, customBgBuffer: null });
    assertPngDimensions(strip2x, 750, 246, 'strip2x n=10');
  });

  await ok_async('render max=12 two rows → correct dimensions', async () => {
    const m = { ...baseMarchand, max_value: 12 };
    const { strip2x } = await render({ marchand: m, filledCount: 8, logoBuffer: null, customBgBuffer: null });
    assertPngDimensions(strip2x, 750, 246, 'strip2x n=12');
  });

  await ok_async('render max=16 two rows → correct dimensions', async () => {
    const m = { ...baseMarchand, max_value: 16 };
    const { strip2x } = await render({ marchand: m, filledCount: 10, logoBuffer: null, customBgBuffer: null });
    assertPngDimensions(strip2x, 750, 246, 'strip2x n=16');
  });

  await ok_async('render strip_label=off → still correct dimensions', async () => {
    const m = { ...baseMarchand, strip_label: 'off' };
    const { strip2x } = await render({ marchand: m, filledCount: 2, logoBuffer: null, customBgBuffer: null });
    assertPngDimensions(strip2x, 750, 246, 'strip2x nolabel');
  });

  await ok_async('render logo_stamp (no logo buffer) → fallback to icon', async () => {
    const m = { ...baseMarchand, strip_theme: 'logo_stamp', max_value: 8 };
    const { strip2x } = await render({ marchand: m, filledCount: 3, logoBuffer: null, customBgBuffer: null });
    assertPngDimensions(strip2x, 750, 246, 'logo_stamp no logo');
  });

  await ok_async('render premium theme → correct dimensions', async () => {
    const m = { ...baseMarchand, strip_theme: 'premium', max_value: 10 };
    const { strip2x } = await render({ marchand: m, filledCount: 9, logoBuffer: null, customBgBuffer: null });
    assertPngDimensions(strip2x, 750, 246, 'premium');
  });

  console.log('\n─── render() — static image override ───────────');

  await ok_async('staticImageBuffer overrides SVG generation → exact dimensions', async () => {
    const sharp = require('sharp');
    const staticBuf = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 100, b: 50 } }
    }).png().toBuffer();

    const { strip2x, strip3x, hero } = await render({ marchand: baseMarchand, filledCount: 0, logoBuffer: null, customBgBuffer: null, staticImageBuffer: staticBuf });
    assertPngDimensions(strip2x, VARIANTS.strip2x.w, VARIANTS.strip2x.h, 'static strip2x');
    assertPngDimensions(strip3x, VARIANTS.strip3x.w, VARIANTS.strip3x.h, 'static strip3x');
    assertPngDimensions(hero,    VARIANTS.hero.w,    VARIANTS.hero.h,    'static hero');
  });

  console.log('\n─── Text rendering (fonts loaded) ───────────────');

  await ok_async('strip has visible bright pixels (filled stamps + label on dark bg)', async () => {
    const { strip2x } = await render({ marchand: { ...baseMarchand, couleur_fond: '#0f1b2e' }, filledCount: 3, logoBuffer: null, customBgBuffer: null });
    const bright = await countBrightPixelsAsync(strip2x);
    assert.ok(bright > 100, `Expected >100 bright pixels from white stamp fills, got ${bright}`);
  });

  // Summary
  console.log(`\n──────────────────────────────────────────────────`);
  console.log(`Tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function ok_async(label, fn) {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${label}\n    ${e.message}`);
    failed++;
  }
}

function assertPngDimensions(buf, expectedW, expectedH, name) {
  assert.ok(Buffer.isBuffer(buf) && buf.length > 0, `${name}: empty buffer`);
  // PNG signature + IHDR
  assert.ok(buf[0] === 0x89 && buf[1] === 0x50, `${name}: not a PNG`);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  assert.strictEqual(w, expectedW, `${name}: width ${w} != ${expectedW}`);
  assert.strictEqual(h, expectedH, `${name}: height ${h} != ${expectedH}`);
}

async function countBrightPixelsAsync(pngBuf) {
  const sharp = require('sharp');
  const { data, info } = await sharp(pngBuf).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  let bright = 0;
  for (let i = 0; i < data.length; i += ch) {
    if (data[i] > 200 && data[i+1] > 200 && data[i+2] > 200) bright++;
  }
  return bright;
}

run().catch(e => { console.error(e); process.exit(1); });
