// ════════════════════════════════════════════════════════════════════════════
// Le numéro de téléphone du client dans l'API (contrat v1 §3.1, §4.4 ; étape 3)
//
// Toute la règle est en base (migration 068) : format (Émirats par défaut), un
// numéro = une carte par commerçant, jamais d'écrasement. Ici, seulement la
// traduction des réponses SQL en statuts du contrat.
// Le numéro n'est jamais écrit dans les journaux.
// ════════════════════════════════════════════════════════════════════════════
const supabase = require('../../services/supabase');

// Carte rattachée à ce numéro chez ce commerçant.
// → { client: { id, prenom, stored_value, pass_serial_number } } | { absent: true }
//   | { invalide: true } | { erreur }
async function trouverParTelephone(marchandId, brut) {
  const { data, error } = await supabase.rpc('trouver_carte_par_telephone', { p_marchand_id: marchandId, p_brut: brut });
  if (error) return { erreur: error };
  if (data && data.ok) {
    return { client: { id: data.client_id, prenom: data.prenom, stored_value: data.solde, pass_serial_number: data.serial } };
  }
  return data && data.reason === 'numero_invalide' ? { invalide: true } : { absent: true };
}

// Rattache le numéro à la carte (source « caisse », sans ligne de consentement :
// modèle sous-traitant, migration 068). Ne lève jamais : un échec ne doit pas
// faire échouer la vente, il rend « non_traite ».
async function rattacher(marchandId, serial, brut) {
  try {
    const { data, error } = await supabase.rpc('attacher_telephone', {
      p_marchand_id: marchandId, p_serial: serial, p_brut: brut, p_source: 'caisse', p_ecrire: true,
    });
    if (error || !data) {
      if (error) console.error('[api-v1] rattachement du numéro impossible :', error.message);
      return 'non_traite';
    }
    if (data.ok) return data.inchange ? 'deja_rattache' : 'rattache';
    return { deja_un_numero: 'ignore_autre_numero', numero_pris: 'ignore_numero_pris', numero_invalide: 'ignore_invalide' }[data.reason] || 'non_traite';
  } catch (e) {
    console.error('[api-v1] rattachement du numéro impossible :', e.message);
    return 'non_traite';
  }
}

module.exports = { trouverParTelephone, rattacher };
