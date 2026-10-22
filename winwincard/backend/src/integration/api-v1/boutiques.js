// ════════════════════════════════════════════════════════════════════════════
// Le champ `boutique` des appels (contrat v1 §4.1) : le code du magasin dans la
// caisse du commerçant (points_de_vente.code_externe, réglé dans l'admin).
// Dès qu'une boutique du commerçant a un code, le champ est obligatoire, connu et
// ouvert ; sans aucun code, il est ignoré (vente non attribuée).
// ════════════════════════════════════════════════════════════════════════════
const supabase = require('../../services/supabase');

const lireBoutiques = marchandId => supabase.from('points_de_vente').select('id, code_externe, actif')
  .eq('marchand_id', marchandId).is('deleted_at', null).not('code_externe', 'is', null);

// → { id } (null si le commerçant n'a aucun code) | { statut, corps } (refus)
function choisirBoutique(boutiques, code) {
  if (!boutiques.length) return { id: null };
  if (code == null) return { statut: 400, corps: { error: 'corps_invalide', champ: 'boutique' } };
  const pdv = boutiques.find(x => x.code_externe === code);
  if (!pdv) return { statut: 422, corps: { error: 'boutique_inconnue' } };
  if (!pdv.actif) return { statut: 403, corps: { error: 'boutique_fermee' } };
  return { id: pdv.id };
}

module.exports = { lireBoutiques, choisirBoutique };
