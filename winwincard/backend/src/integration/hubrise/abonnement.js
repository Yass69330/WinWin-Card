// ════════════════════════════════════════════════════════════════════════════
// Abonnement d'une connexion aux ventes de sa location (H1b, cadrage
// docs/hubrise/03-h1b-reception.md §1)
//
// Partagé par le retour OAuth (à la connexion) et le bouton admin « Abonner aux
// ventes » (connexions d'avant H1b, abonnement raté). Idempotent : un POST
// /callback remplace le callback existant. Un 401 de Hubrise veut dire que le
// marchand a retiré l'app (pas de webhook) : la connexion est coupée « par
// Hubrise », jeton effacé.
// ════════════════════════════════════════════════════════════════════════════
'use strict';

const supabase = require('../../services/supabase');
const config = require('./config');
const hubrise = require('./api-hubrise');

// connexion = { id, marchand_id, location_id } ; jeton en clair (déchiffré par l'appelant).
// → { ok: true } | { ok: false, raison: 'jeton_mort' | 'hubrise_<statut>' | 'hubrise_injoignable' | 'base' }
async function abonner(connexion, jeton) {
  const r = await hubrise.abonner(jeton, config.callbackUrl());
  if (!r.ok) {
    if (r.statut === 401) {
      const { error } = await supabase.rpc('hubrise_couper_connexion', { p_connexion_id: connexion.id, p_par: 'hubrise' });
      if (error) console.error('[hubrise] abonnement : coupure (jeton mort) impossible :', error.message);
      return { ok: false, raison: 'jeton_mort' };
    }
    console.error('[hubrise] abonnement impossible :', r.statut ? `statut ${r.statut}` : 'injoignable');
    return { ok: false, raison: r.statut ? `hubrise_${r.statut}` : 'hubrise_injoignable' };
  }
  const { error } = await supabase.from('hubrise_connexions').update({ callback_id: r.callbackId })
    .eq('id', connexion.id).is('coupee_le', null);
  if (error) {
    console.error('[hubrise] abonnement : enregistrement impossible :', error.message);
    return { ok: false, raison: 'base' };
  }
  return { ok: true };
}

module.exports = { abonner };
