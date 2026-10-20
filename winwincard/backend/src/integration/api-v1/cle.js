// ════════════════════════════════════════════════════════════════════════════
// Clés d'API des commerçants (contrat v1 §2.1, migration 066)
//
// Format : wwk_live_<40> ou wwk_test_<40> (base64url). La clé n'existe en clair
// qu'une fois, dans la réponse de création ; la base n'en garde que l'empreinte
// sha256 (api_cles.empreinte) et un préfixe lisible pour le support.
//
// Vérification : une lecture (verifier_cle_api) gardée EN MÉMOIRE 60 s au plus
// (API_CLE_CACHE_MS). D'où la règle du contrat : une révocation est effective en
// 60 s au plus. Révoquée depuis l'admin de CE serveur : effective tout de suite
// (oublier()). Hypothèse : un seul serveur (Railway, une instance) ; à plusieurs,
// le délai de 60 s reste la borne.
// Seuls les accès réussis sont gardés en mémoire : une clé fausse va en base à
// chaque fois, et le limiteur des échecs (api-v1/index.js) borne ces essais.
// ════════════════════════════════════════════════════════════════════════════
const crypto = require('crypto');
const supabase = require('../../services/supabase');

const FORME_CLE = /^wwk_(live|test)_[A-Za-z0-9_-]{40}$/;
const LONGUEUR_PREFIXE = 15;   // « wwk_live_ » + 6 caractères
const MAX_EN_MEMOIRE = 1000;

const empreinte = cle => crypto.createHash('sha256').update(cle).digest('hex');

function nouvelleCle(environnement) {
  const cle = `wwk_${environnement}_${crypto.randomBytes(30).toString('base64url')}`;
  return { cle, prefixe: cle.slice(0, LONGUEUR_PREFIXE), empreinte: empreinte(cle) };
}

const memoire = new Map();   // empreinte → { acces, expire }
// Empreintes déjà reconnues valables au moins une fois (sans durée) : servent
// SEULEMENT à laisser passer une vraie clé quand son adresse est bloquée pour
// trop d'échecs (index.js). Elles sont toujours revérifiées en base (révocation).
const vues = new Set();
const dureeMemoire = () => Number(process.env.API_CLE_CACHE_MS) || 60000;

// → { ok: true, acces: { cle_id, marchand_id, environnement } }
//   { ok: false, reason: 'cle_invalide' | 'commercant_suspendu' }
//   { erreur } si la base ne répond pas.
async function verifier(cle) {
  if (typeof cle !== 'string' || !FORME_CLE.test(cle)) return { ok: false, reason: 'cle_invalide' };
  const e = empreinte(cle);
  const garde = memoire.get(e);
  if (garde && garde.expire > Date.now()) return { ok: true, acces: garde.acces };
  memoire.delete(e);
  const { data, error } = await supabase.rpc('verifier_cle_api', { p_empreinte: e });
  if (error) return { erreur: error };
  if (!data || data.ok !== true) return { ok: false, reason: (data && data.reason) || 'cle_invalide' };
  const acces = { cle_id: data.cle_id, marchand_id: data.marchand_id, environnement: data.environnement };
  if (memoire.size >= MAX_EN_MEMOIRE) memoire.clear();
  memoire.set(e, { acces, expire: Date.now() + dureeMemoire() });
  if (vues.size >= MAX_EN_MEMOIRE) vues.clear();
  vues.add(e);
  return { ok: true, acces };
}

// Révocation faite sur ce serveur : la clé cesse de servir tout de suite.
function oublier(cleId) {
  for (const [e, g] of memoire) if (g.acces.cle_id === cleId) memoire.delete(e);
}

const dejaVue = cle => typeof cle === 'string' && FORME_CLE.test(cle) && vues.has(empreinte(cle));

module.exports = { nouvelleCle, verifier, oublier, dejaVue, FORME_CLE };
