'use strict';

// ════════════════════════════════════════════════════════════════════════════
// CACHE D'AUTORISATION MARCHAND — `actif` + `token_version`
//
// Chantier P0 sécurité (cas a et b). Avant lui, `authMarchand` ne consultait
// RIEN en base : un marchand suspendu gardait l'accès à ses 14 routes, dont 5
// qui écrivent, et aucun moyen n'existait de couper une tablette volée.
//
// POURQUOI UN CACHE. Sans lui, chaque appel du dashboard coûterait une lecture
// de plus ; un chargement de tableau de bord en fait une dizaine. Avec 60 s de
// TTL, le coût retombe à UNE lecture par marchand et par minute, quelle que
// soit l'activité. Les deux champs voyagent ensemble : le cas (b) ne coûte
// donc AUCUNE requête supplémentaire par rapport au cas (a).
//
// LE TTL N'EST PAS LE DÉLAI DE COUPURE. Les deux chemins d'administration
// (suspension, révocation) appellent `invalider()` — l'effet est immédiat, pas
// 60 s plus tard. Le TTL ne couvre que les changements faits AILLEURS (SQL brut
// dans Supabase, par exemple), où la coupure prend au plus une minute.
//
// COMPORTEMENT EN CAS DE PANNE DE LECTURE — décision à connaître :
// si Supabase répond une erreur (blip réseau, saturation), on NE refuse PAS.
// On sert la dernière valeur connue même périmée ; à défaut, on laisse passer
// en journalisant. Refuser aurait pour effet d'arrêter TOUTES les caisses de
// TOUS les marchands pendant l'incident — un scan perdu est un client mécontent
// en caisse, alors qu'un marchand suspendu qui passe une minute de plus ne
// coûte rien. Une ligne ABSENTE (marchand supprimé), en revanche, est une
// réponse valide et vaut refus.
// ════════════════════════════════════════════════════════════════════════════

const supabase = require('./supabase');

const TTL_MS = 60 * 1000;

// marchand_id → { actif, tokenVersion, expire }
const _cache = new Map();

// Promesses en cours, une par marchand : dix appels simultanés du dashboard sur
// un cache froid ne déclenchent qu'UNE lecture (même motif anti-stampede que
// strip-cache.js).
const _pending = new Map();

function invalider(marchandId) {
  if (marchandId) _cache.delete(String(marchandId));
}

function viderTout() {
  _cache.clear();
}

async function _lire(marchandId) {
  // §3.9 : supabase-js ne rejette JAMAIS — on lit `error` explicitement.
  const { data, error } = await supabase
    .from('marchands')
    .select('actif, token_version')
    .eq('id', marchandId)
    .maybeSingle();

  if (error) {
    const err = new Error(error.message);
    err.lectureImpossible = true;   // distingue la panne de l'absence de ligne
    throw err;
  }
  return {
    // Ligne absente (marchand supprimé) → refus. C'est une réponse, pas une panne.
    actif: data ? data.actif !== false : false,
    // Colonne absente (migration 045 pas encore exécutée) → 1, ce qui laisse
    // passer les jetons sans `tv`. Le code peut donc être déployé avant la
    // migration sans couper personne — mais l'ordre reste migration d'abord.
    tokenVersion: data ? (data.token_version ?? 1) : 1,
    existe: !!data,
  };
}

// Retourne { actif, tokenVersion, existe }. Ne jette jamais.
async function etatMarchand(marchandId) {
  const cle = String(marchandId);
  const maintenant = Date.now();

  const enCache = _cache.get(cle);
  if (enCache && enCache.expire > maintenant) return enCache.valeur;

  if (_pending.has(cle)) return _pending.get(cle);

  const promesse = (async () => {
    try {
      const valeur = await _lire(marchandId);
      _cache.set(cle, { valeur, expire: Date.now() + TTL_MS });
      return valeur;
    } catch (e) {
      console.error(`[marchand-cache] lecture ${cle}:`, e.message);
      // Panne de lecture : on préfère la dernière valeur connue, même périmée.
      if (enCache) return enCache.valeur;
      // Aucune valeur connue → on laisse passer plutôt que de bloquer la caisse.
      return { actif: true, tokenVersion: null, existe: true, degrade: true };
    } finally {
      _pending.delete(cle);
    }
  })();

  _pending.set(cle, promesse);
  return promesse;
}

module.exports = { etatMarchand, invalider, viderTout, TTL_MS };
