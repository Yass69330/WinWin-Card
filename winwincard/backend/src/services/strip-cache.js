// Cache de strips générés : LRU mémoire + Supabase Storage.
// Génération lazy par (slug, strip_config_version, filledCount).
// Anti-stampede : promesse partagée par clé.
'use strict';

const supabase = require('./supabase');
const { render } = require('./strip-generator');
const { fetchImage } = require('./apple-pass');

const BUCKET = 'passes';
const MAX_LRU = 120; // ~3 MB max en mémoire (≈25 KB/entrée)

// ── LRU in-memory ─────────────────────────────────────────────────────────
// Map d'insertion-order → FIFO cheapo; pour un vrai LRU on utiliserait un LinkedHashMap
// mais à 120 entrées max la différence est négligeable.
const _lru = new Map(); // key → Buffer

function lruGet(key) { return _lru.get(key) || null; }
function lruSet(key, buf) {
  if (_lru.size >= MAX_LRU) {
    _lru.delete(_lru.keys().next().value); // evict oldest
  }
  _lru.set(key, buf);
}

// ── Promesses en cours (anti-stampede) ───────────────────────────────────
const _pending = new Map(); // key → Promise<Buffer>

// ── Clé Storage ───────────────────────────────────────────────────────────
function storageKey(marchand, filledCount, variant) {
  const slug    = marchand.slug;
  const version = marchand.strip_config_version || 1;
  const mode    = marchand.strip_mode === 'stamps' ? `stamps_${filledCount}` : 'static';
  return `marchands/${slug}/gen/v${version}/${mode}_${variant}.png`;
}

// ── Purge fire-and-forget des anciennes versions ──────────────────────────
function purgeOldVersions(marchand, variant) {
  const version = marchand.strip_config_version || 1;
  if (version <= 1) return;
  const slug = marchand.slug;
  const maxValue = marchand.max_value || 10;

  const toDelete = [];
  for (let v = 1; v < version; v++) {
    for (let n = 0; n <= maxValue; n++) {
      toDelete.push(
        `marchands/${slug}/gen/v${v}/stamps_${n}_${variant}.png`,
        `marchands/${slug}/gen/v${v}/static_${variant}.png`,
      );
    }
  }

  // Chunks de 100 (limite API Supabase Storage)
  for (let i = 0; i < toDelete.length; i += 100) {
    supabase.storage.from(BUCKET).remove(toDelete.slice(i, i + 100))
      .then(() => {})
      .catch(e => console.warn('[strip-cache] purge warning:', e.message));
  }
}

// ── Lecture depuis Storage ────────────────────────────────────────────────
async function fetchFromStorage(key) {
  const { data, error } = await supabase.storage.from(BUCKET).download(key);
  if (error || !data) return null;
  const ab = await data.arrayBuffer();
  return Buffer.from(ab);
}

// ── Upload vers Storage ───────────────────────────────────────────────────
async function uploadToStorage(key, buf) {
  await supabase.storage.createBucket(BUCKET, { public: true }).catch(() => {});
  const { error } = await supabase.storage.from(BUCKET)
    .upload(key, buf, { contentType: 'image/png', upsert: true });
  if (error) throw new Error(`Storage upload: ${error.message}`);
}

// ── URL publique d'un fichier Storage ────────────────────────────────────
function publicUrl(key) {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
  return data?.publicUrl || null;
}

// ── Point d'entrée principal ──────────────────────────────────────────────
// variant: 'strip2x' | 'strip3x' | 'hero'
// Retourne le Buffer PNG.
async function getOrGenerate({ marchand, filledCount, variant }) {
  if (!marchand.strip_mode) throw new Error('strip_mode not set');

  const key = storageKey(marchand, filledCount, variant);

  // 1. LRU mémoire
  const cached = lruGet(key);
  if (cached) return cached;

  // 2. Anti-stampede
  if (_pending.has(key)) return _pending.get(key);

  const promise = (async () => {
    // 3. Storage
    const fromStorage = await fetchFromStorage(key).catch(() => null);
    if (fromStorage) {
      lruSet(key, fromStorage);
      return fromStorage;
    }

    // 4. Génération complète (toutes les variantes d'un coup pour amortir le coût sharp)
    const logoBuffer = await _fetchLogo(marchand);
    const customBgBuffer = await _fetchCustomBg(marchand);
    const buffers = await render({ marchand, filledCount, logoBuffer, customBgBuffer });

    // 5. Upload des 3 variantes en parallèle (fire-and-forget pour les deux autres)
    const uploadAll = [
      { v: 'strip2x', buf: buffers.strip2x },
      { v: 'strip3x', buf: buffers.strip3x },
      { v: 'hero',    buf: buffers.hero    },
    ];
    await Promise.all(uploadAll.map(async ({ v, buf }) => {
      const k = storageKey(marchand, filledCount, v);
      lruSet(k, buf);
      await uploadToStorage(k, buf).catch(e =>
        console.error(`[strip-cache] upload ${k}:`, e.message)
      );
    }));

    // 6. Purge ancienne version en fire-and-forget
    purgeOldVersions(marchand, variant);

    return buffers[variant];
  })();

  _pending.set(key, promise);
  try {
    const result = await promise;
    return result;
  } finally {
    _pending.delete(key);
  }
}

// ── URL publique Storage d'un strip généré (pour Google Wallet hero) ──────
// Retourne l'URL sans attendre la génération si le fichier existe déjà,
// sinon déclenche la génération et retourne l'URL calculée.
async function getPublicUrl({ marchand, filledCount, variant = 'hero' }) {
  if (!marchand.strip_mode) return null;
  const key = storageKey(marchand, filledCount, variant);

  // Vérifie l'existence avant de générer (économise un rendu si déjà présent)
  const existing = await fetchFromStorage(key).catch(() => null);
  if (!existing) {
    await getOrGenerate({ marchand, filledCount, variant }).catch(e =>
      console.error('[strip-cache] getPublicUrl gen failed:', e.message)
    );
  }
  return publicUrl(key);
}

// ── Helpers fetch internes ────────────────────────────────────────────────
async function _fetchLogo(marchand) {
  const url = marchand.logo_url;
  if (!url) return null;
  return fetchImage(url).catch(() => null);
}

async function _fetchCustomBg(marchand) {
  const url = marchand.strip_custom_background_url;
  if (!url || marchand.forfait !== 'pro_plus') return null;
  return fetchImage(url).catch(() => null);
}

module.exports = { getOrGenerate, getPublicUrl, storageKey, publicUrl };
