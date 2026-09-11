const express = require('express');
const router  = express.Router();
const supabase = require('../services/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { authAdmin } = require('../middleware/auth');
const { limiterDiag } = require('../middleware/rateLimiters');

// ════════════════════════════════════════════════════════════════════════════
// DIAGNOSTIC CAMÉRA — instrument temporaire (palier 0.5)
//
// Reçoit l'empreinte caméra d'une tablette, étiquetée par point de vente, et
// la restitue à l'admin. Ne lit ni n'écrit RIEN du produit : ni clients, ni
// passes, ni scans, ni marchands. Supprimable en bloc avec la table et la page
// de résultats quand le chantier décodeur sera tranché.
// ════════════════════════════════════════════════════════════════════════════

// Forme d'étiquette acceptée — miroir exact du CHECK de la migration 042.
// Volontairement permissive sur le contenu (le fondateur teste avec ses propres
// libellés) mais stricte sur la FORME : minuscules, chiffres, tirets, 32 max.
const RE_ETIQUETTE = /^[a-z0-9-]{1,32}$/;

// Liste blanche des clés stockées. Tout le reste du corps est JETÉ — on ne
// persiste jamais un JSON client non borné, même sur un endpoint d'instrument.
const CHAMPS = [
  'largeur', 'hauteur', 'fps_demande', 'fps_mesure', 'facing',
  'capabilities_exposees', 'focus_mode', 'exposure_mode', 'torch',
  'resolutions_max', 'device_label',
  'currentTime_progresse', 'currentTime_delta_s', 'track_muted', 'track_state',
  'jsqr_ms', 'jsqr_decodes', 'zxing_ms', 'zxing_decodes', 'zxing_charge',
  'barcode_detector', 'webgl_renderer', 'ecran', 'orientation', 'duree_mesure_s',
  'erreur',
];

const MAX_TEXTE = 300;

// Normalise une valeur : nombre fini, booléen, null, ou texte tronqué. Aucune
// structure imbriquée n'est conservée — ça borne la taille par construction.
function valeurSure(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) return v.slice(0, 20).map(x => String(x).slice(0, 60));
  return String(v).slice(0, MAX_TEXTE);
}

// ── POST /api/diag/camera — PUBLIC (l'employé n'est connecté à rien) ────────
// Bordé par : limiteur dédié, forme d'étiquette, liste blanche de champs,
// troncature. Ne renvoie aucune donnée — juste un accusé.
router.post('/camera', limiterDiag, asyncHandler(async (req, res) => {
  const etiquette = String(req.body?.etiquette || '').trim().toLowerCase();
  if (!RE_ETIQUETTE.test(etiquette)) {
    return res.status(400).json({ error: 'etiquette invalide' });
  }

  const brut = req.body?.mesure;
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) {
    return res.status(400).json({ error: 'mesure manquante' });
  }

  const mesure = {};
  for (const k of CHAMPS) {
    if (brut[k] !== undefined) mesure[k] = valeurSure(brut[k]);
  }

  // §3.9 — supabase-js ne rejette JAMAIS : l'erreur se lit, elle ne se catch pas.
  const { error } = await supabase.from('diagnostics_camera').insert({
    etiquette,
    mesure,
    user_agent: String(req.headers['user-agent'] || '').slice(0, MAX_TEXTE),
  });

  if (error) {
    console.error('[diag] insert échoué:', error.message);
    return res.status(500).json({ error: 'enregistrement impossible' });
  }

  res.status(201).json({ ok: true });
}));

// ── GET /api/diag/resultats — ADMIN ────────────────────────────────────────
// Renvoie la DERNIÈRE mesure de chaque étiquette, plus le nombre de mesures
// reçues. Le tri se fait ici, pas en base : le volume est de l'ordre de la
// dizaine de lignes, une lecture simple suffit et évite une fonction SQL de
// plus à maintenir pour un instrument temporaire.
router.get('/resultats', authAdmin, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('diagnostics_camera')
    .select('id, etiquette, mesure, user_agent, created_at')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    console.error('[diag] lecture échouée:', error.message);
    return res.status(500).json({ error: error.message });
  }

  const parEtiquette = new Map();
  for (const ligne of data || []) {
    // data est trié du plus récent au plus ancien → la première vue gagne.
    if (!parEtiquette.has(ligne.etiquette)) {
      parEtiquette.set(ligne.etiquette, { ...ligne, nb_mesures: 1 });
    } else {
      parEtiquette.get(ligne.etiquette).nb_mesures++;
    }
  }

  res.json({ mesures: [...parEtiquette.values()], total_lignes: (data || []).length });
}));

module.exports = router;
