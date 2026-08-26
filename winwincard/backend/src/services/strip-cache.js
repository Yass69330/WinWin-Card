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
  // 'stamps'     → une image par nombre de tampons remplis (seuil 10 → 11 images).
  // 'points_bar' → une image par PALIER de 5 % (21 images max), jamais par solde
  //   exact : un seuil à 500 produirait sinon 500+ images par marchand. Le palier
  //   vient de pointsBucket(), la MÊME fonction que celle qui dessine la barre —
  //   sinon on servirait une image ne correspondant pas à l'avancement.
  // autre/NULL  → une seule image statique.
  let mode = 'static';
  if (marchand.strip_mode === 'stamps') {
    mode = `stamps_${filledCount}`;
  } else if (marchand.strip_mode === 'points_bar') {
    // La clé DOIT utiliser la même valeur que celle dessinée dans l'image,
    // sinon on servirait une image affichant un solde différent de celui du
    // client. valeurAffichee() est la source de vérité unique et applique le
    // plafond anti-dérapage.
    const { valeurAffichee } = require('./strip-generator');
    mode = `points_${valeurAffichee(filledCount)}`;
  }
  return `marchands/${slug}/gen/v${version}/${mode}_${variant}.png`;
}

// ── Purge des anciennes versions ──────────────────────────────────────────
// RÉÉCRITE. L'ancienne version DEVINAIT les noms de fichiers en énumérant
// `stamps_0..max_value`, ce qui posait trois problèmes :
//   • elle ignorait totalement les clés `points_*` → aucune image de barre
//     n'aurait jamais été supprimée ;
//   • sur un marchand points (seuil 2000) elle fabriquait ~4000 chemins et
//     tirait ~40 requêtes HTTP SIMULTANÉES, pour des fichiers inexistants,
//     à CHAQUE image générée — la rafale qui menaçait la production ;
//   • son `.catch()` était du code mort (§3.9 : supabase-js ne rejette jamais)
//     et son `.then()` vide jetait l'erreur : un échec était invisible partout.
//
// La nouvelle version LIT le dossier au lieu de deviner. Deux pièges, tous
// deux attrapés par les tests avant livraison :
//   1. NE JAMAIS paginer en supprimant au fil de l'eau — chaque suppression
//      décale la liste côté serveur, donc avancer l'offset saute autant de
//      fichiers qu'on vient d'effacer. On lit TOUT, puis on supprime.
//   2. NE JAMAIS déduire la fin de la pagination de la taille de page demandée
//      — Supabase peut renvoyer moins que `limit`. Seule fin fiable : page vide.
const PAGE_LIST   = 1000;  // taille de page demandée à list()
const LOT_REMOVE  = 100;   // taille de lot pour remove()
const MAX_PAGES   = 1000;  // garde-fou anti-boucle infinie

// Marchands déjà purgés pour une version donnée, dans CE process. Sans ce
// garde, purgeOldVersions était rappelée à chaque image générée alors qu'il
// n'y a rien de neuf à nettoyer entre deux : sur un marchand points, une purge
// par scan. Avec : une purge par changement de configuration.
const _purges = new Set();

async function purgeOldVersions(marchand, variant) {
  const version = marchand.strip_config_version || 1;
  if (version <= 1) return;
  const slug = marchand.slug;

  const marqueur = `${slug}@v${version}`;
  if (_purges.has(marqueur)) return;
  _purges.add(marqueur);

  const erreurs = [];
  let supprimes = 0;

  for (let v = 1; v < version; v++) {
    const dossier = `marchands/${slug}/gen/v${v}`;

    // PHASE 1 — tout lister, sans rien supprimer.
    const chemins = [];
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await supabase.storage.from(BUCKET)
        .list(dossier, { limit: PAGE_LIST, offset });
      if (error) { erreurs.push(`list ${dossier}@${offset}: ${error.message}`); break; }
      if (!data || data.length === 0) break;
      chemins.push(...data.map(f => `${dossier}/${f.name}`));
      offset += data.length;
    }

    // PHASE 2 — supprimer par lots, SÉQUENTIELLEMENT (fin de la rafale).
    for (let i = 0; i < chemins.length; i += LOT_REMOVE) {
      const lot = chemins.slice(i, i + LOT_REMOVE);
      const { error } = await supabase.storage.from(BUCKET).remove(lot);
      // On LIT l'erreur : supabase-js ne rejette jamais (§3.9).
      if (error) erreurs.push(`remove ${dossier}: ${error.message}`);
      else supprimes += lot.length;
    }
  }

  if (erreurs.length) {
    console.error(`[strip-cache] purge ${slug} v${version} : ${erreurs.length} erreur(s)`, erreurs.slice(0, 3));
    _purges.delete(marqueur); // échec → on réessaiera au prochain passage
  } else if (supprimes > 0) {
    console.log(`[strip-cache] purge ${slug} : ${supprimes} fichier(s) d'anciennes versions supprimé(s)`);
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
    purgeOldVersions(marchand, variant)
      .catch(e => console.error('[strip-cache] purge:', e.message));

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

module.exports = {
  getOrGenerate, getPublicUrl, storageKey, publicUrl,
  // Exposée pour les tests : la purge est le seul chemin qui parle à Storage
  // en écriture massive, elle doit être vérifiable sans réseau.
  __purgeOldVersionsForTest: purgeOldVersions,
};
